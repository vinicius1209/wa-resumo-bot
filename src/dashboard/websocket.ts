/**
 * Dashboard WebSocket — real-time event streaming para o admin panel.
 *
 * Conecta ao EventBus e envia eventos para clientes WebSocket autenticados.
 * Auth via query parameter ?token=DASHBOARD_TOKEN.
 */
import { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { eventBus, BotEvent } from '../services/event-bus';
import { config } from '../config';

let connectedClients = 0;

export function getConnectedClients(): number {
  return connectedClients;
}

export async function registerWebSocket(fastify: FastifyInstance): Promise<void> {
  await fastify.register(websocket);

  fastify.get('/ws', { websocket: true }, (socket, request) => {
    // Auth check
    const url = new URL(request.url, `http://${request.headers.host}`);
    const token = url.searchParams.get('token');
    if (token !== config.dashboard.token) {
      socket.close(4001, 'Unauthorized');
      return;
    }

    connectedClients++;

    const handler = (event: BotEvent) => {
      try {
        socket.send(JSON.stringify(event));
      } catch {
        /* client disconnected */
      }
    };

    eventBus.on('bot:event', handler);

    socket.on('close', () => {
      connectedClients--;
      eventBus.off('bot:event', handler);
    });
  });
}
