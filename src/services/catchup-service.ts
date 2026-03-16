/**
 * Serviço "Resumo para quem chegou tarde" — rastreia atividade dos membros
 * e gera resumos personalizados para quem ficou ausente.
 */
import Database from 'better-sqlite3';
import { IMessageStorage } from '../types';
import { SummaryService } from './summary-service';
import { config } from '../config';
import pino from 'pino';

const logger = pino({ level: config.logLevel });

/** 4 hours in milliseconds */
const RETURNING_THRESHOLD_MS = 4 * 60 * 60 * 1000;

/** Minimum messages required to generate a catch-up summary */
const MIN_MESSAGES_FOR_CATCHUP = 5;

export class CatchupService {
  /** In-memory cooldown: key = `${groupId}:${senderId}`, value = timestamp (ms) */
  private cooldowns: Map<string, number> = new Map();

  private db: Database.Database | null = null;

  /**
   * Initializes the member_activity table.
   */
  initTable(db: Database.Database): void {
    this.db = db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS member_activity (
        group_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        last_message_at INTEGER NOT NULL,
        PRIMARY KEY (group_id, sender_id)
      );
    `);
    logger.info('member_activity table initialized');
  }

  /**
   * Upsert: atualiza o timestamp da última mensagem do membro no grupo.
   */
  updateActivity(groupId: string, senderId: string, timestamp: number): void {
    if (!this.db) return;
    const stmt = this.db.prepare(`
      INSERT INTO member_activity (group_id, sender_id, last_message_at)
      VALUES (?, ?, ?)
      ON CONFLICT(group_id, sender_id) DO UPDATE SET last_message_at = excluded.last_message_at
    `);
    stmt.run(groupId, senderId, timestamp);
  }

  /**
   * Retorna o timestamp da última mensagem do membro, ou null.
   */
  getLastSeen(groupId: string, senderId: string): number | null {
    if (!this.db) return null;
    const row = this.db
      .prepare('SELECT last_message_at FROM member_activity WHERE group_id = ? AND sender_id = ?')
      .get(groupId, senderId) as { last_message_at: number } | undefined;
    return row?.last_message_at ?? null;
  }

  /**
   * Verifica se o membro está "voltando" (ausente por mais de 4h).
   */
  isReturning(groupId: string, senderId: string, currentTimestamp: number): boolean {
    const lastSeen = this.getLastSeen(groupId, senderId);
    if (lastSeen === null) return false;
    return (currentTimestamp - lastSeen) > RETURNING_THRESHOLD_MS / 1000;
  }

  /**
   * Gera um resumo personalizado do que o membro perdeu.
   * Retorna o texto do resumo ou null se não houver mensagens suficientes.
   */
  async generateCatchup(
    groupId: string,
    senderId: string,
    storage: IMessageStorage,
    summaryService: SummaryService
  ): Promise<string | null> {
    const lastSeen = this.getLastSeen(groupId, senderId);
    if (lastSeen === null) return null;

    const now = Math.floor(Date.now() / 1000);
    const messages = await storage.getMessagesByTimeRange(groupId, lastSeen, now);

    if (messages.length < MIN_MESSAGES_FOR_CATCHUP) {
      logger.info(
        { groupId, senderId, messageCount: messages.length },
        'Not enough messages for catch-up summary'
      );
      return null;
    }

    // Calculate hours since lastSeen for the summary service arg
    const diffSeconds = now - lastSeen;
    const hours = Math.max(1, Math.ceil(diffSeconds / 3600));

    const result = await summaryService.generateSummary(groupId, senderId, `${hours}h`);

    if (!result.success) {
      logger.warn({ groupId, senderId, text: result.text }, 'Catch-up summary generation failed');
      return null;
    }

    return result.text;
  }

  /**
   * Verifica se o membro está em cooldown (já recebeu oferta de catch-up recentemente).
   */
  isOnCooldown(groupId: string, senderId: string): boolean {
    const key = `${groupId}:${senderId}`;
    const lastOffered = this.cooldowns.get(key);
    if (lastOffered === undefined) return false;
    return (Date.now() - lastOffered) < RETURNING_THRESHOLD_MS;
  }

  /**
   * Marca que o membro recebeu uma oferta de catch-up.
   */
  setCooldown(groupId: string, senderId: string): void {
    const key = `${groupId}:${senderId}`;
    this.cooldowns.set(key, Date.now());
  }
}
