/**
 * Serviço de Analytics — coleta e agrega métricas de uso do bot.
 *
 * Camada 1 (Collector): registra eventos de forma fire-and-forget
 * Camada 2 (Aggregator): queries SQL para relatórios
 *
 * O tracking nunca deve bloquear a resposta ao usuário.
 */
import Database from 'better-sqlite3';
import pino from 'pino';
import { config } from '../config';

const logger = pino({ level: config.logLevel });

// Preços por modelo (USD por token)
const PRICING: Record<string, { input: number; output: number } | { perMinute: number }> = {
  'gpt-4o-mini': { input: 0.15 / 1_000_000, output: 0.60 / 1_000_000 },
  'gpt-4o': { input: 2.50 / 1_000_000, output: 10.00 / 1_000_000 },
  'claude-sonnet-4-20250514': { input: 3.00 / 1_000_000, output: 15.00 / 1_000_000 },
  'claude-haiku-4-5-20251001': { input: 0.80 / 1_000_000, output: 4.00 / 1_000_000 },
  'whisper-1': { perMinute: 0.006 },
  'gpt-4.1': { input: 2.00 / 1_000_000, output: 8.00 / 1_000_000 },
  'gpt-4.1-mini': { input: 0.40 / 1_000_000, output: 1.60 / 1_000_000 },
  'gpt-4.1-nano': { input: 0.10 / 1_000_000, output: 0.40 / 1_000_000 },
  'claude-opus-4-20250514': { input: 15.00 / 1_000_000, output: 75.00 / 1_000_000 },
};

export interface AnalyticsEvent {
  eventType: 'command' | 'llm_call' | 'media_process' | 'error';
  groupId?: string;
  senderId?: string;
  commandName?: string;
  provider?: string;
  model?: string;
  tokensInput?: number;
  tokensOutput?: number;
  estimatedCostUsd?: number;
  durationMs?: number;
  success?: boolean;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export interface DailyUsage {
  totalCommands: number;
  commandBreakdown: Record<string, number>;
  mediaProcessed: { total: number; image: number; audio: number; video: number };
  totalTokens: { input: number; output: number };
  estimatedCost: number;
  avgDurationMs: number;
  errors: number;
}

export interface WeeklyCost {
  totalCost: number;
  byProvider: Record<string, number>;
  byModel: Record<string, number>;
  totalTokens: { input: number; output: number };
}

export class AnalyticsService {
  private db: Database.Database | null = null;

  /**
   * Inicializa a tabela de analytics. Deve ser chamado após o storage.init().
   */
  initTable(db: Database.Database): void {
    this.db = db;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        group_id TEXT,
        sender_id TEXT,
        command_name TEXT,
        provider TEXT,
        model TEXT,
        tokens_input INTEGER,
        tokens_output INTEGER,
        estimated_cost_usd REAL,
        duration_ms INTEGER,
        success INTEGER DEFAULT 1,
        error_message TEXT,
        metadata_json TEXT,
        created_at INTEGER DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_analytics_type_date
        ON analytics_events(event_type, created_at);

      CREATE INDEX IF NOT EXISTS idx_analytics_group
        ON analytics_events(group_id, created_at);
    `);

    logger.debug('Analytics: tabela inicializada');
  }

  /**
   * Registra um evento de forma fire-and-forget.
   * Nunca lança exceção — falhas são logadas silenciosamente.
   */
  track(event: AnalyticsEvent): void {
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`
        INSERT INTO analytics_events
          (event_type, group_id, sender_id, command_name, provider, model,
           tokens_input, tokens_output, estimated_cost_usd, duration_ms,
           success, error_message, metadata_json)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const cost = event.estimatedCostUsd ?? this.estimateCost(
        event.model, event.tokensInput, event.tokensOutput
      );

      stmt.run(
        event.eventType,
        event.groupId ?? null,
        event.senderId ?? null,
        event.commandName ?? null,
        event.provider ?? null,
        event.model ?? null,
        event.tokensInput ?? null,
        event.tokensOutput ?? null,
        cost ?? null,
        event.durationMs ?? null,
        event.success !== false ? 1 : 0,
        event.errorMessage ?? null,
        event.metadata ? JSON.stringify(event.metadata) : null,
      );
    } catch (error) {
      logger.warn({ error }, 'Analytics: erro ao registrar evento');
    }
  }

