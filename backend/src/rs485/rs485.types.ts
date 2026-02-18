export type Rs485Config = {
  portPath: string;
  baudRate: number;
  parity: 'none' | 'even' | 'mark' | 'odd' | 'space';
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  timeoutMs: number;
  mode: 'master' | 'slave';
};

export type Rs485Frame = {
  address: number;
  command: number;
  payload: Buffer;
};

export type Rs485Response = Rs485Frame & {
  raw: Buffer;
};

export type Rs485Handler = (frame: Rs485Frame) => Promise<Buffer> | Buffer;
