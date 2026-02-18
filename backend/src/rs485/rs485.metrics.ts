import { Rs485Service } from './rs485.service';

export type T161CurrentResult = {
  status: 'ok';
  address: number;
  currentA: number;
  rawRegister: number;
  dct: number;
  formula: string;
};

export type T161VoltageResult = {
  status: 'ok';
  address: number;
  phase: 'A' | 'B' | 'C';
  voltageV: number;
  rawRegister: number;
  dpt: number;
  formula: string;
};

export async function readT161Current(rs485: Rs485Service, address: number): Promise<T161CurrentResult> {
  const DCT_ADDR = 0x23;
  const IA_ADDR = 0x2b;

  const dctData = await rs485.readHoldingRegisters(address, DCT_ADDR, 1);
  const dctReg = dctData.readUInt16BE(0);
  const dct = toSigned8(dctReg & 0xff);

  const iaData = await rs485.readHoldingRegisters(address, IA_ADDR, 1);
  const rawRegister = iaData.readInt16BE(0);
  const currentA = (rawRegister / 10000) * Math.pow(10, dct);

  return {
    status: 'ok',
    address,
    currentA,
    rawRegister,
    dct,
    formula: 'I = (R / 10000) * (10 ^ DCT)',
  };
}

export async function readT161Voltage(
  rs485: Rs485Service,
  address: number,
  phase: 'A' | 'B' | 'C'
): Promise<T161VoltageResult> {
  const DPT_ADDR = 0x23;
  const VA_ADDR = 0x25;
  const VB_ADDR = 0x26;
  const VC_ADDR = 0x27;
  const voltageAddr = phase === 'A' ? VA_ADDR : phase === 'B' ? VB_ADDR : VC_ADDR;

  const dptData = await rs485.readHoldingRegisters(address, DPT_ADDR, 1);
  const dptReg = dptData.readUInt16BE(0);
  const dpt = toSigned8(dptReg & 0xff);

  const vData = await rs485.readHoldingRegisters(address, voltageAddr, 1);
  const rawRegister = vData.readInt16BE(0);
  const voltageV = (rawRegister / 10000) * Math.pow(10, dpt);

  return {
    status: 'ok',
    address,
    phase,
    voltageV,
    rawRegister,
    dpt,
    formula: 'V = (R / 10000) * (10 ^ DPT)',
  };
}

function toSigned8(value: number): number {
  return value & 0x80 ? value - 0x100 : value;
}
