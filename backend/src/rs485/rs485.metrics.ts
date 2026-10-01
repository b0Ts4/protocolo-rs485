import { Rs485Service } from './rs485.service';

export type T161CurrentResult = {
  status: 'ok';
  address: number;
  currentA: number;
  currentB: number;
  currentC: number;
  rawRegisters: {
    currentA: number;
    currentB: number;
    currentC: number;
  };
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

export type T161PowerResult = {
  status: 'ok';
  address: number;
  powerA: number;
  powerB: number;
  powerC: number;
  powerTotal: number;
  rawRegisters: {
    powerA: number;
    powerB: number;
    powerC: number;
    powerTotal: number;
  };
  dpq: number;
  signByte: number;
  formula: string;
};

export async function readT161Current(rs485: Rs485Service, address: number): Promise<T161CurrentResult> {
  const DCT_ADDR = 0x23;
  const IA_ADDR = 0x2b;

  const dctData = await rs485.readHoldingRegisters(address, DCT_ADDR, 1);
  const dctReg = dctData.readUInt16BE(0);
  const dct = toSigned8(dctReg & 0xff);

  const iData = await rs485.readHoldingRegisters(address, IA_ADDR, 3);
  const rawA = iData.readInt16BE(0);
  const rawB = iData.readInt16BE(2);
  const rawC = iData.readInt16BE(4);
  const currentA = (rawA / 10000) * Math.pow(10, dct);
  const currentB = (rawB / 10000) * Math.pow(10, dct);
  const currentC = (rawC / 10000) * Math.pow(10, dct);

  return {
    status: 'ok',
    address,
    currentA,
    currentB,
    currentC,
    rawRegisters: {
      currentA: rawA,
      currentB: rawB,
      currentC: rawC,
    },
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

export async function readT161Power(rs485: Rs485Service, address: number): Promise<T161PowerResult> {
  const DPQ_SIGN_ADDR = 0x24;
  const PA_ADDR = 0x2e;

  const dpqData = await rs485.readHoldingRegisters(address, DPQ_SIGN_ADDR, 1);
  const dpqReg = dpqData.readUInt16BE(0);
  let dpq = toSigned8(dpqReg & 0xff);
  let signByte = (dpqReg >> 8) & 0xff;
  // Heuristic: if DPQ is out of plausible range, swap bytes (some devices map SIGN/DPQ reversed)
  if (Math.abs(dpq) > 6) {
    const altDpq = toSigned8((dpqReg >> 8) & 0xff);
    const altSign = dpqReg & 0xff;
    if (Math.abs(altDpq) <= 6) {
      dpq = altDpq;
      signByte = altSign;
    }
  }

  const powerData = await rs485.readHoldingRegisters(address, PA_ADDR, 4);
  const rawA = powerData.readInt16BE(0);
  const rawB = powerData.readInt16BE(2);
  const rawC = powerData.readInt16BE(4);
  const rawTotal = powerData.readInt16BE(6);

  const powerA = applySign(scalePower(rawA, dpq), signByte, 0);
  const powerB = applySign(scalePower(rawB, dpq), signByte, 1);
  const powerC = applySign(scalePower(rawC, dpq), signByte, 2);
  const powerTotal = applySign(scalePower(rawTotal, dpq), signByte, 3);

  return {
    status: 'ok',
    address,
    powerA,
    powerB,
    powerC,
    powerTotal,
    rawRegisters: {
      powerA: rawA,
      powerB: rawB,
      powerC: rawC,
      powerTotal: rawTotal,
    },
    dpq,
    signByte,
    formula: 'P = (R / 10000) * (10 ^ DPQ)',
  };
}

function toSigned8(value: number): number {
  return value & 0x80 ? value - 0x100 : value;
}

function scalePower(raw: number, dpq: number): number {
  return (raw / 10000) * Math.pow(10, dpq);
}

function applySign(value: number, signByte: number, bit: number): number {
  const negative = (signByte & (1 << bit)) !== 0;
  return negative ? -value : value;
}
