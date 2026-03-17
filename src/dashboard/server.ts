/**
 * Dashboard Server — Fastify HTTP server para o admin panel.
 *
 * Roda no mesmo processo do bot. Serve a API REST e o frontend estático.
 * Auth via Bearer token simples em todas as rotas /api/*.
 */
import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import path from 'path';
import pino from 'pino';
import { config } from '../config';
import { apiRoutes, DashboardServices } from './api';
import { registerWebSocket } from './websocket';

const logger = pino({ level: config.logLevel });

let server: FastifyInstance | null = null;

/**
 * Inicia o servidor do dashboard.
 */
export async function startDashboard(services: DashboardServices): Promise<void> {
  const { dashboard } = config;

  if (!dashboard.enabled) {
    logger.info('Dashboard desabilitado');
    return;
  }

  if (!dashboard.token || dashboard.token === 'change-me') {
    logger.warn('Dashboard: DASHBOARD_TOKEN não configurado. Defina um token seguro no .env');
  }

  server = Fastify({
    logger: false, // usa o logger do bot
  });

  // CORS
  await server.register(fastifyCors, {
    origin: true,
  });

  // Auth middleware para rotas /api/*
  server.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // Apenas proteger rotas /api/
    if (!request.url.startsWith('/api/')) return;

    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Unauthorized: missing Bearer token' });
    }

    const token = authHeader.slice(7);
    if (token !== dashboard.token) {
      return reply.status(403).send({ error: 'Forbidden: invalid token' });
    }
  });

  // API routes
  await server.register(apiRoutes, { services });

  // WebSocket (real-time events)
  await registerWebSocket(server);

  // Static files (frontend)
  const publicDir = path.join(__dirname, 'public');
  await server.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',
  });

  // SPA fallback — rotas do React Router retornam index.html
  server.setNotFoundHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.url.startsWith('/api/') || request.url.startsWith('/ws')) {
      return reply.status(404).send({ error: 'Not found' });
    }
    return reply.sendFile('index.html');
  });

  // Start
  await server.listen({ port: dashboard.port, host: '0.0.0.0' });
  logger.info({ port: dashboard.port }, '✓ Dashboard admin rodando');
}

/**
 * Para o servidor do dashboard.
 */
export async function stopDashboard(): Promise<void> {
  if (server) {
    await server.close();
    server = null;
    logger.info('Dashboard parado');
  }
}
