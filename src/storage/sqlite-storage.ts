/**
 * Implementação de IMessageStorage usando SQLite (better-sqlite3).
 *
 * Zero custo, arquivo local, performático para leitura.
 * O banco é criado automaticamente em ./messages.db
 */
import Database from 'better-sqlite3';
import path from 'path';
import { IMessageStorage, StoredMessage } from '../types';

const DB_PATH = path.resolve(process.cwd(), 'messages.db');

export class SQLiteStorage implements IMessageStorage {
  private db!: Database.Database;

  /** Expõe a conexão para serviços que precisam compartilhar o banco (ex: AnalyticsService). */
  getDatabase(): Database.Database {
    return this.db;
  }

  async init(): Promise<void> {
    this.db = new Database(DB_PATH);

    // WAL mode para melhor performance de leitura concorrente
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        message_type TEXT NOT NULL DEFAULT 'text',
        caption TEXT,
        quoted_message TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_messages_group_ts
        ON messages(group_id, timestamp DESC);

      CREATE INDEX IF NOT EXISTS idx_messages_group_id
        ON messages(group_id);
    `);

    // Migration: adicionar coluna media_description se não existir
    const columns = this.db.pragma('table_info(messages)') as Array<{ name: string }>;
    if (!columns.some((c) => c.name === 'media_description')) {
      this.db.exec('ALTER TABLE messages ADD COLUMN media_description TEXT');
    }
  }

  async save(message: StoredMessage): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO messages
        (id, group_id, sender_id, sender_name, content, timestamp, message_type, caption, quoted_message)
      VALUES
        (@id, @groupId, @senderId, @senderName, @content, @timestamp, @messageType, @caption, @quotedMessage)
    `);

    stmt.run({
      id: message.id,
      groupId: message.groupId,
      senderId: message.senderId,
      senderName: message.senderName,
      content: message.content,
      timestamp: message.timestamp,
      messageType: message.messageType,
      caption: message.caption ?? null,
      quotedMessage: message.quotedMessage ?? null,
    });
  }

  async getMessages(groupId: string, limit: number): Promise<StoredMessage[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM messages
      WHERE group_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    const rows = stmt.all(groupId, limit) as any[];
    return rows.reverse().map(this.rowToMessage);
  }

  async getMessagesByTimeRange(
    groupId: string,
    fromTimestamp: number,
    toTimestamp: number
  ): Promise<StoredMessage[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM messages
      WHERE group_id = ?
        AND timestamp >= ?
        AND timestamp <= ?
      ORDER BY timestamp ASC
    `);

    const rows = stmt.all(groupId, fromTimestamp, toTimestamp) as any[];
    return rows.map(this.rowToMessage);
  }

  async countMessages(groupId: string): Promise<number> {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM messages WHERE group_id = ?
    `);

    const row = stmt.get(groupId) as { count: number };
    return row.count;
  }

  async purgeOlderThan(timestamp: number): Promise<number> {
    const stmt = this.db.prepare(`
      DELETE FROM messages WHERE timestamp < ?
    `);

    const result = stmt.run(timestamp);
    return result.changes;
  }

  async updateMediaDescription(messageId: string, description: string): Promise<void> {
    const stmt = this.db.prepare(
      'UPDATE messages SET media_description = ? WHERE id = ?'
    );
    stmt.run(description, messageId);
  }

  private rowToMessage(row: any): StoredMessage {
    return {
      id: row.id,
      groupId: row.group_id,
      senderId: row.sender_id,
      senderName: row.sender_name,
      content: row.content,
      timestamp: row.timestamp,
      messageType: row.message_type,
      caption: row.caption ?? undefined,
      quotedMessage: row.quoted_message ?? undefined,
      mediaDescription: row.media_description ?? undefined,
    };
  }
}