  /**
   * Estima custo baseado no modelo e tokens.
   */
  private estimateCost(
    model?: string,
    tokensInput?: number,
    tokensOutput?: number
  ): number | null {
    if (!model || (!tokensInput && !tokensOutput)) return null;

    const pricing = PRICING[model];
    if (!pricing) return null;

    if ('perMinute' in pricing) return null; // Whisper cobra por minuto, não por token

    return (
      (tokensInput ?? 0) * pricing.input +
      (tokensOutput ?? 0) * pricing.output
    );
  }

  /**
   * Métricas do dia atual.
   */
  getDailyUsage(groupId?: string): DailyUsage {
    if (!this.db) return this.emptyUsage();

    const startOfDay = this.startOfDayTimestamp();
    const groupFilter = groupId ? 'AND group_id = ?' : '';
    const params: unknown[] = [startOfDay];
    if (groupId) params.push(groupId);

    // Comandos
    const commands = this.db.prepare(`
      SELECT command_name, COUNT(*) as cnt
      FROM analytics_events
      WHERE event_type = 'command' AND created_at >= ? ${groupFilter}
      GROUP BY command_name
    `).all(...params) as Array<{ command_name: string; cnt: number }>;

    const commandBreakdown: Record<string, number> = {};
    let totalCommands = 0;
    for (const row of commands) {
      if (row.command_name) {
        commandBreakdown[row.command_name] = row.cnt;
        totalCommands += row.cnt;
      }
    }

    // Mídia
    const media = this.db.prepare(`
      SELECT
        json_extract(metadata_json, '$.mediaType') as media_type,
        COUNT(*) as cnt
      FROM analytics_events
      WHERE event_type = 'media_process' AND created_at >= ? ${groupFilter}
      GROUP BY media_type
    `).all(...params) as Array<{ media_type: string; cnt: number }>;

    const mediaProcessed = { total: 0, image: 0, audio: 0, video: 0 };
    for (const row of media) {
      mediaProcessed.total += row.cnt;
      if (row.media_type === 'image' || row.media_type === 'sticker') mediaProcessed.image += row.cnt;
      else if (row.media_type === 'audio') mediaProcessed.audio += row.cnt;
      else if (row.media_type === 'video') mediaProcessed.video += row.cnt;
    }

    // Tokens e custo
    const totals = this.db.prepare(`
      SELECT
        COALESCE(SUM(tokens_input), 0) as total_input,
        COALESCE(SUM(tokens_output), 0) as total_output,
        COALESCE(SUM(estimated_cost_usd), 0) as total_cost,
        COALESCE(AVG(duration_ms), 0) as avg_duration,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errors
      FROM analytics_events
      WHERE created_at >= ? ${groupFilter}
    `).get(...params) as {
      total_input: number; total_output: number;
      total_cost: number; avg_duration: number; errors: number;
    };

    return {
      totalCommands,
      commandBreakdown,
      mediaProcessed,
      totalTokens: { input: totals.total_input, output: totals.total_output },
      estimatedCost: totals.total_cost,
      avgDurationMs: Math.round(totals.avg_duration),
      errors: totals.errors,
    };
  }

  /**
   * Custo semanal por provider/modelo.
   */
  getWeeklyCost(): WeeklyCost {
    if (!this.db) return { totalCost: 0, byProvider: {}, byModel: {}, totalTokens: { input: 0, output: 0 } };

    const weekAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;

    const byProvider = this.db.prepare(`
      SELECT provider, COALESCE(SUM(estimated_cost_usd), 0) as cost
      FROM analytics_events
      WHERE created_at >= ? AND provider IS NOT NULL
      GROUP BY provider
    `).all(weekAgo) as Array<{ provider: string; cost: number }>;

    const byModel = this.db.prepare(`
      SELECT model, COALESCE(SUM(estimated_cost_usd), 0) as cost
      FROM analytics_events
      WHERE created_at >= ? AND model IS NOT NULL
      GROUP BY model
    `).all(weekAgo) as Array<{ model: string; cost: number }>;

    const totals = this.db.prepare(`
      SELECT
        COALESCE(SUM(estimated_cost_usd), 0) as total_cost,
        COALESCE(SUM(tokens_input), 0) as total_input,
        COALESCE(SUM(tokens_output), 0) as total_output
      FROM analytics_events
      WHERE created_at >= ?
    `).get(weekAgo) as { total_cost: number; total_input: number; total_output: number };

    const providerMap: Record<string, number> = {};
    for (const row of byProvider) providerMap[row.provider] = row.cost;

    const modelMap: Record<string, number> = {};
    for (const row of byModel) modelMap[row.model] = row.cost;

    return {
      totalCost: totals.total_cost,
      byProvider: providerMap,
      byModel: modelMap,
      totalTokens: { input: totals.total_input, output: totals.total_output },
    };
  }

