const assert = require('assert/strict');
const { parseT161SnapshotRegisters } = require('../dist/rs485/rs485.metrics');

function registers(values) {
  const data = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => data.writeUInt16BE(value & 0xffff, index * 2));
  return data;
}

const START = 0x23;
const END = 0x4e;
const values = new Array(END - START + 1).fill(0);
const set = (addr, value) => {
  values[addr - START] = value;
};

set(0x23, 0x0201); // DPT = 2, DCT = 1
set(0x24, 0x0903); // SIGN: Pa and Ps negative, DPQ = 3
set(0x25, 1234);
set(0x26, 2345);
set(0x27, 3456);
set(0x28, 4567);
set(0x29, 5678);
set(0x2a, 6789);
set(0x2b, 1111);
set(0x2c, 2222);
set(0x2d, 3333);
set(0x2e, 1000);
set(0x2f, 2000);
set(0x30, 3000);
set(0x31, 4000);
set(0x32, 500);
set(0x33, 600);
set(0x34, 700);
set(0x35, 800);
set(0x36, 990);
set(0x37, 980);
set(0x38, 970);
set(0x39, 960);
set(0x3a, 1100);
set(0x3b, 1200);
set(0x3c, 1300);
set(0x3d, 1400);
set(0x3e, 6000);
set(0x3f, 0x0000);
set(0x40, 0x0064);
set(0x41, 0x0000);
set(0x42, 0x00c8);
set(0x43, 0x0000);
set(0x44, 0x012c);
set(0x45, 0x0000);
set(0x46, 0x0190);
set(0x47, 0x0000);
set(0x48, 0x01f4);
set(0x49, 0x0000);
set(0x4a, 0x0258);
set(0x4b, 0x0000);
set(0x4c, 0x02bc);
set(0x4d, 0x0000);
set(0x4e, 0x0320);

const snapshot = parseT161SnapshotRegisters(12, registers(values), { tp: 2, tc: 3 });
const approx = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

assert.equal(snapshot.status, 'ok');
assert.equal(snapshot.address, 12);
assert.equal(snapshot.dpt, 2);
assert.equal(snapshot.dct, 1);
assert.equal(snapshot.dpq, 3);
assert.equal(snapshot.tp, 2);
assert.equal(snapshot.tc, 3);
assert.equal(snapshot.energyMultiplier, 6);
assert.equal(snapshot.signByte, 0x09);
assert.equal(snapshot.voltage.phaseA, 12.34);
assert.equal(snapshot.voltage.lineCA, 67.89);
approx(snapshot.current.phaseC, 3.333);
assert.equal(snapshot.activePower.phaseA, -100);
assert.equal(snapshot.activePower.total, -400);
assert.equal(snapshot.reactivePower.phaseA, 50);
assert.equal(snapshot.powerFactor.total, 0.96);
assert.equal(snapshot.apparentPower.total, 140);
assert.equal(snapshot.frequencyHz, 60);
assert.equal(snapshot.energy.activeDirectKwh, 600);
assert.equal(snapshot.energy.reactiveReverseTotalKvarh, 4800);

assert.throws(
  () => parseT161SnapshotRegisters(12, Buffer.alloc(2)),
  /Invalid T161 snapshot/
);
