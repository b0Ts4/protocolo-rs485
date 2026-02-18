import 'dotenv/config';
import * as express from 'express';
import * as http from 'http';
import * as cors from 'cors';
import { createErrorHandler, createRs485Router } from './rs485/rs485.routes';
import { Rs485Service } from './rs485/rs485.service';
import { RealtimeHub } from './realtime/realtime.hub';
import { closeDb, initDb, insertEvent } from './db';
import { readT161Current, readT161Voltage } from './rs485/rs485.metrics';

async function bootstrap(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(cors());

  const rs485 = new Rs485Service();
  await rs485.init();
  console.log('Connecting to Postgres...');
  await initDb();
  console.log('Postgres connected');

  const server = http.createServer(app);
  const hub = new RealtimeHub(server);

  app.use('/rs485', createRs485Router(rs485, hub));
  app.use(createErrorHandler());

  const port = Number(process.env.PORT ?? 3000);
  server.on('error', (err) => {
    console.error('HTTP server error:', err);
  });

  server.listen(port, () => {
    console.log(`HTTP server listening on port ${port}`);
  });

  const intervalMs = Number(process.env.RS485_CRON_INTERVAL_MS ?? 10000);
  const cronAddress = Number(process.env.RS485_CRON_ADDRESS ?? 12);
  const cronPhases = String(process.env.RS485_CRON_PHASES ?? 'A,B,C')
    .split(',')
    .map((p) => p.trim().toUpperCase())
    .filter((p) => p === 'A' || p === 'B' || p === 'C') as Array<'A' | 'B' | 'C'>;
  const cronEnabled = (process.env.RS485_CRON_ENABLED ?? '1') !== '0';

  let cronRunning = false;
  const cronHandle =
    cronEnabled && intervalMs > 0
      ? setInterval(async () => {
          if (cronRunning) return;
          cronRunning = true;
          try {
            const eventAt = new Date().toISOString();
            const current = await readT161Current(rs485, cronAddress);
            await insertEvent('t161_current', current, eventAt);
            hub.broadcast({ type: 't161_current', timestamp: eventAt, data: current });

            for (const phase of cronPhases) {
              const voltage = await readT161Voltage(rs485, cronAddress, phase);
              const voltageEventAt = new Date().toISOString();
              await insertEvent('t161_voltage', voltage, voltageEventAt);
              hub.broadcast({ type: 't161_voltage', timestamp: voltageEventAt, data: voltage });
            }
          } catch (err) {
            console.error('Cron read failed:', err);
          } finally {
            cronRunning = false;
          }
        }, intervalMs)
      : null;

  const shutdown = async () => {
    console.log('Shutting down...');
    if (cronHandle) clearInterval(cronHandle);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rs485.close();
    await closeDb();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
