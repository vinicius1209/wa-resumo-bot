/**
 * ConversationService — gerencia sessões de conversa multi-turn.
 *
 * Sessões são keyed por (groupId, senderId), com TTL configurável.
 * Contexto do grupo (mensagens recentes, sentimento) é injetado como grounding.
 */
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { ILLMProvider, IMessageStorage, LLMChatMessage } from '../types';
import { config } from '../config';
import { buildConversationSystemPrompt } from '../llm/conversation-prompt';
import { formatMessagesForLLM } from '../llm/base-prompt';
import { SentimentService } from './sentiment-service';
import { AnalyticsService } from './analytics-service';
import { eventBus } from './event-bus';
import pino from 'pino';

const logger = pino({ level: config.logLevel });

interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface ConversationSession {
  sessionId: string;
  groupId: string;
  senderId: string;
  senderName: string;
  turns: ConversationTurn[];
  contextSnapshot?: string;
  contextBuiltAt?: number;
  createdAt: number;
  lastActivity: number;
}

const CONTEXT_STALE_MS = 10 * 60 * 1000; // 10 min
const CONTEXT_MESSAGES = 50;

export class ConversationService {
  private sessions = new Map<string, ConversationSession>();
  private db!: Database.Database;
  private stmts!: {
    upsert: Database.Statement;
    load: Database.Statement;
    delete: Database.Statement;
    purge: Database.Statement;
    listByGroup: Database.Statement;
    getById: Database.Statement;
    listAll: Database.Statement;
  };

  constructor(
    private storage: IMessageStorage,
    private llmProvider: ILLMProvider,
    private sentimentService: SentimentService,
    private analytics: AnalyticsService,
  ) {}

