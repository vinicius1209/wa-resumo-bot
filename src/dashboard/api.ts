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
import { ConversationService } from '../services/conversation-service';
import { ProjectTriageService } from '../triage/project-triage-service';
import { CommandContext } from '../types';
import { config } from '../config';
import { getConnectedClients } from './websocket';

export interface DashboardServices {
  analyticsService: AnalyticsService;
  dynamicConfigService: DynamicConfigService;
  commandHandler?: CommandHandler;
  storage?: SQLiteStorage;
  conversationService?: ConversationService;
  triageService?: ProjectTriageService;
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
      conversation_enabled: String(config.conversation.enabled),
      conversation_dm_enabled: String(config.conversation.dmEnabled),
      triage_enabled: String(config.triage.enabled),
      podcast_enabled: String(config.podcast.enabled),
      media_enabled: String(config.media.enabled),
      word_of_day_auto: String(config.wordOfDay.autoSend),
      sentiment_auto_react: String(config.sentiment.autoReact),
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
  // Conversations (viewer)
  // ============================================

  const { commandHandler, storage, conversationService } = opts.services;

  if (conversationService) {
    fastify.get('/api/conversations', async (request: FastifyRequest, _reply: FastifyReply) => {
      const query = request.query as { groupId?: string; limit?: string; offset?: string };
      const limit = Math.min(parseInt(query.limit || '50', 10), 200);
      const offset = parseInt(query.offset || '0', 10);
      const sessions = conversationService.listSessions(query.groupId || undefined, limit, offset);

      // Enriquecer com nome do grupo
      return sessions.map((s) => {
        const groupSettings = dynamicConfigService.getGroupSettings(s.groupId);
        return {
          ...s,
          groupName: groupSettings?.group_name || s.groupId,
        };
      });
    });

    fastify.get('/api/conversations/:sessionId', async (request: FastifyRequest, reply: FastifyReply) => {
      const { sessionId } = request.params as { sessionId: string };
      const session = conversationService.getSession(sessionId);
      if (!session) {
        return reply.status(404).send({ error: 'Sessão não encontrada' });
      }
      const groupSettings = dynamicConfigService.getGroupSettings(session.groupId);
      return {
        ...session,
        groupName: groupSettings?.group_name || session.groupId,
      };
    });
  }

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

      const audioEntries: { base64: string; durationSeconds: number }[] = [];
      const silentReplyAudio = async (audio: Buffer, durationSeconds: number) => {
        audioEntries.push({ base64: audio.toString('base64'), durationSeconds });
      };

      const ctx: CommandContext = {
        groupId: id,
        senderId: 'dashboard-admin',
        senderName: 'Dashboard',
        args: args || '',
        reply: silentReply,
        replyAudio: silentReplyAudio,
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
              const lastAudio = audioEntries.length > 0 ? audioEntries[audioEntries.length - 1] : null;
              storage.saveChatEntry(id, 'bot', botContent || 'Sem resposta.', command, args || '', lastAudio?.base64, lastAudio?.durationSeconds);
            } catch { /* log silencioso — não impacta o usuário */ }
          });
        }

        const lastAudio = audioEntries.length > 0 ? audioEntries[audioEntries.length - 1] : undefined;
        return { command: cmd.name, replies, audio: lastAudio };
      } catch (err) {
        return reply.status(500).send({
          error: 'Erro ao executar comando',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  // ============================================
  // Triage — Project Management
  // ============================================

  const { triageService } = opts.services;

  if (triageService) {
    // GET /api/triage/projects — lista todos os projetos
    fastify.get('/api/triage/projects', async (_request: FastifyRequest, _reply: FastifyReply) => {
      return triageService.getAllProjects();
    });

    // GET /api/triage/projects/:id — retorna um projeto ou 404
    fastify.get('/api/triage/projects/:id', async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const project = triageService.getProject(id);
      if (!project) {
        return reply.status(404).send({ error: 'Projeto não encontrado' });
      }
      return project;
    });

    // POST /api/triage/projects — cria projeto; gera slug a partir do nome
    fastify.post('/api/triage/projects', async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        name?: string;
        contacts?: string[];
        boards?: import('../triage/types').ProjectBoardConfig[];
        repoUrl?: string;
        context?: string;
      };

      if (!body.name || body.name.trim().length === 0) {
        return reply.status(400).send({ error: 'Campo "name" é obrigatório' });
      }

      const slug = body.name
        .trim()
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_]+/g, '-')
        .replace(/^-+|-+$/g, '');

      const id = slug || Date.now().toString();

      triageService.addProject({
        id,
        name: body.name.trim(),
        contacts: body.contacts ?? [],
        boards: body.boards ?? [],
        repoUrl: body.repoUrl,
        context: body.context,
      });

      return { ok: true, id };
    });

    // PUT /api/triage/projects/:id — atualiza campos de um projeto
    fastify.put('/api/triage/projects/:id', async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as Partial<import('../triage/types').ProjectConfig>;

      try {
        triageService.updateProject(id, body);
      } catch (err) {
        return reply.status(404).send({
          error: err instanceof Error ? err.message : 'Projeto não encontrado',
        });
      }

      return { ok: true };
    });

    // DELETE /api/triage/projects/:id — remove projeto e seus itens
    fastify.delete('/api/triage/projects/:id', async (request: FastifyRequest, _reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      triageService.removeProject(id);
      return { ok: true };
    });

    // GET /api/triage/projects/:id/items — lista itens de triage com paginação
    fastify.get('/api/triage/projects/:id/items', async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const query = request.query as { limit?: string; offset?: string };
      const limit = Math.min(parseInt(query.limit || '50', 10), 200);
      const offset = parseInt(query.offset || '0', 10);

      const project = triageService.getProject(id);
      if (!project) {
        return reply.status(404).send({ error: 'Projeto não encontrado' });
      }

      return triageService.getTriageItems(id, limit, offset);
    });

    // GET /api/triage/contacts — lista todos os contatos mapeados em projetos
    fastify.get('/api/triage/contacts', async (_request: FastifyRequest, _reply: FastifyReply) => {
      const projects = triageService.getAllProjects();
      const seen = new Set<string>();
      const contacts: { jid: string; projectId: string; projectName: string }[] = [];

      for (const project of projects) {
        for (const jid of project.contacts) {
          if (!seen.has(jid)) {
            seen.add(jid);
            contacts.push({ jid, projectId: project.id, projectName: project.name });
          }
        }
      }

      return contacts;
    });
  }
}
