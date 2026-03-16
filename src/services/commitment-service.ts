/**
 * CommitmentService — gerencia compromissos e lembretes de um grupo.
 *
 * Usa a mesma instância do SQLite (better-sqlite3) compartilhada
 * via SQLiteStorage.getDatabase().
 */
import Database from 'better-sqlite3';
import pino from 'pino';

const logger = pino({ name: 'commitment-service' });

export interface CommitmentRow {
  id: number;
  group_id: string;
  description: string;
  event_date: number | null;
  reminder_sent: number;
  created_by: string;
  created_by_name: string;
  source_message_id: string | null;
  created_at: number;
}

export interface DateDetectionResult {
  hasDate: boolean;
  rawMatch: string;
}

const DAY_NAMES: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  terça: 2,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sábado: 6,
  sabado: 6,
};

export class CommitmentService {
  private db!: Database.Database;

  /** Inicializa a tabela de compromissos no banco compartilhado. */
  initTable(db: Database.Database): void {
    this.db = db;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS commitments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id TEXT NOT NULL,
        description TEXT NOT NULL,
        event_date INTEGER,
        reminder_sent INTEGER DEFAULT 0,
        created_by TEXT NOT NULL,
        created_by_name TEXT NOT NULL,
        source_message_id TEXT,
        created_at INTEGER DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_commitments_group ON commitments(group_id, event_date);
    `);

    logger.info('Tabela commitments inicializada');
  }

  /** Registra um novo compromisso. */
  addCommitment(
    groupId: string,
    description: string,
    eventDate: Date | null,
    createdBy: string,
    createdByName: string,
    messageId?: string,
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO commitments (group_id, description, event_date, created_by, created_by_name, source_message_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const ts = eventDate ? Math.floor(eventDate.getTime() / 1000) : null;
    stmt.run(groupId, description, ts, createdBy, createdByName, messageId ?? null);
    logger.info({ groupId, description, eventDate: ts }, 'Compromisso registrado');
  }

  /** Retorna os próximos compromissos de um grupo. */
  getUpcoming(groupId: string, limit: number = 10): CommitmentRow[] {
    const now = Math.floor(Date.now() / 1000);
    return this.db.prepare(`
      SELECT * FROM commitments
      WHERE group_id = ? AND (event_date >= ? OR event_date IS NULL)
      ORDER BY
        CASE WHEN event_date IS NULL THEN 1 ELSE 0 END,
        event_date ASC
      LIMIT ?
    `).all(groupId, now, limit) as CommitmentRow[];
  }

  /** Retorna compromissos que precisam de lembrete (evento em menos de 2h e ainda não notificado). */
  getPendingReminders(): CommitmentRow[] {
    const now = Math.floor(Date.now() / 1000);
    const twoHoursFromNow = now + 2 * 60 * 60;
    return this.db.prepare(`
      SELECT * FROM commitments
      WHERE event_date IS NOT NULL
        AND event_date >= ?
        AND event_date <= ?
        AND reminder_sent = 0
      ORDER BY event_date ASC
    `).all(now, twoHoursFromNow) as CommitmentRow[];
  }

  /** Marca um lembrete como enviado. */
  markReminderSent(id: number): void {
    this.db.prepare('UPDATE commitments SET reminder_sent = 1 WHERE id = ?').run(id);
  }

  /** Remove compromissos passados de um grupo. */
  clearPast(groupId: string): number {
    const now = Math.floor(Date.now() / 1000);
    const result = this.db.prepare(`
      DELETE FROM commitments
      WHERE group_id = ? AND event_date IS NOT NULL AND event_date < ?
    `).run(groupId, now);
    return result.changes;
  }

  /** Detecta menções de data/hora em texto pt-BR via regex. */
  detectDateMention(text: string): DateDetectionResult {
    const patterns = [
      // Combined: "sexta às 20h", "dia 15 às 14h"
      /(?:depois\s+de\s+)?amanhã\s+(?:às?\s+)?\d{1,2}(?:h\d{0,2}|:\d{2})/i,
      /(?:segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo)\s+(?:às?\s+)?\d{1,2}(?:h\d{0,2}|:\d{2})/i,
      /dia\s+\d{1,2}(?:\/\d{1,2})?\s+(?:às?\s+)?\d{1,2}(?:h\d{0,2}|:\d{2})/i,
      // Date-only patterns
      /depois\s+de\s+amanhã/i,
      /amanhã/i,
      /(?:segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo)(?:-feira)?/i,
      /dia\s+\d{1,2}(?:\/\d{1,2})?/i,
      /semana\s+que\s+vem/i,
      /próxima\s+semana/i,
      // Time-only patterns
      /às?\s+\d{1,2}(?:h\d{0,2}|:\d{2})/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return { hasDate: true, rawMatch: match[0] };
      }
    }

    return { hasDate: false, rawMatch: '' };
  }

  /** Converte padrões detectados de data/hora pt-BR em um objeto Date. */
  parseDateFromText(text: string): Date | null {
    const lower = text.toLowerCase();
    const now = new Date();
    let result: Date | null = null;

    // "depois de amanhã"
    if (/depois\s+de\s+amanhã/.test(lower)) {
      result = new Date(now);
      result.setDate(result.getDate() + 2);
      result.setHours(9, 0, 0, 0);
    }
    // "amanhã"
    else if (/amanhã/.test(lower)) {
      result = new Date(now);
      result.setDate(result.getDate() + 1);
      result.setHours(9, 0, 0, 0);
    }
    // "semana que vem" / "próxima semana"
    else if (/semana\s+que\s+vem/.test(lower) || /próxima\s+semana/.test(lower)) {
      result = new Date(now);
      const daysUntilMonday = ((1 - now.getDay()) + 7) % 7 || 7;
      result.setDate(result.getDate() + daysUntilMonday);
      result.setHours(9, 0, 0, 0);
    }
    // Day of week: "segunda", "terça", etc.
    else {
      for (const [dayName, dayNum] of Object.entries(DAY_NAMES)) {
        const re = new RegExp(`\\b${dayName}\\b`, 'i');
        if (re.test(lower)) {
          result = new Date(now);
          const currentDay = now.getDay();
          let daysAhead = (dayNum - currentDay + 7) % 7;
          if (daysAhead === 0) daysAhead = 7; // next occurrence
          result.setDate(result.getDate() + daysAhead);
          result.setHours(9, 0, 0, 0);
          break;
        }
      }
    }

    // "dia X" or "dia X/M"
    if (!result) {
      const dayMatch = lower.match(/dia\s+(\d{1,2})(?:\/(\d{1,2}))?/);
      if (dayMatch) {
        const day = parseInt(dayMatch[1], 10);
        const month = dayMatch[2] ? parseInt(dayMatch[2], 10) - 1 : now.getMonth();

        result = new Date(now.getFullYear(), month, day, 9, 0, 0, 0);
        // If the date is in the past, move to next month (only when month wasn't specified)
        if (!dayMatch[2] && result <= now) {
          result.setMonth(result.getMonth() + 1);
        }
        // If month was specified and date is in the past, move to next year
        if (dayMatch[2] && result <= now) {
          result.setFullYear(result.getFullYear() + 1);
        }
      }
    }

    // Extract time: "às 20h", "20:00", "às 14h30"
    if (result) {
      const timeMatch = lower.match(/(?:às?\s+)?(\d{1,2})(?:h(\d{0,2})|:(\d{2}))/);
      if (timeMatch) {
        const hours = parseInt(timeMatch[1], 10);
        const minutes = parseInt(timeMatch[2] || timeMatch[3] || '0', 10);
        if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
          result.setHours(hours, minutes, 0, 0);
        }
      }
    }

    return result;
  }
}