  initTable(db: Database.Database): void {
    this.db = db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_sessions (
        session_id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        sender_name TEXT,
        turns_json TEXT NOT NULL DEFAULT '[]',
        context_snapshot TEXT,
        created_at INTEGER DEFAULT (unixepoch()),
        last_activity INTEGER DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_conv_group_sender
        ON conversation_sessions(group_id, sender_id);
      CREATE INDEX IF NOT EXISTS idx_conv_activity
        ON conversation_sessions(last_activity);
    `);

    this.stmts = {
      upsert: db.prepare(`
        INSERT INTO conversation_sessions (session_id, group_id, sender_id, sender_name, turns_json, context_snapshot, created_at, last_activity)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          turns_json = excluded.turns_json,
          context_snapshot = excluded.context_snapshot,
          last_activity = excluded.last_activity
      `),
      load: db.prepare(`
        SELECT * FROM conversation_sessions
        WHERE group_id = ? AND sender_id = ?
        ORDER BY last_activity DESC LIMIT 1
      `),
      delete: db.prepare('DELETE FROM conversation_sessions WHERE session_id = ?'),
      purge: db.prepare('DELETE FROM conversation_sessions WHERE last_activity < ?'),
      listByGroup: db.prepare(`
        SELECT session_id, group_id, sender_id, sender_name, turns_json, created_at, last_activity
        FROM conversation_sessions
        WHERE (? IS NULL OR group_id = ?)
        ORDER BY last_activity DESC
        LIMIT ? OFFSET ?
      `),
      getById: db.prepare('SELECT * FROM conversation_sessions WHERE session_id = ?'),
      listAll: db.prepare(`
        SELECT session_id, group_id, sender_id, sender_name, turns_json, created_at, last_activity
        FROM conversation_sessions
        ORDER BY last_activity DESC
        LIMIT ? OFFSET ?
      `),
    };
  }

  /**
   * Processa uma mensagem conversacional.
   */
  async handleConversation(
    groupId: string,
    senderId: string,
    senderName: string,
    userMessage: string,
    reply: (text: string) => Promise<void>,
  ): Promise<void> {
    if (!this.llmProvider.chat) {
      await reply('O modo conversacional não está disponível com o provider LLM atual.');
      return;
    }

    const startMs = Date.now();
    const sessionKey = `${groupId}:${senderId}`;

    try {
      // 1. Obter ou criar sessão
      let session = this.getActiveSession(sessionKey, groupId, senderId, senderName);

      // 2. Construir contexto se necessário
      if (!session.contextSnapshot || this.isContextStale(session)) {
        session.contextSnapshot = await this.buildContext(groupId);
        session.contextBuiltAt = Date.now();
      }

      // 3. Adicionar turn do usuário
      session.turns.push({
        role: 'user',
        content: userMessage,
        timestamp: Math.floor(Date.now() / 1000),
      });

      // 4. Montar mensagens para LLM
      const messages = this.buildLLMMessages(session);

      // 5. Chamar LLM
      const response = await this.llmProvider.chat({
        messages,
        temperature: config.conversation.temperature,
        maxTokens: config.conversation.maxTokens,
      });

      // 6. Adicionar resposta à sessão
      session.turns.push({
        role: 'assistant',
        content: response.content,
        timestamp: Math.floor(Date.now() / 1000),
      });

      // 7. Trimmar se necessário
      session = this.trimSession(session);
      session.lastActivity = Math.floor(Date.now() / 1000);

      // 8. Persistir
      this.sessions.set(sessionKey, session);
      this.persistSession(session);

      // 9. Tracking
      const durationMs = Date.now() - startMs;
      this.analytics.track({
        eventType: 'conversation',
        groupId,
        senderId,
        provider: response.provider,
        model: response.model,
        tokensInput: response.tokensUsed.input,
        tokensOutput: response.tokensUsed.output,
        durationMs,
        success: true,
        metadata: { turns: session.turns.length, sessionId: session.sessionId },
      });

      eventBus.emitConversation(groupId, senderName, durationMs, true);
      eventBus.emitLLMCall(
        response.provider, response.model,
        response.tokensUsed.input, response.tokensUsed.output,
        0, durationMs,
      );

      // 10. Responder
      await reply(response.content);
    } catch (error) {
      const durationMs = Date.now() - startMs;
      logger.error({ error, groupId, senderId }, 'Erro na conversa');

      this.analytics.track({
        eventType: 'conversation',
        groupId,
        senderId,
        durationMs,
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });

      eventBus.emitConversation(groupId, senderName, durationMs, false);
      await reply('Desculpe, ocorreu um erro ao processar sua mensagem.');
    }
  }

  /**
   * Obtém sessão ativa ou cria uma nova.
   */
  private getActiveSession(
    key: string,
    groupId: string,
    senderId: string,
    senderName: string,
  ): ConversationSession {
    const ttlSeconds = config.conversation.sessionTtlMinutes * 60;
    const now = Math.floor(Date.now() / 1000);

    // Tentar cache
    const cached = this.sessions.get(key);
    if (cached && (now - cached.lastActivity) < ttlSeconds) {
      return cached;
    }

    // Tentar SQLite
    const row = this.stmts.load.get(groupId, senderId) as {
      session_id: string;
      turns_json: string;
      context_snapshot: string | null;
      created_at: number;
      last_activity: number;
    } | undefined;

    if (row && (now - row.last_activity) < ttlSeconds) {
      const session: ConversationSession = {
        sessionId: row.session_id,
        groupId,
        senderId,
        senderName,
        turns: JSON.parse(row.turns_json),
        contextSnapshot: row.context_snapshot ?? undefined,
        createdAt: row.created_at,
        lastActivity: row.last_activity,
      };
      this.sessions.set(key, session);
      return session;
    }

    // Nova sessão
    const session: ConversationSession = {
      sessionId: randomUUID(),
      groupId,
      senderId,
      senderName,
      turns: [],
      createdAt: now,
      lastActivity: now,
    };
    this.sessions.set(key, session);
    return session;
  }

  /**
   * Constrói contexto do grupo (mensagens recentes + sentimento).
   */
  private async buildContext(groupId: string): Promise<string> {
    const parts: string[] = [];

    // Mensagens recentes
    try {
      const messages = await this.storage.getMessages(groupId, CONTEXT_MESSAGES);
      if (messages.length > 0) {
        const formatted = formatMessagesForLLM(messages);
        parts.push(`### Mensagens recentes (${messages.length}):\n${formatted}`);
      } else {
        parts.push('### Sem mensagens recentes neste grupo.');
      }
    } catch (error) {
      logger.warn({ error, groupId }, 'Erro ao buscar mensagens para contexto');
      parts.push('### Mensagens recentes: indisponível.');
    }

    // Sentimento
    try {
      const temp = this.sentimentService.getTemperature(groupId);
      parts.push(`### Clima do grupo: ${temp.label} (score: ${temp.score})`);
    } catch {
      // Sentimento não é crítico
    }