  /**
   * Ranking de comandos mais usados.
   */
  getTopCommands(days: number = 7): Array<{ command: string; count: number }> {
    if (!this.db) return [];

    const since = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
    return this.db.prepare(`
      SELECT command_name as command, COUNT(*) as count
      FROM analytics_events
      WHERE event_type = 'command' AND created_at >= ? AND command_name IS NOT NULL
      GROUP BY command_name
      ORDER BY count DESC
    `).all(since) as Array<{ command: string; count: number }>;
  }

  /**
   * Grupos ativos no período.
   */
  getActiveGroups(days: number = 7): number {
    if (!this.db) return 0;

    const since = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
    const result = this.db.prepare(`
      SELECT COUNT(DISTINCT group_id) as cnt
      FROM analytics_events
      WHERE created_at >= ? AND group_id IS NOT NULL
    `).get(since) as { cnt: number };

    return result.cnt;
  }

  /**
   * Uso por hora nas últimas 24 horas.
   */
  getHourlyUsage(): Array<{ hour: number; commands: number; llmCalls: number; media: number }> {
    if (!this.db) return [];

    const since = Math.floor(Date.now() / 1000) - 24 * 60 * 60;

    const rows = this.db.prepare(`
      SELECT
        CAST(strftime('%H', created_at, 'unixepoch', 'localtime') AS INTEGER) as hour,
        SUM(CASE WHEN event_type = 'command' THEN 1 ELSE 0 END) as commands,
        SUM(CASE WHEN event_type = 'llm_call' THEN 1 ELSE 0 END) as llm_calls,
        SUM(CASE WHEN event_type = 'media_process' THEN 1 ELSE 0 END) as media
      FROM analytics_events
      WHERE created_at >= ?
      GROUP BY hour
      ORDER BY hour
    `).all(since) as Array<{ hour: number; commands: number; llm_calls: number; media: number }>;

    return rows.map(row => ({
      hour: row.hour,
      commands: row.commands,
      llmCalls: row.llm_calls,
      media: row.media,
    }));
  }

  /**
   * Custo por dia nos últimos N dias.
   */
  getDailyCosts(days: number = 30): Array<{ date: string; cost: number; tokens: number }> {
    if (!this.db) return [];

    const since = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;

    const rows = this.db.prepare(`
      SELECT
        strftime('%Y-%m-%d', created_at, 'unixepoch', 'localtime') as date,
        COALESCE(SUM(estimated_cost_usd), 0) as cost,
        COALESCE(SUM(tokens_input), 0) + COALESCE(SUM(tokens_output), 0) as tokens
      FROM analytics_events
      WHERE created_at >= ?
      GROUP BY date
      ORDER BY date
    `).all(since) as Array<{ date: string; cost: number; tokens: number }>;

    return rows;
  }

  /**
   * Purge de eventos antigos (manutenção).
   */
  purgeOlderThan(timestamp: number): number {
    if (!this.db) return 0;

    const result = this.db.prepare(
      'DELETE FROM analytics_events WHERE created_at < ?'
    ).run(timestamp);

    return result.changes;
  }

  private startOfDayTimestamp(): number {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.floor(startOfDay.getTime() / 1000);
  }

  private emptyUsage(): DailyUsage {
    return {
      totalCommands: 0,
      commandBreakdown: {},
      mediaProcessed: { total: 0, image: 0, audio: 0, video: 0 },
      totalTokens: { input: 0, output: 0 },
      estimatedCost: 0,
      avgDurationMs: 0,
      errors: 0,
    };
  }
}
