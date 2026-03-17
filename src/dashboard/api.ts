/**
 * Dashboard API — Rotas REST para monitoramento e gestão do bot.
 *
 * Plugin Fastify que registra todas as rotas /api/*.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AnalyticsService } from '../services/analytics-service';
import { DynamicConfigService } from '../services/dynamic-config-service';
import { SQLiteStorage } from '../storage/sqlite-storage';
import { CommandHandler } from '../commands/command-handler';
import { CommandContext } from '../types';
import { config } from '../config';
import { getConnectedClients } from './websocket';

export interface DashboardServices {
  analyticsService: AnalyticsService;
  dynamicConfigService: DynamicConfigService;
  commandHandler?: CommandHandler;
  storage?: SQLiteStorage;
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
    // Merge .env defaults with dynamic overrides
    const defaults: Record<string, string> = {
      LLM_PROVIDER: config.llm.provider,
      OPENAI_MODEL: config.llm.openai.model,
      ANTHROPIC_MODEL: config.llm.anthropic.model,
      SUMMARY_MAX_MESSAGES: String(config.summary.maxMessages),
      SUMMARY_LANGUAGE: config.summary.language,
      BOT_NAME: config.bot.name,
      COMMAND_PREFIX: config.bot.commandPrefix,
      RATE_LIMIT_MAX_REQUESTS: String(config.rateLimit.maxRequests),
      RATE_LIMIT_WINDOW_SECONDS: String(config.rateLimit.windowSeconds),
      MEDIA_PROCESSING_ENABLED: String(config.media.enabled),
      MEDIA_MAX_SIZE_MB: String(config.media.maxSizeMB),
      DASHBOARD_PORT: String(config.dashboard.port),
    };
    const overrides = dynamicConfigService.getAll();
    return { ...defaults, ...overrides };
  });

  fastify.put('/api/config', async (request: FastifyRequest, _reply: FastifyReply) => {
    const body = request.body as Record<string, string>;
    for (const [key, value] of Object.entries(body)) {
      dynamicConfigService.set(key, value);
    }
    return { ok: true };
  });

  // ============================================
  // Silent Command Execution
  // ============================================

  const { commandHandler, storage } = opts.services;

  // ============================================
  // Chat History (persistent, no purge)
  // ============================================

  if (storage) {
    fastify.get('/api/groups/:id/chat-history', async (request: FastifyRequest, _reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const query = request.query as { limit?: string; offset?: string };
      const limit = Math.min(parseInt(query.limit || '100', 10), 500);
      const offset = parseInt(query.offset || '0', 10);
      return storage.getChatHistory(id, limit, offset);
    });

    fastify.delete('/api/groups/:id/chat-history', async (request: FastifyRequest, _reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const deleted = storage.clearChatHistory(id);
      return { ok: true, deleted };
    });
  }

  // ============================================
  // Silent Command Execution
  // ============================================

  if (commandHandler) {
    fastify.get('/api/commands', async (_request: FastifyRequest, _reply: FastifyReply) => {
      return commandHandler.getUniqueCommands().map((cmd) => ({
        name: cmd.name,
        aliases: cmd.aliases,
        description: cmd.description,
      }));
    });

    fastify.post('/api/groups/:id/command', async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { command, args } = request.body as { command: string; args?: string };

      if (!command) {
        return reply.status(400).send({ error: 'Campo "command" é obrigatório' });
      }

      const cmd = commandHandler.getCommand(command);
      if (!cmd) {
        return reply.status(404).send({ error: `Comando "${command}" não encontrado` });
      }

      const replies: string[] = [];
      const silentReply = async (text: string) => { replies.push(text); };

      const ctx: CommandContext = {
        groupId: id,
        senderId: 'dashboard-admin',
        senderName: 'Dashboard',
        args: args || '',
        reply: silentReply,
      };

      try {
        await cmd.execute(ctx);

        // Fire-and-forget: persiste no next tick para não bloquear o response
        if (storage) {
          const userInput = args ? `/${command} ${args}` : `/${command}`;
          const botContent = replies.join('\n\n');
          setImmediate(() => {
            try {
              storage.saveChatEntry(id, 'user', userInput, command, args || '');
              storage.saveChatEntry(id, 'bot', botContent || 'Sem resposta.', command, args || '');
            } catch { /* log silencioso — não impacta o usuário */ }
          });
        }

        return { command: cmd.name, replies };
      } catch (err) {
        return reply.status(500).send({
          error: 'Erro ao executar comando',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }
}
