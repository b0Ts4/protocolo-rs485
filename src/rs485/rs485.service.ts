import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SerialPort } from 'serialport';
import { Rs485Config, Rs485Frame, Rs485Handler, Rs485Response } from './rs485.types';
import { Rs485Protocol } from './rs485.protocol';

type PendingRequest = {
  resolve: (value: Rs485Response) => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout;
  responseCommand: number;
};

@Injectable()
export class Rs485Service implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(Rs485Service.name);
  private port?: SerialPort;
  private readonly protocol = new Rs485Protocol();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly handlers = new Map<number, Rs485Handler>();

  private readonly config: Rs485Config = {
    portPath: process.env.RS485_PORT ?? '/dev/ttyUSB0',
    baudRate: Number(process.env.RS485_BAUD ?? 9600),
    parity: (process.env.RS485_PARITY as Rs485Config['parity']) ?? 'none',
    dataBits: (Number(process.env.RS485_DATABITS ?? 8) as Rs485Config['dataBits']),
    stopBits: (Number(process.env.RS485_STOPBITS ?? 1) as Rs485Config['stopBits']),
    timeoutMs: Number(process.env.RS485_TIMEOUT_MS ?? 1000),
    mode: (process.env.RS485_MODE as Rs485Config['mode']) ?? 'master',
  };

  async onModuleInit(): Promise<void> {
    this.port = new SerialPort({
      path: this.config.portPath,
      baudRate: this.config.baudRate,
      parity: this.config.parity,
      dataBits: this.config.dataBits,
      stopBits: this.config.stopBits,
      autoOpen: false,
    });

    this.port.on('error', (err) => this.logger.error(err.message));
    this.port.on('data', (chunk: Buffer) => {
      this.logger.debug(`RX ${chunk.toString('hex')}`);
      this.protocol.push(chunk);
    });

    this.protocol.on('frame', (frame: Rs485Response) => {
      this.logger.log(
        `FRAME addr=${frame.address} cmd=0x${frame.command.toString(16).padStart(2, '0')} payload=${frame.payload.toString('hex')}`
      );
      if (this.config.mode === 'slave') {
        void this.handleSlaveFrame(frame);
        return;
      }
      const key = this.getKey(frame.address, frame.command);
      const pending = this.pending.get(key);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(key);
      pending.resolve(frame);
    });

    if (this.config.mode === 'slave' && this.handlers.size === 0) {
      // Default test handler: echo payload for any command
      this.handlers.set(-1 as unknown as number, async (frame) => frame.payload);
      this.logger.warn('RS485 slave: default echo handler enabled');
    }

    await new Promise<void>((resolve, reject) => {
      this.port?.open((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    this.logger.log(
      `RS485 aberto em ${this.config.portPath} ${this.config.baudRate} ${this.config.dataBits}${this.config.parity[0]?.toUpperCase() ?? 'N'}${this.config.stopBits} modo=${this.config.mode}`
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.port) return;
    await new Promise<void>((resolve) => this.port?.close(() => resolve()));
  }

  async sendFrame(frame: Rs485Frame): Promise<void> {
    if (this.config.mode === 'slave') throw new Error('RS485 is in slave mode');
    if (!this.port || !this.port.isOpen) throw new Error('SerialPort not open');
    const buf = Rs485Protocol.buildFrame(frame);
    this.logger.debug(`TX ${buf.toString('hex')}`);
    await new Promise<void>((resolve, reject) => {
      this.port?.write(buf, (err) => {
        if (err) reject(err);
        else this.port?.drain(() => resolve());
      });
    });
  }

  isSlave(): boolean {
    return this.config.mode === 'slave';
  }

  async sendRequest(
    frame: Rs485Frame,
    responseCommand: number = frame.command | 0x80
  ): Promise<Rs485Response> {
    if (this.config.mode === 'slave') throw new Error('RS485 is in slave mode');
    const key = this.getKey(frame.address, responseCommand);
    if (this.pending.has(key)) throw new Error('Request already pending for this address/command');

    const response = new Promise<Rs485Response>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error('RS485 timeout'));
      }, this.config.timeoutMs);
      this.pending.set(key, { resolve, reject, timeout, responseCommand });
    });

    await this.sendFrame(frame);
    return response;
  }

  registerHandler(command: number, handler: Rs485Handler): void {
    if (command < 0 || command > 255) throw new Error('Command out of range');
    this.handlers.set(command, handler);
  }

  private async handleSlaveFrame(frame: Rs485Response): Promise<void> {
    const handler = this.handlers.get(frame.command);
    const fallback = this.handlers.get(-1 as unknown as number);
    if (!handler && !fallback) return;
    try {
      const fn = handler ?? fallback!;
      const payload = await fn({ address: frame.address, command: frame.command, payload: frame.payload });
      const responseCommand = frame.command | 0x80;
      await this.sendFrame({ address: frame.address, command: responseCommand, payload });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'ERR';
      const payload = Buffer.from(message, 'utf8');
      await this.sendFrame({ address: frame.address, command: 0xff, payload });
    }
  }

  private getKey(address: number, command: number): string {
    return `${address}:${command}`;
  }
}
