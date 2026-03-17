/**
 * Serviço de Configuração Dinâmica — gerencia config global e settings por grupo no SQLite.
 *
 * Permite alterar comportamento do bot em runtime sem reiniciar.
 * Suporta allowlist/blocklist de grupos e feature toggles por grupo.
 */
import Database from 'better-sqlite3';
import pino from 'pino';
import { config } from '../config';

const logger = pino({ level: config.logLevel });

export interface GroupSettings {
  group_id: string;
  group_name: string | null;
  allowed: number;
  features_json: string | null;
  custom_rate_limit: number | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export class DynamicConfigService {
  private db: Database.Database | null = null;

  /**
   * Cria as tabelas bot_config e group_settings se não existirem.
   */
  initTable(db: Database.Database): void {
    this.db = db;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bot_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS group_settings (
        group_id TEXT PRIMARY KEY,
        group_name TEXT,
        allowed INTEGER DEFAULT 1,
        features_json TEXT,
        custom_rate_limit INTEGER,
        notes TEXT,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch())
      );
    `);

    logger.debug('DynamicConfig: tabelas inicializadas');
  }

  // ============================================
  // Bot config (key-value global)
  // ============================================

  /**
   * Obtém o valor de uma config global.
   */
  get(key: string): string | null {
    if (!this.db) return null;

    const row = this.db.prepare(
      'SELECT value FROM bot_config WHERE key = ?'
    ).get(key) as { value: string } | undefined;

    return row?.value ?? null;
  }

  /**
   * Define o valor de uma config global (upsert).
   */
  set(key: string, value: string): void {
    if (!this.db) return;

    this.db.prepare(`
      INSERT INTO bot_config (key, value, updated_at)
      VALUES (?, ?, unixepoch())
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value);
  }

  /**
   * Retorna todas as configs globais como Record<string, string>.
   */
  getAll(): Record<string, string> {
    if (!this.db) return {};

    const rows = this.db.prepare(
      'SELECT key, value FROM bot_config'
    ).all() as Array<{ key: string; value: string }>;

    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  // ============================================
  // Group settings
  // ============================================

  /**
   * Garante que o grupo existe na tabela group_settings (auto-registro).
   * Novos grupos entram como bloqueados (allowed=0) por padrão — opt-in.
   * Grupos já registrados NÃO têm o campo allowed sobrescrito.
   */
  ensureGroupExists(groupId: string, groupName?: string): void {
    if (!this.db) return;

    this.db.prepare(`
      INSERT INTO group_settings (group_id, group_name, allowed)
      VALUES (?, ?, 0)
      ON CONFLICT(group_id) DO UPDATE SET
        group_name = COALESCE(excluded.group_name, group_settings.group_name),
        updated_at = unixepoch()
    `).run(groupId, groupName ?? null);
  }

  /**
   * Verifica se um grupo está permitido.
   * Sem registro = bloqueado por padrão (opt-in).
   */
  isGroupAllowed(groupId: string): boolean {
    if (!this.db) return false;

    const row = this.db.prepare(
      'SELECT allowed FROM group_settings WHERE group_id = ?'
    ).get(groupId) as { allowed: number } | undefined;

    if (!row) return false;
    return row.allowed === 1;
  }

  /**
   * Define se um grupo está permitido ou bloqueado.
   */
  setGroupAllowed(groupId: string, allowed: boolean, groupName?: string): void {
    if (!this.db) return;

    this.db.prepare(`
      INSERT INTO group_settings (group_id, group_name, allowed, updated_at)
      VALUES (?, ?, ?, unixepoch())
      ON CONFLICT(group_id) DO UPDATE SET
        allowed = excluded.allowed,
        group_name = COALESCE(excluded.group_name, group_settings.group_name),
        updated_at = excluded.updated_at
    `).run(groupId, groupName ?? null, allowed ? 1 : 0);
  }

  /**
   * Retorna as settings completas de um grupo.
   */
  getGroupSettings(groupId: string): GroupSettings | null {
    if (!this.db) return null;

    const row = this.db.prepare(
      'SELECT * FROM group_settings WHERE group_id = ?'
    ).get(groupId) as GroupSettings | undefined;

    return row ?? null;
  }

  /**
   * Atualização parcial das settings de um grupo.
   */
  updateGroupSettings(groupId: string, partial: Partial<GroupSettings>): void {
    if (!this.db) return;

    // Garantir que o registro existe
    this.db.prepare(`
      INSERT OR IGNORE INTO group_settings (group_id) VALUES (?)
    `).run(groupId);

    const updates: string[] = [];
    const values: unknown[] = [];

    if (partial.group_name !== undefined) {
      updates.push('group_name = ?');
      values.push(partial.group_name);
    }
    if (partial.allowed !== undefined) {
      updates.push('allowed = ?');
      values.push(partial.allowed);
    }
    if (partial.features_json !== undefined) {
      updates.push('features_json = ?');
      values.push(partial.features_json);
    }
    if (partial.custom_rate_limit !== undefined) {
      updates.push('custom_rate_limit = ?');
      values.push(partial.custom_rate_limit);
    }
    if (partial.notes !== undefined) {
      updates.push('notes = ?');
      values.push(partial.notes);
    }

    if (updates.length === 0) return;

    updates.push('updated_at = unixepoch()');
    values.push(groupId);

    this.db.prepare(
      `UPDATE group_settings SET ${updates.join(', ')} WHERE group_id = ?`
    ).run(...values);
  }

  /**
   * Retorna todas as settings de todos os grupos.
   */
  getAllGroups(): GroupSettings[] {
    if (!this.db) return [];

    return this.db.prepare(
      'SELECT * FROM group_settings ORDER BY updated_at DESC'
    ).all() as GroupSettings[];
  }

  /**
   * Verifica se uma feature está habilitada para um grupo.
   * Retorna true se não houver registro ou se a feature não estiver no JSON (default enabled).
   */
  isFeatureEnabled(groupId: string, feature: string): boolean {
    if (!this.db) return true;

    const row = this.db.prepare(
      'SELECT features_json FROM group_settings WHERE group_id = ?'
    ).get(groupId) as { features_json: string | null } | undefined;

    if (!row || !row.features_json) return true;

    try {
      const features = JSON.parse(row.features_json) as Record<string, boolean>;
      return features[feature] !== false; // default true se não definido
    } catch {
      return true;
    }
  }

  /**
   * Habilita ou desabilita uma feature para um grupo.
   */
  setFeatureEnabled(groupId: string, feature: string, enabled: boolean): void {
    if (!this.db) return;

    // Garantir que o registro existe
    this.db.prepare(`
      INSERT OR IGNORE INTO group_settings (group_id) VALUES (?)
    `).run(groupId);

    const row = this.db.prepare(
      'SELECT features_json FROM group_settings WHERE group_id = ?'
    ).get(groupId) as { features_json: string | null } | undefined;

    let features: Record<string, boolean> = {};
    if (row?.features_json) {
      try {
        features = JSON.parse(row.features_json) as Record<string, boolean>;
      } catch {
        // ignore parse errors
      }
    }

    features[feature] = enabled;

    this.db.prepare(
      'UPDATE group_settings SET features_json = ?, updated_at = unixepoch() WHERE group_id = ?'
    ).run(JSON.stringify(features), groupId);
  }
}
