import { Body, Controller, Post, BadRequestException } from '@nestjs/common';
import { Rs485Service } from './rs485.service';
import { Rs485Frame, Rs485Response } from './rs485.types';

type SendBody = {
  address: number;
  command: number;
  payloadHex?: string;
};

type RequestBody = SendBody & {
  responseCommand?: number;
};

@Controller('rs485')
export class Rs485Controller {
  constructor(private readonly rs485: Rs485Service) {}

  @Post('send')
  async send(@Body() body: SendBody): Promise<{ ok: true }> {
    if (this.rs485.isSlave()) throw new BadRequestException('RS485 is in slave mode');
    const frame = this.toFrame(body);
    await this.rs485.sendFrame(frame);
    return { ok: true };
  }

  @Post('request')
  async request(
    @Body() body: RequestBody
  ): Promise<{
    status: 'ok';
    message: string;
    request: {
      address: { dec: number; hex: string };
      command: { dec: number; hex: string };
      payloadHex: string;
      payloadLen: number;
    };
    response: {
      address: { dec: number; hex: string };
      command: { dec: number; hex: string };
      payloadHex: string;
      payloadLen: number;
    };
    table: Array<{ field: string; request: string; response: string }>;
  }> {
    if (this.rs485.isSlave()) throw new BadRequestException('RS485 is in slave mode');
    const frame = this.toFrame(body);
    const response = await this.rs485.sendRequest(frame, body.responseCommand);
    const reqPayloadHex = frame.payload.toString('hex');
    const resPayloadHex = response.payload.toString('hex');
    const reqAddrHex = toHex(frame.address);
    const reqCmdHex = toHex(frame.command);
    const resAddrHex = toHex(response.address);
    const resCmdHex = toHex(response.command);
    return {
      status: 'ok',
      message: `Resposta do slave ${reqAddrHex} para comando ${reqCmdHex}`,
      request: {
        address: { dec: frame.address, hex: reqAddrHex },
        command: { dec: frame.command, hex: reqCmdHex },
        payloadHex: reqPayloadHex,
        payloadLen: frame.payload.length,
      },
      response: {
        address: { dec: response.address, hex: resAddrHex },
        command: { dec: response.command, hex: resCmdHex },
        payloadHex: resPayloadHex,
        payloadLen: response.payload.length,
      },
      table: [
        { field: 'address', request: `${frame.address} (${reqAddrHex})`, response: `${response.address} (${resAddrHex})` },
        { field: 'command', request: `${frame.command} (${reqCmdHex})`, response: `${response.command} (${resCmdHex})` },
        { field: 'payloadHex', request: reqPayloadHex || '-', response: resPayloadHex || '-' },
        { field: 'payloadLen', request: String(frame.payload.length), response: String(response.payload.length) },
      ],
    };
  }

  private toFrame(body: SendBody): Rs485Frame {
    const payload = body.payloadHex ? Buffer.from(body.payloadHex, 'hex') : Buffer.alloc(0);
    return { address: body.address, command: body.command, payload };
  }
}

function toHex(value: number): string {
  return `0x${value.toString(16).padStart(2, '0')}`;
}
