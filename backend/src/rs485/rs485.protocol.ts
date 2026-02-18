import { EventEmitter } from 'events';
import { Rs485Frame, Rs485Response } from './rs485.types';

const MIN_FRAME_LEN = 4; // ADDR + FUNC + CRC16 (no data)

export class Rs485Protocol extends EventEmitter {
  private buffer = Buffer.alloc(0);

  static buildFrame(frame: Rs485Frame): Buffer {
    const { address, command, payload } = frame;
    if (address < 0 || address > 255) throw new Error('Address out of range');
    if (command < 0 || command > 255) throw new Error('Command out of range');
    if (payload.length > 252) throw new Error('Payload too large for Modbus RTU');

    const head = Buffer.from([address & 0xff, command & 0xff]);
    const body = Buffer.concat([head, payload]);
    const crc = crc16Modbus(body);
    const crcBuf = Buffer.from([crc & 0xff, (crc >> 8) & 0xff]);
    return Buffer.concat([body, crcBuf]);
  }

  push(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.parseBuffer();
  }

  private parseBuffer(): void {
    let parsed = true;
    while (parsed) {
      parsed = false;
      if (this.buffer.length < MIN_FRAME_LEN) return;

      for (let start = 0; start <= this.buffer.length - MIN_FRAME_LEN; start += 1) {
        const parsedFrame = this.tryParseAt(start);
        if (!parsedFrame) continue;

        const { frame, totalLen } = parsedFrame;
        this.buffer = this.buffer.slice(start + totalLen);
        this.emit('frame', frame);
        parsed = true;
        break;
      }
    }

    if (this.buffer.length > 512) {
      this.buffer = this.buffer.slice(-256);
    }
  }

  private tryParseAt(start: number): { frame: Rs485Response; totalLen: number } | null {
    if (this.buffer.length - start < MIN_FRAME_LEN) return null;
    const address = this.buffer[start];
    const command = this.buffer[start + 1];

    const candidates = this.getCandidateLengths(start, command);
    for (const totalLen of candidates) {
      if (this.buffer.length - start < totalLen) continue;
      const frameBuf = this.buffer.slice(start, start + totalLen);
      const crcExpected = frameBuf.readUInt16LE(totalLen - 2);
      const crcActual = crc16Modbus(frameBuf.slice(0, totalLen - 2));
      if (crcExpected !== crcActual) continue;

      const payload = frameBuf.slice(2, totalLen - 2);
      return { frame: { address, command, payload, raw: frameBuf }, totalLen };
    }

    return null;
  }

  private getCandidateLengths(start: number, command: number): number[] {
    const remaining = this.buffer.length - start;
    const candidates: number[] = [];

    if (command & 0x80) {
      candidates.push(5); // exception response: addr, func|0x80, code, crc16
      return candidates;
    }

    if (command === 0x03 || command === 0x04) {
      // Request length: 8 (addr, func, start_hi, start_lo, qty_hi, qty_lo, crc16)
      candidates.push(8);
      // Response length: 5 + byteCount (addr, func, byteCount, data, crc16)
      if (remaining >= 3) {
        const byteCount = this.buffer[start + 2];
        if (byteCount <= 250) candidates.push(5 + byteCount);
      }
      return candidates;
    }

    if (command === 0x06 || command === 0x05) {
      candidates.push(8); // write single: echo request
      return candidates;
    }

    if (command === 0x10 || command === 0x0f) {
      // Write multiple registers/coils: request length = 9 + byteCount; response length = 8
      candidates.push(8);
      if (remaining >= 7) {
        const byteCount = this.buffer[start + 6];
        if (byteCount <= 252) candidates.push(9 + byteCount);
      }
      return candidates;
    }

    candidates.push(4);
    return candidates;
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
