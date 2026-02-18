import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
export const hasDb = Boolean(connectionString);
if (!connectionString) {
  console.warn('DATABASE_URL is not set. History storage will fail.');
}

export const db = new Pool({
  connectionString,
  connectionTimeoutMillis: 5000,
});

export type HistoryEventType = 'request_response' | 't161_current' | 't161_voltage';

export type HistoryEvent = {
  id: string;
  type: HistoryEventType;
  payload: unknown;
  eventAt: string;
  createdAt: string;
};

export async function initDb(): Promise<void> {
  if (!hasDb) {
    throw new Error('DATABASE_URL is not set');
  }
  await db.query(`
    CREATE TABLE IF NOT EXISTS rs485_events (
      id BIGSERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      payload JSONB NOT NULL,
      event_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS rs485_events_type_idx ON rs485_events (type);`);
  await db.query(`CREATE INDEX IF NOT EXISTS rs485_events_event_at_idx ON rs485_events (event_at DESC);`);
}

export async function closeDb(): Promise<void> {
  await db.end();
}

export async function insertEvent(
  type: HistoryEventType,
  payload: unknown,
  eventAtIso?: string
): Promise<void> {
  const eventAt = eventAtIso ? new Date(eventAtIso) : new Date();
  await db.query(
    'INSERT INTO rs485_events (type, payload, event_at) VALUES ($1, $2, $3)',
    [type, payload, eventAt]
  );
}

type HistoryQuery = {
  limit: number;
  type?: HistoryEventType;
  from?: string;
  to?: string;
};

export async function fetchHistory(query: HistoryQuery): Promise<HistoryEvent[]> {
  const params: Array<string | number | Date> = [];
  let sql = 'SELECT id, type, payload, event_at, created_at FROM rs485_events';
  const where: string[] = [];

  if (query.type) {
    params.push(query.type);
    where.push(`type = $${params.length}`);
  }
  if (query.from) {
    params.push(new Date(query.from));
    where.push(`event_at >= $${params.length}`);
  }
  if (query.to) {
    params.push(new Date(query.to));
    where.push(`event_at <= $${params.length}`);
  }
  if (where.length > 0) {
    sql += ` WHERE ${where.join(' AND ')}`;
  }
  sql += ` ORDER BY event_at DESC LIMIT $${params.length + 1}`;
  params.push(query.limit);

  const result = await db.query(sql, params);
  return result.rows.map((row) => ({
    id: String(row.id),
    type: row.type,
    payload: row.payload,
    eventAt: row.event_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  }));
}