    return parts.join('\n\n');
  }

  /**
   * Monta o array de mensagens para a API do LLM.
   */
  private buildLLMMessages(session: ConversationSession): LLMChatMessage[] {
    const systemPrompt = buildConversationSystemPrompt(session.contextSnapshot || '');

    const messages: LLMChatMessage[] = [
      { role: 'system', content: systemPrompt },
    ];

    for (const turn of session.turns) {
      messages.push({ role: turn.role, content: turn.content });
    }

    return messages;
  }

  /**
   * Limita o número de turns mantendo os primeiros 2 e os últimos N.
   */
  private trimSession(session: ConversationSession): ConversationSession {
    const maxTurns = config.conversation.maxTurns;
    if (session.turns.length <= maxTurns) return session;

    const keep = maxTurns - 2;
    session.turns = [
      ...session.turns.slice(0, 2),
      ...session.turns.slice(-keep),
    ];
    return session;
  }

  private isContextStale(session: ConversationSession): boolean {
    if (!session.contextBuiltAt) return true;
    return (Date.now() - session.contextBuiltAt) > CONTEXT_STALE_MS;
  }

  private persistSession(session: ConversationSession): void {
    try {
      this.stmts.upsert.run(
        session.sessionId,
        session.groupId,
        session.senderId,
        session.senderName,
        JSON.stringify(session.turns),
        session.contextSnapshot ?? null,
        session.createdAt,
        session.lastActivity,
      );
    } catch (error) {
      logger.error({ error, sessionId: session.sessionId }, 'Erro ao persistir sessão');
    }
  }

  /**
   * Remove sessões expiradas do cache e do SQLite.
   */
  cleanup(): void {
    const ttlSeconds = config.conversation.sessionTtlMinutes * 60;
    const cutoff = Math.floor(Date.now() / 1000) - ttlSeconds;

    // Cache
    for (const [key, session] of this.sessions) {
      if (session.lastActivity < cutoff) {
        this.sessions.delete(key);
      }
    }

    // SQLite
    try {
      const result = this.stmts.purge.run(cutoff);
      if (result.changes > 0) {
        logger.info({ purged: result.changes }, 'Sessões de conversa expiradas removidas');
      }
    } catch (error) {
      logger.error({ error }, 'Erro ao limpar sessões expiradas');
    }
  }

  // ============================================
  // API para Dashboard
  // ============================================

  /**
   * Lista sessões com paginação.
   */
  listSessions(groupId?: string, limit = 50, offset = 0): Array<{
    sessionId: string;
    groupId: string;
    senderId: string;
    senderName: string;
    turnsCount: number;
    createdAt: number;
    lastActivity: number;
    status: 'active' | 'expired';
  }> {
    const ttlSeconds = config.conversation.sessionTtlMinutes * 60;
    const now = Math.floor(Date.now() / 1000);

    const rows = groupId
      ? this.stmts.listByGroup.all(groupId, groupId, limit, offset) as Array<Record<string, unknown>>
      : this.stmts.listAll.all(limit, offset) as Array<Record<string, unknown>>;

    return rows.map((row) => {
      const turns = JSON.parse(row.turns_json as string) as ConversationTurn[];
      const lastActivity = row.last_activity as number;
      return {
        sessionId: row.session_id as string,
        groupId: row.group_id as string,
        senderId: row.sender_id as string,
        senderName: row.sender_name as string,
        turnsCount: turns.length,
        createdAt: row.created_at as number,
        lastActivity,
        status: (now - lastActivity) < ttlSeconds ? 'active' as const : 'expired' as const,
      };
    });
  }

  /**
   * Obtém uma sessão completa por ID.
   */
  getSession(sessionId: string): {
    sessionId: string;
    groupId: string;
    senderId: string;
    senderName: string;
    turns: ConversationTurn[];
    contextSnapshot: string | null;
    createdAt: number;
    lastActivity: number;
  } | null {
    const row = this.stmts.getById.get(sessionId) as Record<string, unknown> | undefined;
    if (!row) return null;

    return {
      sessionId: row.session_id as string,
      groupId: row.group_id as string,
      senderId: row.sender_id as string,
      senderName: row.sender_name as string,
      turns: JSON.parse(row.turns_json as string),
      contextSnapshot: row.context_snapshot as string | null,
      createdAt: row.created_at as number,
      lastActivity: row.last_activity as number,
    };
  }
}
