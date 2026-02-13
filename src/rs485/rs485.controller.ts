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
  async request(@Body() body: RequestBody): Promise<Rs485Response & { payloadHex: string }> {
    if (this.rs485.isSlave()) throw new BadRequestException('RS485 is in slave mode');
    const frame = this.toFrame(body);
    const response = await this.rs485.sendRequest(frame, body.responseCommand);
    return { ...response, payloadHex: response.payload.toString('hex') };
  }

  private toFrame(body: SendBody): Rs485Frame {
    const payload = body.payloadHex ? Buffer.from(body.payloadHex, 'hex') : Buffer.alloc(0);
    return { address: body.address, command: body.command, payload };
  }
}
