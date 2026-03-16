/**
 * DebtService — gerencia dívidas entre membros de um grupo.
 *
 * Usa a mesma instância do SQLite (better-sqlite3) compartilhada
 * via SQLiteStorage.getDatabase().
 */
import Database from 'better-sqlite3';
import pino from 'pino';

const logger = pino({ name: 'debt-service' });

export interface DebtRow {
  id: number;
  group_id: string;
  debtor_id: string;
  debtor_name: string;
  creditor_id: string;
  creditor_name: string;
  amount: number;
  description: string | null;
  settled: number;
  source_message_id: string | null;
  created_at: number;
}

export interface NetDebt {
  from: string;
  fromName: string;
  to: string;
  toName: string;
  amount: number;
}

export interface ParsedDebtMention {
  mentionedName: string;
  amount: number;
  description: string;
}

export class DebtService {
  private db!: Database.Database;

  /** Inicializa a tabela de dívidas no banco compartilhado. */
  initTable(db: Database.Database): void {
    this.db = db;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS debts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id TEXT NOT NULL,
        debtor_id TEXT NOT NULL,
        debtor_name TEXT NOT NULL,
        creditor_id TEXT NOT NULL,
        creditor_name TEXT NOT NULL,
        amount REAL NOT NULL,
        description TEXT,
        settled INTEGER DEFAULT 0,
        source_message_id TEXT,
        created_at INTEGER DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_debts_group ON debts(group_id, settled);
    `);

    logger.info('Tabela debts inicializada');
  }

  /** Registra uma nova dívida. */
  addDebt(
    groupId: string,
    debtorId: string,
    debtorName: string,
    creditorId: string,
    creditorName: string,
    amount: number,
    description?: string,
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO debts (group_id, debtor_id, debtor_name, creditor_id, creditor_name, amount, description)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(groupId, debtorId, debtorName, creditorId, creditorName, amount, description ?? null);
    logger.info({ groupId, debtorName, creditorName, amount }, 'Dívida registrada');
  }

  /**
   * Quita (total ou parcialmente) dívidas de debtor para creditor.
   * Se o valor cobre toda a dívida, marca settled=1.
   * Se parcial, reduz o amount.
   */
  settleDebt(groupId: string, debtorId: string, creditorId: string, amount: number): number {
    const debts = this.db.prepare(`
      SELECT id, amount FROM debts
      WHERE group_id = ? AND debtor_id = ? AND creditor_id = ? AND settled = 0
      ORDER BY created_at ASC
    `).all(groupId, debtorId, creditorId) as Array<{ id: number; amount: number }>;

    let remaining = amount;

    const settleOne = this.db.prepare('UPDATE debts SET settled = 1 WHERE id = ?');
    const reduceOne = this.db.prepare('UPDATE debts SET amount = ? WHERE id = ?');

    for (const debt of debts) {
      if (remaining <= 0) break;

      if (remaining >= debt.amount) {
        settleOne.run(debt.id);
        remaining -= debt.amount;
      } else {
        reduceOne.run(debt.amount - remaining, debt.id);
        remaining = 0;
      }
    }

    const settled = amount - remaining;
    logger.info({ groupId, debtorId, creditorId, settled }, 'Pagamento processado');
    return settled;
  }

  /** Retorna todas as dívidas não quitadas de um grupo. */
  getGroupDebts(groupId: string): DebtRow[] {
    return this.db.prepare(`
      SELECT * FROM debts
      WHERE group_id = ? AND settled = 0
      ORDER BY created_at ASC
    `).all(groupId) as DebtRow[];
  }

  /**
   * Calcula o saldo líquido entre todos os membros de um grupo.
   * Simplifica dívidas cruzadas (A deve B 50, B deve A 30 → A deve B 20).
   */
  getNetBalance(groupId: string): NetDebt[] {
    const debts = this.getGroupDebts(groupId);

    // Acumula saldo líquido: balances[A][B] > 0 significa A deve a B
    const balances = new Map<string, Map<string, number>>();
    const names = new Map<string, string>();

    for (const d of debts) {
      names.set(d.debtor_id, d.debtor_name);
      names.set(d.creditor_id, d.creditor_name);

      if (!balances.has(d.debtor_id)) balances.set(d.debtor_id, new Map());
      if (!balances.has(d.creditor_id)) balances.set(d.creditor_id, new Map());

      const current = balances.get(d.debtor_id)!.get(d.creditor_id) ?? 0;
      balances.get(d.debtor_id)!.set(d.creditor_id, current + d.amount);
    }

    // Simplifica dívidas cruzadas
    const result: NetDebt[] = [];
    const processed = new Set<string>();

    for (const [a, aDebts] of balances) {
      for (const [b, aOwesB] of aDebts) {
        const key = [a, b].sort().join('|');
        if (processed.has(key)) continue;
        processed.add(key);

        const bOwesA = balances.get(b)?.get(a) ?? 0;
        const net = aOwesB - bOwesA;

        if (Math.abs(net) < 0.01) continue; // quite

        if (net > 0) {
          result.push({
            from: a,
            fromName: names.get(a)!,
            to: b,
            toName: names.get(b)!,
            amount: Math.round(net * 100) / 100,
          });
        } else {
          result.push({
            from: b,
            fromName: names.get(b)!,
            to: a,
            toName: names.get(a)!,
            amount: Math.round(Math.abs(net) * 100) / 100,
          });
        }
      }
    }

    return result;
  }

  /**
   * Tenta detectar menções de dívida no texto via regex.
   * Padrões aceitos:
   *   "@João 50 pizza"  ou  "@João R$50 pizza"
   */
  parseDebtMention(text: string): ParsedDebtMention | null {
    // Padrão: @Nome [R$]valor [descrição]
    const match = text.match(/@(\S+)\s+R?\$?\s*(\d+(?:[.,]\d{1,2})?)\s*(.*)/i);
    if (!match) return null;

    const mentionedName = match[1];
    const amount = parseFloat(match[2].replace(',', '.'));
    const description = match[3].trim();

    if (isNaN(amount) || amount <= 0) return null;

    return { mentionedName, amount, description: description || '' };
  }
}
