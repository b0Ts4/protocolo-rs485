import { EventEmitter } from 'events';
import { Rs485Frame, Rs485Response } from './rs485.types';

const STX = 0x02;
const ETX = 0x03;
const MIN_FRAME_LEN = 1 + 1 + 1 + 1 + 2 + 1; // STX + ADDR + CMD + LEN + CRC16 + ETX

export class Rs485Protocol extends EventEmitter {
  private buffer = Buffer.alloc(0);

  static buildFrame(frame: Rs485Frame): Buffer {
    const { address, command, payload } = frame;
    if (address < 0 || address > 255) throw new Error('Address out of range');
    if (command < 0 || command > 255) throw new Error('Command out of range');
    if (payload.length > 255) throw new Error('Payload too large');

    const header = Buffer.from([STX, address & 0xff, command & 0xff, payload.length & 0xff]);
    const crc = crc16Modbus(Buffer.concat([header.slice(1), payload]));
    const crcBuf = Buffer.from([crc & 0xff, (crc >> 8) & 0xff]);
    return Buffer.concat([header, payload, crcBuf, Buffer.from([ETX])]);
  }

  push(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.parseBuffer();
  }

  private parseBuffer(): void {
    while (this.buffer.length >= MIN_FRAME_LEN) {
      const stxIndex = this.buffer.indexOf(STX);
      if (stxIndex === -1) {
        this.buffer = Buffer.alloc(0);
        return;
      }
      if (stxIndex > 0) this.buffer = this.buffer.slice(stxIndex);

      if (this.buffer.length < MIN_FRAME_LEN) return;
      const len = this.buffer[3];
      const totalLen = 1 + 1 + 1 + 1 + len + 2 + 1;
      if (this.buffer.length < totalLen) return;

      const frameBuf = this.buffer.slice(0, totalLen);
      this.buffer = this.buffer.slice(totalLen);

      if (frameBuf[totalLen - 1] !== ETX) continue;
      const address = frameBuf[1];
      const command = frameBuf[2];
      const payload = frameBuf.slice(4, 4 + len);
      const crcExpected = frameBuf.readUInt16LE(4 + len);
      const crcActual = crc16Modbus(Buffer.concat([frameBuf.slice(1, 4), payload]));
      if (crcExpected !== crcActual) continue;

      const response: Rs485Response = { address, command, payload, raw: frameBuf };
      this.emit('frame', response);
    }
  }
}

// Standard Modbus CRC16 (poly 0xA001)
export function crc16Modbus(buf: Buffer): number {
  let crc = 0xffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      const lsb = crc & 0x0001;
      crc >>= 1;
      if (lsb) crc ^= 0xA001;
    }
  }
  return crc & 0xffff;
}
