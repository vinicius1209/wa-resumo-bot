/**
 * Serviço de Curadoria de Links — detecta, armazena e consulta URLs compartilhadas.
 *
 * Responsabilidades:
 * - Extrair URLs de mensagens
 * - Buscar título das páginas via fetch
 * - Categorizar por domínio
 * - Persistir e consultar links por grupo
 */
import Database from 'better-sqlite3';
import pino from 'pino';
import { config } from '../config';

const logger = pino({ level: config.logLevel });

export interface StoredLink {
  id: number;
  groupId: string;
  url: string;
  title: string | null;
  category: string;
  sharedById: string;
  sharedByName: string;
  timestamp: number;
  sourceMessageId: string | null;
}

// Mapeamento domínio → categoria
const DOMAIN_CATEGORIES: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /(?:youtube\.com|youtu\.be)/i, category: 'vídeo' },
  { pattern: /(?:instagram\.com|twitter\.com|x\.com)/i, category: 'social' },
  { pattern: /github\.com/i, category: 'dev' },
  { pattern: /(?:g1\.com\.br|uol\.com\.br|folha)/i, category: 'notícia' },
];

export class LinkService {
  private db: Database.Database | null = null;

  /**
   * Inicializa a tabela de links. Deve ser chamado após o storage.init().
   */
  initTable(db: Database.Database): void {
    this.db = db;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id TEXT NOT NULL,
        url TEXT NOT NULL,
        title TEXT,
        category TEXT,
        shared_by_id TEXT NOT NULL,
        shared_by_name TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        source_message_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_links_group
        ON links(group_id, timestamp DESC);
    `);

    logger.debug('LinkService: tabela inicializada');
  }

  /**
   * Extrai URLs http/https de um texto.
   */
  extractUrls(text: string): string[] {
    const regex = /https?:\/\/[^\s<>"')\]},]+/gi;
    const matches = text.match(regex);
    if (!matches) return [];

    // Remover pontuação final que não faz parte da URL
    return matches.map((url) => url.replace(/[.,;:!?)]+$/, ''));
  }

  /**
   * Processa e salva um link encontrado numa mensagem.
   * Busca título e categoriza de forma assíncrona (fire-and-forget friendly).
   */
  async processLink(
    groupId: string,
    url: string,
    sharedById: string,
    sharedByName: string,
    timestamp: number,
    messageId: string | null
  ): Promise<void> {
    if (!this.db) return;

    try {
      // 1. Categorizar pelo domínio
      const category = this.categorize(url);

      // 2. Inserir registro inicial
      const stmt = this.db.prepare(`
        INSERT INTO links
          (group_id, url, category, shared_by_id, shared_by_name, timestamp, source_message_id)
        VALUES
          (?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        groupId,
        url,
        category,
        sharedById,
        sharedByName,
        timestamp,
        messageId ?? null
      );

      const linkId = result.lastInsertRowid;

      // 3. Tentar buscar título da página
      const title = await this.fetchTitle(url);
      if (title && linkId) {
        const updateStmt = this.db.prepare(
          'UPDATE links SET title = ? WHERE id = ?'
        );
        updateStmt.run(title, linkId);
      }

      logger.debug({ url, category, title }, 'LinkService: link processado');
    } catch (error) {
      logger.warn({ error, url }, 'LinkService: erro ao processar link');
    }
  }

  /**
   * Retorna os últimos N links de um grupo.
   */
  getLinks(groupId: string, limit: number = 10): StoredLink[] {
    if (!this.db) return [];

    const stmt = this.db.prepare(`
      SELECT * FROM links
      WHERE group_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    const rows = stmt.all(groupId, limit) as any[];
    return rows.map(this.rowToLink);
  }

  /**
   * Retorna links de um grupo num intervalo de tempo.
   */
  getLinksByPeriod(
    groupId: string,
    fromTimestamp: number,
    toTimestamp: number
  ): StoredLink[] {
    if (!this.db) return [];

    const stmt = this.db.prepare(`
      SELECT * FROM links
      WHERE group_id = ?
        AND timestamp >= ?
        AND timestamp <= ?
      ORDER BY timestamp DESC
    `);

    const rows = stmt.all(groupId, fromTimestamp, toTimestamp) as any[];
    return rows.map(this.rowToLink);
  }

  /**
   * Retorna links de um grupo filtrados por categoria.
   */
  getLinksByCategory(groupId: string, category: string, limit: number = 10): StoredLink[] {
    if (!this.db) return [];

    const stmt = this.db.prepare(`
      SELECT * FROM links
      WHERE group_id = ?
        AND category = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    const rows = stmt.all(groupId, category, limit) as any[];
    return rows.map(this.rowToLink);
  }

  /**
   * Categoriza uma URL com base no domínio.
   */
  private categorize(url: string): string {
    for (const { pattern, category } of DOMAIN_CATEGORIES) {
      if (pattern.test(url)) return category;
    }
    return 'outro';
  }

  /**
   * Busca o título de uma página HTML via fetch (timeout 5s).
   */
  private async fetchTitle(url: string): Promise<string | null> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; WAResumoBot/1.0)',
        },
        redirect: 'follow',
      });

      clearTimeout(timeout);

      if (!response.ok) return null;

      // Ler apenas os primeiros bytes para encontrar o título
      const html = await response.text();
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch && titleMatch[1]) {
        return titleMatch[1].trim().substring(0, 200);
      }

      return null;
    } catch {
      // Timeout, rede, parse — tudo é ignorado graciosamente
      return null;
    }
  }

  private rowToLink(row: any): StoredLink {
    return {
      id: row.id,
      groupId: row.group_id,
      url: row.url,
      title: row.title ?? null,
      category: row.category ?? 'outro',
      sharedById: row.shared_by_id,
      sharedByName: row.shared_by_name,
      timestamp: row.timestamp,
      sourceMessageId: row.source_message_id ?? null,
    };
  }
}
