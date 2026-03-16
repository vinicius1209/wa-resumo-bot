/**
 * Dashboard API — Rotas REST para monitoramento e gestão do bot.
 *
 * Plugin Fastify que registra todas as rotas /api/*.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AnalyticsService } from '../services/analytics-service';
import { DynamicConfigService } from '../services/dynamic-config-service';
import { getConnectedClients } from './websocket';

export interface DashboardServices {
  analyticsService: AnalyticsService;
  dynamicConfigService: DynamicConfigService;
}

export async function apiRoutes(
  fastify: FastifyInstance,
  opts: { services: DashboardServices }
): Promise<void> {
  const { analyticsService, dynamicConfigService } = opts.services;

  // ============================================
  // Status
  // ============================================

  fastify.get('/api/status', async (_request: FastifyRequest, _reply: FastifyReply) => {
    const groups = dynamicConfigService.getAllGroups();
    return {
      online: true,
      uptime: process.uptime(),
      groups: groups.length,
      wsClients: getConnectedClients(),
    };
  });

  // ============================================
  // Analytics
  // ============================================

  fastify.get('/api/analytics/daily', async (_request: FastifyRequest, _reply: FastifyReply) => {
    return analyticsService.getDailyUsage();
  });

  fastify.get('/api/analytics/weekly', async (_request: FastifyRequest, _reply: FastifyReply) => {
    return analyticsService.getWeeklyCost();
  });

  fastify.get('/api/analytics/hourly', async (_request: FastifyRequest, _reply: FastifyReply) => {
    return analyticsService.getHourlyUsage();
  });

  fastify.get('/api/analytics/daily-costs', async (_request: FastifyRequest, _reply: FastifyReply) => {
    return analyticsService.getDailyCosts();
  });

  // ============================================
  // Groups
  // ============================================

  fastify.get('/api/groups', async (_request: FastifyRequest, _reply: FastifyReply) => {
    return dynamicConfigService.getAllGroups();
  });

  fastify.get('/api/groups/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const settings = dynamicConfigService.getGroupSettings(id);
    if (!settings) {
      return reply.status(404).send({ error: 'Group not found' });
    }
    return settings;
  });

  fastify.put('/api/groups/:id', async (request: FastifyRequest, _reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    dynamicConfigService.updateGroupSettings(id, body);
    return { ok: true };
  });

  fastify.put('/api/groups/:id/allow', async (request: FastifyRequest, _reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    dynamicConfigService.setGroupAllowed(id, true);
    return { ok: true };
  });

  fastify.put('/api/groups/:id/block', async (request: FastifyRequest, _reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    dynamicConfigService.setGroupAllowed(id, false);
    return { ok: true };
  });

  fastify.put('/api/groups/:id/features', async (request: FastifyRequest, _reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, boolean>;
    for (const [feature, enabled] of Object.entries(body)) {
      dynamicConfigService.setFeatureEnabled(id, feature, enabled);
    }
    return { ok: true };
  });

  // ============================================
  // Config
  // ============================================

  fastify.get('/api/config', async (_request: FastifyRequest, _reply: FastifyReply) => {
    return dynamicConfigService.getAll();
  });

  fastify.put('/api/config', async (request: FastifyRequest, _reply: FastifyReply) => {
    const body = request.body as Record<string, string>;
    for (const [key, value] of Object.entries(body)) {
      dynamicConfigService.set(key, value);
    }
    return { ok: true };
  });
}
