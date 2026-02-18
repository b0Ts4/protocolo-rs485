import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';

type RealtimeEvent = {
  type: 'request_response' | 't161_current' | 't161_voltage';
  timestamp: string;
  data: unknown;
};

export class RealtimeHub {
  private readonly wss: WebSocketServer;
  private readonly clients = new Set<WebSocket>();

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (socket) => {
      this.clients.add(socket);
      socket.on('close', () => this.clients.delete(socket));
      socket.on('error', () => this.clients.delete(socket));
      socket.send(
        JSON.stringify({
          type: 'hello',
          timestamp: new Date().toISOString(),
          data: { message: 'connected' },
        })
      );
    });
  }

  broadcast(event: RealtimeEvent): void {
    const payload = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      client.send(payload);
    }
  }
}
