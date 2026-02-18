import type { NextFunction, Request, Response } from 'express';
import { Rs485Service } from './rs485.service';
import { RealtimeHub } from '../realtime/realtime.hub';
import { fetchHistory, HistoryEventType, insertEvent } from '../db';
import { readT161Current, readT161Voltage } from './rs485.metrics';
import { Rs485Frame, Rs485Response } from './rs485.types';

type SendBody = {
  address: number;
  command: number;
  payloadHex?: string;
};

type RequestBody = SendBody & {
  responseCommand?: number;
};

type T161CurrentBody = {
  address: number;
};

type T161VoltageBody = {
  address: number;
  phase?: 'A' | 'B' | 'C';
};

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function createRs485Router(rs485: Rs485Service, hub?: RealtimeHub) {
  const express = require('express') as typeof import('express');
  const router = express.Router();

  router.post(
    '/send',
    asyncHandler(async (req, res) => {
      const body = req.body as SendBody;
      if (rs485.isSlave()) throw new HttpError(400, 'RS485 is in slave mode');
      const frame = toFrame(body);
      await rs485.sendFrame(frame);
      res.json({ ok: true });
    })
  );

  router.get(
    '/history',
    asyncHandler(async (req, res) => {
      const limit = parseLimit(req.query.limit);
      const type = parseType(req.query.type);
      const from = parseDate(req.query.from);
      const to = parseDate(req.query.to);

      const rows = await fetchHistory({
        limit,
        type: type ?? undefined,
        from: from ?? undefined,
        to: to ?? undefined,
      });
      res.json({ status: 'ok', data: rows });
    })
  );

  router.post(
    '/request',
    asyncHandler(async (req, res) => {
      const body = req.body as RequestBody;
      if (rs485.isSlave()) throw new HttpError(400, 'RS485 is in slave mode');
      const frame = toFrame(body);
      const responseCommand =
        body.responseCommand === undefined ? undefined : requireNumber(body.responseCommand, 'responseCommand');
      console.log(
        `Sending request to slave ${toHex(frame.address)} for command ${toHex(frame.command)} with payload ${frame.payload.toString('hex')}`
      );
      const response = await rs485.sendRequest(frame, responseCommand ?? frame.command);
      const reqPayloadHex = frame.payload.toString('hex');
      const resPayloadHex = response.payload.toString('hex');
      const reqAddrHex = toHex(frame.address);
      const reqCmdHex = toHex(frame.command);
      const resAddrHex = toHex(response.address);
      const resCmdHex = toHex(response.command);
      const responseBody = {
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
      const eventAt = new Date().toISOString();
      await insertEvent('request_response', responseBody, eventAt);
      hub?.broadcast({
        type: 'request_response',
        timestamp: eventAt,
        data: responseBody,
      });
      res.json(responseBody);
    })
  );

  router.post(
    '/t161/current',
    asyncHandler(async (req, res) => {
      const body = req.body as T161CurrentBody;
      if (rs485.isSlave()) throw new HttpError(400, 'RS485 is in slave mode');
      const address = requireAddress(body.address);

      const responseBody = await readT161Current(rs485, address);
      const eventAt = new Date().toISOString();
      await insertEvent('t161_current', responseBody, eventAt);
      hub?.broadcast({
        type: 't161_current',
        timestamp: eventAt,
        data: responseBody,
      });
      res.json(responseBody);
    })
  );

  router.post(
    '/t161/voltage',
    asyncHandler(async (req, res) => {
      const body = req.body as T161VoltageBody;
      if (rs485.isSlave()) throw new HttpError(400, 'RS485 is in slave mode');
      const address = requireAddress(body.address);
      const phase = body.phase ?? 'A';
      if (!['A', 'B', 'C'].includes(phase)) throw new HttpError(400, 'Invalid phase');

      const responseBody = await readT161Voltage(rs485, address, phase);
      const eventAt = new Date().toISOString();
      await insertEvent('t161_voltage', responseBody, eventAt);
      hub?.broadcast({
        type: 't161_voltage',
        timestamp: eventAt,
        data: responseBody,
      });
      res.json(responseBody);
    })
  );

  return router;
}

export function createErrorHandler() {
  return (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    if (status >= 500) console.error(err);
    res.status(status).json({ status: 'error', message });
  };
}

function requireNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HttpError(400, `${name} must be a number`);
  }
  return value;
}

function requireAddress(value: unknown): number {
  const address = requireNumber(value, 'address');
  if (address < 1 || address > 254) throw new HttpError(400, 'Invalid Modbus address');
  return address;
}

function toFrame(body: SendBody): Rs485Frame {
  const address = requireNumber(body.address, 'address');
  const command = requireNumber(body.command, 'command');
  const payload = parsePayload(body.payloadHex);
  return { address, command, payload };
}

function parsePayload(payloadHex?: string): Buffer {
  if (!payloadHex) return Buffer.alloc(0);
  if (typeof payloadHex !== 'string') throw new HttpError(400, 'payloadHex must be a string');
  if (!/^[0-9a-fA-F]*$/.test(payloadHex) || payloadHex.length % 2 !== 0) {
    throw new HttpError(400, 'payloadHex must be a valid even-length hex string');
  }
  return Buffer.from(payloadHex, 'hex');
}

function toHex(value: number): string {
  return `0x${value.toString(16).padStart(2, '0')}`;
}

function parseLimit(value: unknown): number {
  if (value === undefined) return 200;
  const num = typeof value === 'string' ? Number(value) : Number(Array.isArray(value) ? value[0] : value);
  if (!Number.isFinite(num) || num < 1 || num > 2000) {
    throw new HttpError(400, 'limit must be between 1 and 2000');
  }
  return Math.floor(num);
}

function parseType(value: unknown): HistoryEventType | null {
  if (!value) return null;
  const val = Array.isArray(value) ? value[0] : value;
  if (val === 'request_response' || val === 't161_current' || val === 't161_voltage') {
    return val;
  }
  throw new HttpError(400, 'Invalid type');
}

function parseDate(value: unknown): string | null {
  if (!value) return null;
  const val = Array.isArray(value) ? value[0] : value;
  if (typeof val !== 'string') throw new HttpError(400, 'Invalid date');
  const date = new Date(val);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, 'Invalid date');
  return date.toISOString();
}
