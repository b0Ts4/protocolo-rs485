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

export type T161SnapshotResult = {
  status: 'ok';
  address: number;
  rawRange: {
    start: number;
    count: number;
  };
  dpt: number;
  dct: number;
  dpq: number;
  signByte: number;
  tp: number;
  tc: number;
  energyMultiplier: number;
  voltage: {
    phaseA: number;
    phaseB: number;
    phaseC: number;
    lineAB: number;
    lineBC: number;
    lineCA: number;
  };
  current: {
    phaseA: number;
    phaseB: number;
    phaseC: number;
  };
  activePower: {
    phaseA: number;
    phaseB: number;
    phaseC: number;
    total: number;
  };
  reactivePower: {
    phaseA: number;
    phaseB: number;
    phaseC: number;
    total: number;
  };
  powerFactor: {
    phaseA: number;
    phaseB: number;
    phaseC: number;
    total: number;
  };
  apparentPower: {
    phaseA: number;
    phaseB: number;
    phaseC: number;
    total: number;
  };
  frequencyHz: number;
  energy: {
    activeDirectKwh: number;
    activeReverseKwh: number;
    reactiveDirectKvarh: number;
    reactiveReverseKvarh: number;
    activeDirectTotalKwh: number;
    activeReverseTotalKwh: number;
    reactiveDirectTotalKvarh: number;
    reactiveReverseTotalKvarh: number;
  };
  rawRegisters: Record<string, number>;
  formula: {
    voltage: string;
    current: string;
    power: string;
    energy: string;
    powerFactor: string;
    frequency: string;
  };
};

const SNAPSHOT_START_ADDR = 0x23;
const SNAPSHOT_END_ADDR = 0x4e;
const SNAPSHOT_REGISTER_COUNT = SNAPSHOT_END_ADDR - SNAPSHOT_START_ADDR + 1;
const TP_TC_START_ADDR = 0x03;

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

export async function readT161Snapshot(rs485: Rs485Service, address: number): Promise<T161SnapshotResult> {
  const configData = await rs485.readHoldingRegisters(address, TP_TC_START_ADDR, 2);
  const tp = configData.readUInt16BE(0);
  const tc = configData.readUInt16BE(2);
  const data = await rs485.readHoldingRegisters(address, SNAPSHOT_START_ADDR, SNAPSHOT_REGISTER_COUNT);
  return parseT161SnapshotRegisters(address, data, { tp, tc });
}

export function parseT161SnapshotRegisters(
  address: number,
  data: Buffer,
  options: { tp?: number; tc?: number } = {}
): T161SnapshotResult {
  if (data.length < SNAPSHOT_REGISTER_COUNT * 2) {
    throw new Error(
      `Invalid T161 snapshot: expected ${SNAPSHOT_REGISTER_COUNT * 2} bytes, got ${data.length}`
    );
  }

  const reg = (addr: number) => data.readInt16BE((addr - SNAPSHOT_START_ADDR) * 2);
  const ureg = (addr: number) => data.readUInt16BE((addr - SNAPSHOT_START_ADDR) * 2);
  const reg32 = (addr: number) => (ureg(addr) * 0x10000 + ureg(addr + 1));
  const tp = options.tp ?? 1;
  const tc = options.tc ?? 1;
  const energyMultiplier = tp * tc;
  const energy = (addr: number) => reg32(addr) * energyMultiplier;

  const scale = (raw: number, exponent: number) => (raw / 10000) * Math.pow(10, exponent);
  const dptDct = ureg(0x23);
  const dpt = toSigned8((dptDct >> 8) & 0xff);
  const dct = toSigned8(dptDct & 0xff);

  const dpqSign = ureg(0x24);
  let dpq = toSigned8(dpqSign & 0xff);
  let signByte = (dpqSign >> 8) & 0xff;
  if (Math.abs(dpq) > 6) {
    const altDpq = toSigned8((dpqSign >> 8) & 0xff);
    const altSign = dpqSign & 0xff;
    if (Math.abs(altDpq) <= 6) {
      dpq = altDpq;
      signByte = altSign;
    }
  }

  const power = (addr: number, signBit: number) => applySign(scale(reg(addr), dpq), signByte, signBit);
  const rawRegisters: Record<string, number> = {};
  for (let addr = SNAPSHOT_START_ADDR; addr <= SNAPSHOT_END_ADDR; addr += 1) {
    rawRegisters[`0x${addr.toString(16).toUpperCase()}`] = ureg(addr);
  }

  return {
    status: 'ok',
    address,
    rawRange: {
      start: SNAPSHOT_START_ADDR,
      count: SNAPSHOT_REGISTER_COUNT,
    },
    dpt,
    dct,
    dpq,
    signByte,
    tp,
    tc,
    energyMultiplier,
    voltage: {
      phaseA: scale(reg(0x25), dpt),
      phaseB: scale(reg(0x26), dpt),
      phaseC: scale(reg(0x27), dpt),
      lineAB: scale(reg(0x28), dpt),
      lineBC: scale(reg(0x29), dpt),
      lineCA: scale(reg(0x2a), dpt),
    },
    current: {
      phaseA: scale(reg(0x2b), dct),
      phaseB: scale(reg(0x2c), dct),
      phaseC: scale(reg(0x2d), dct),
    },
    activePower: {
      phaseA: power(0x2e, 0),
      phaseB: power(0x2f, 1),
      phaseC: power(0x30, 2),
      total: power(0x31, 3),
    },
    reactivePower: {
      phaseA: power(0x32, 4),
      phaseB: power(0x33, 5),
      phaseC: power(0x34, 6),
      total: power(0x35, 7),
    },
    powerFactor: {
      phaseA: reg(0x36) / 1000,
      phaseB: reg(0x37) / 1000,
      phaseC: reg(0x38) / 1000,
      total: reg(0x39) / 1000,
    },
    apparentPower: {
      phaseA: scale(reg(0x3a), dpq),
      phaseB: scale(reg(0x3b), dpq),
      phaseC: scale(reg(0x3c), dpq),
      total: scale(reg(0x3d), dpq),
    },
    frequencyHz: reg(0x3e) / 100,
    energy: {
      activeDirectKwh: energy(0x3f),
      activeReverseKwh: energy(0x41),
      reactiveDirectKvarh: energy(0x43),
      reactiveReverseKvarh: energy(0x45),
      activeDirectTotalKwh: energy(0x47),
      activeReverseTotalKwh: energy(0x49),
      reactiveDirectTotalKvarh: energy(0x4b),
      reactiveReverseTotalKvarh: energy(0x4d),
    },
    rawRegisters,
    formula: {
      voltage: 'V = (R / 10000) * (10 ^ DPT)',
      current: 'I = (R / 10000) * (10 ^ DCT)',
      power: 'P = (R / 10000) * (10 ^ DPQ)',
      energy: 'E = R * TC * TP',
      powerFactor: 'FP = R / 1000',
      frequency: 'F = R / 100',
    },
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
