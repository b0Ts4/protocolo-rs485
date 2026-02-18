'use client';

import { useEffect, useRef, useState } from 'react';
import { Line } from 'react-chartjs-2';
import 'chart.js/auto';

type EventType = 'request_response' | 't161_current' | 't161_voltage';

type HistoryEvent = {
  id?: string;
  type: EventType;
  payload: any;
  eventAt: string;
};

type Config = {
  apiUrl: string;
  wsUrl: string;
  historyLimit: number;
};

const CONFIG_KEY = 'rs485_config_v2';

const defaultConfig = (): Config => {
  const host = typeof window === 'undefined' ? 'localhost' : window.location.hostname || 'localhost';
  const proto = typeof window === 'undefined' ? 'http' : window.location.protocol.replace(':', '') || 'http';
  const wsProto = proto === 'https' ? 'wss' : 'ws';
  return {
    apiUrl: `${proto}://${host}:3000`,
    wsUrl: `${wsProto}://${host}:3000/ws`,
    historyLimit: 300,
  };
};

export default function Dashboard() {
  const [config, setConfig] = useState<Config>(defaultConfig);
  const [status, setStatus] = useState<'ok' | 'warn' | 'bad'>('warn');
  const [statusText, setStatusText] = useState('Desconectado');
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [chartData, setChartData] = useState(() => emptyChartData());
  const [lastEvent, setLastEvent] = useState('—');
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(CONFIG_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as Partial<Config>;
      setConfig((prev) => ({ ...prev, ...parsed }));
    } catch {}
  }, []);

  useEffect(() => {
    loadHistory();
  }, [config.apiUrl, config.historyLimit]);

  useEffect(() => {
    connectWs();
    return () => {
      socketRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.wsUrl]);

  const saveConfig = () => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  };

  const connectWs = () => {
    socketRef.current?.close();
    setStatus('warn');
    setStatusText('Conectando...');
    const socket = new WebSocket(config.wsUrl);
    socketRef.current = socket;
    socket.onopen = () => {
      setStatus('ok');
      setStatusText('Conectado');
    };
    socket.onclose = () => {
      setStatus('bad');
      setStatusText('Desconectado');
    };
    socket.onerror = () => {
      setStatus('bad');
      setStatusText('Erro');
    };
    socket.onmessage = (evt) => handleRealtime(evt.data);
  };

  const handleRealtime = (raw: string) => {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg?.type || !msg?.timestamp) return;
    if (msg.type === 'hello') return;

    const event: HistoryEvent = {
      type: msg.type,
      payload: msg.data,
      eventAt: msg.timestamp,
    };
    setHistory((prev) => [event, ...prev].slice(0, config.historyLimit));
    setChartData((prev) => appendToChart(prev, event));
    setLastEvent(`${formatType(msg.type)} às ${formatDate(msg.timestamp)}`);
  };

  const loadHistory = async () => {
    try {
      const url = new URL('/rs485/history', config.apiUrl);
      url.searchParams.set('limit', String(config.historyLimit));
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error('history fetch failed');
      const body = await res.json();
      const rows = Array.isArray(body?.data) ? body.data : [];
      const normalized: HistoryEvent[] = rows.map((row: any) => ({
        id: row.id,
        type: row.type,
        payload: row.payload,
        eventAt: row.eventAt,
      }));
      setHistory(normalized);
      setChartData(buildChartData(normalized));
    } catch (err) {
      console.error(err);
    }
  };

  const clearHistory = async () => {
    setHistory([]);
    setChartData(emptyChartData());
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__dot" />
          <div>
            <div className="brand__title">RS485 Tempo Real</div>
            <div className="brand__subtitle">Monitoramento + Histórico</div>
          </div>
        </div>
        <div className="status">
          <span className={`status__pill status__pill--${status}`}>{statusText}</span>
          <button
            className="btn"
            onClick={() => {
              if (socketRef.current?.readyState === WebSocket.OPEN) {
                socketRef.current?.close();
              } else {
                connectWs();
              }
            }}
          >
            {status === 'ok' ? 'Desconectar' : 'Conectar'}
          </button>
        </div>
      </header>

      <main className="layout">
        <section className="panel">
          <div className="panel__header">
            <h2>Configuração</h2>
            <p>Endereços para o backend e websocket.</p>
          </div>
          <div className="panel__body">
            <label className="field">
              <span>API URL</span>
              <input
                value={config.apiUrl}
                onChange={(e) => setConfig((prev) => ({ ...prev, apiUrl: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>WebSocket URL</span>
              <input
                value={config.wsUrl}
                onChange={(e) => setConfig((prev) => ({ ...prev, wsUrl: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>Limite de histórico</span>
              <input
                type="number"
                min={50}
                max={2000}
                step={50}
                value={config.historyLimit}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, historyLimit: Number(e.target.value) }))
                }
              />
            </label>
            <div className="actions">
              <button className="btn btn--primary" onClick={saveConfig}>
                Salvar
              </button>
              <button className="btn btn--ghost" onClick={clearHistory}>
                Limpar tela
              </button>
              <button className="btn btn--ghost" onClick={loadHistory}>
                Recarregar
              </button>
            </div>
          </div>
        </section>

        <section className="panel panel--wide">
          <div className="panel__header">
            <h2>Métricas em tempo real</h2>
            <p>Gráficos atualizados automaticamente.</p>
          </div>
          <div className="panel__body charts">
            <div className="chart-card">
              <h3>Corrente (T161)</h3>
              <Line data={chartData.current} options={chartOptions('A')} />
            </div>
            <div className="chart-card">
              <h3>Tensão (T161)</h3>
              <Line data={chartData.voltage} options={chartOptions('V')} />
            </div>
          </div>
        </section>

        <section className="panel panel--wide">
          <div className="panel__header">
            <h2>Histórico</h2>
            <p>Eventos recebidos do Postgres.</p>
          </div>
          <div className="panel__body">
            <table className="history">
              <thead>
                <tr>
                  <th>Hora</th>
                  <th>Tipo</th>
                  <th>Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item, idx) => (
                  <tr key={`${item.id ?? idx}-${item.eventAt}`}>
                    <td>{formatDate(item.eventAt)}</td>
                    <td>{formatType(item.type)}</td>
                    <td>{formatDetails(item)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <footer className="footer">
        <span>Último evento: {lastEvent}</span>
      </footer>
    </div>
  );
}

function formatDate(ts: string) {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return date.toLocaleString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatType(type: EventType) {
  if (type === 'request_response') return 'Request';
  if (type === 't161_current') return 'Corrente';
  if (type === 't161_voltage') return 'Tensão';
  return type;
}

function formatDetails(item: HistoryEvent) {
  if (item.type === 'request_response') {
    const res = item.payload?.response ?? {};
    return `Addr ${res.address?.hex ?? '--'} Cmd ${res.command?.hex ?? '--'} Payload ${res.payloadHex ?? '--'}`;
  }
  if (item.type === 't161_current') {
    return `Corrente ${item.payload?.currentA ?? '--'} A`;
  }
  if (item.type === 't161_voltage') {
    return `Tensão ${item.payload?.voltageV ?? '--'} V (${item.payload?.phase ?? '-'})`;
  }
  return '—';
}

function buildChartData(history: HistoryEvent[]) {
  const currentLabels: string[] = [];
  const currentValues: number[] = [];
  const voltageLabels: string[] = [];
  const voltageA: number[] = [];
  const voltageB: number[] = [];
  const voltageC: number[] = [];

  const sorted = [...history].reverse();
  for (const item of sorted) {
    if (item.type === 't161_current') {
      const value = Number(item.payload?.currentA);
      if (Number.isFinite(value)) {
        currentLabels.push(new Date(item.eventAt).toLocaleTimeString('pt-BR'));
        currentValues.push(value);
      }
    }
    if (item.type === 't161_voltage') {
      const value = Number(item.payload?.voltageV);
      if (Number.isFinite(value)) {
        const label = new Date(item.eventAt).toLocaleTimeString('pt-BR');
        voltageLabels.push(label);
        const phase = item.payload?.phase ?? 'A';
        voltageA.push(phase === 'A' ? value : NaN);
        voltageB.push(phase === 'B' ? value : NaN);
        voltageC.push(phase === 'C' ? value : NaN);
      }
    }
  }

  return {
    current: {
      labels: currentLabels.slice(-120),
      datasets: [
        {
          label: 'Corrente (A)',
          data: currentValues.slice(-120),
          borderColor: '#ff6b6b',
          backgroundColor: 'rgba(255, 107, 107, 0.2)',
          tension: 0.2,
        },
      ],
    },
    voltage: {
      labels: voltageLabels.slice(-120),
      datasets: [
        {
          label: 'Fase A (V)',
          data: voltageA.slice(-120),
          borderColor: '#4ecdc4',
          backgroundColor: 'rgba(78, 205, 196, 0.2)',
          tension: 0.2,
          spanGaps: true,
        },
        {
          label: 'Fase B (V)',
          data: voltageB.slice(-120),
          borderColor: '#f8c537',
          backgroundColor: 'rgba(248, 197, 55, 0.2)',
          tension: 0.2,
          spanGaps: true,
        },
        {
          label: 'Fase C (V)',
          data: voltageC.slice(-120),
          borderColor: '#6c8cff',
          backgroundColor: 'rgba(108, 140, 255, 0.2)',
          tension: 0.2,
          spanGaps: true,
        },
      ],
    },
  };
}

function chartOptions(unit: string) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    scales: {
      x: {
        ticks: { maxTicksLimit: 8 },
      },
      y: {
        title: { display: true, text: unit },
      },
    },
    plugins: {
      legend: { display: true },
    },
  };
}

function emptyChartData() {
  return {
    current: {
      labels: [] as string[],
      datasets: [
        {
          label: 'Corrente (A)',
          data: [] as number[],
          borderColor: '#ff6b6b',
          backgroundColor: 'rgba(255, 107, 107, 0.2)',
          tension: 0.2,
        },
      ],
    },
    voltage: {
      labels: [] as string[],
      datasets: [
        {
          label: 'Fase A (V)',
          data: [] as number[],
          borderColor: '#4ecdc4',
          backgroundColor: 'rgba(78, 205, 196, 0.2)',
          tension: 0.2,
          spanGaps: true,
        },
        {
          label: 'Fase B (V)',
          data: [] as number[],
          borderColor: '#f8c537',
          backgroundColor: 'rgba(248, 197, 55, 0.2)',
          tension: 0.2,
          spanGaps: true,
        },
        {
          label: 'Fase C (V)',
          data: [] as number[],
          borderColor: '#6c8cff',
          backgroundColor: 'rgba(108, 140, 255, 0.2)',
          tension: 0.2,
          spanGaps: true,
        },
      ],
    },
  };
}

function appendToChart(currentData: ReturnType<typeof emptyChartData>, event: HistoryEvent) {
  const maxPoints = 120;
  const next = {
    current: {
      labels: [...currentData.current.labels],
      datasets: currentData.current.datasets.map((ds) => ({ ...ds, data: [...ds.data] })),
    },
    voltage: {
      labels: [...currentData.voltage.labels],
      datasets: currentData.voltage.datasets.map((ds) => ({ ...ds, data: [...ds.data] })),
    },
  };

  if (event.type === 't161_current') {
    const value = Number(event.payload?.currentA);
    if (Number.isFinite(value)) {
      next.current.labels.push(new Date(event.eventAt).toLocaleTimeString('pt-BR'));
      next.current.datasets[0].data.push(value);
    }
  }

  if (event.type === 't161_voltage') {
    const value = Number(event.payload?.voltageV);
    if (Number.isFinite(value)) {
      const label = new Date(event.eventAt).toLocaleTimeString('pt-BR');
      next.voltage.labels.push(label);
      const phase = event.payload?.phase ?? 'A';
      const a = next.voltage.datasets[0].data;
      const b = next.voltage.datasets[1].data;
      const c = next.voltage.datasets[2].data;
      a.push(phase === 'A' ? value : NaN);
      b.push(phase === 'B' ? value : NaN);
      c.push(phase === 'C' ? value : NaN);
    }
  }

  if (next.current.labels.length > maxPoints) {
    next.current.labels = next.current.labels.slice(-maxPoints);
    next.current.datasets[0].data = next.current.datasets[0].data.slice(-maxPoints);
  }

  if (next.voltage.labels.length > maxPoints) {
    next.voltage.labels = next.voltage.labels.slice(-maxPoints);
    for (const ds of next.voltage.datasets) {
      ds.data = ds.data.slice(-maxPoints);
    }
  }

  return next;
}
