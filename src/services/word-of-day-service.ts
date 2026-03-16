/**
 * Serviço "Palavra do Dia" — análise estatística de frequência de palavras.
 *
 * Tokeniza as mensagens do dia, remove stop words pt-BR e palavras curtas,
 * e retorna a palavra mais usada com contagem e senders únicos.
 * Nenhuma chamada a LLM — pura estatística.
 */
import Database from 'better-sqlite3';
import { IMessageStorage } from '../types';
import pino from 'pino';
import { config } from '../config';

const logger = pino({ level: config.logLevel });

export interface WordOfDayResult {
  word: string;
  count: number;
  uniqueSenders: number;
}

export interface WordOfDayEntry {
  id: number;
  groupId: string;
  word: string;
  count: number;
  uniqueSenders: number;
  date: string;
  createdAt: number;
}

// Stop words pt-BR (~170 palavras comuns)
const STOP_WORDS = new Set([
  'a', 'ao', 'aos', 'aquela', 'aquelas', 'aquele', 'aqueles', 'aquilo',
  'as', 'ate', 'até', 'com', 'como', 'da', 'das', 'de', 'dela', 'delas',
  'dele', 'deles', 'depois', 'do', 'dos', 'e', 'ela', 'elas', 'ele',
  'eles', 'em', 'entre', 'era', 'essa', 'essas', 'esse', 'esses', 'esta',
  'estas', 'este', 'estes', 'eu', 'foi', 'for', 'foram', 'ha', 'há',
  'isso', 'isto', 'ja', 'já', 'la', 'lá', 'lhe', 'lhes', 'lo', 'los',
  'mais', 'mas', 'me', 'mesmo', 'meu', 'meus', 'minha', 'minhas', 'muito',
  'muita', 'muitas', 'muitos', 'na', 'nas', 'nao', 'não', 'ne', 'nem',
  'nessa', 'nessas', 'nesse', 'nesses', 'nesta', 'nestas', 'neste',
  'nestes', 'no', 'nos', 'nossa', 'nossas', 'nosso', 'nossos', 'num',
  'numa', 'nuns', 'numas', 'o', 'os', 'ou', 'outra', 'outras', 'outro',
  'outros', 'para', 'pela', 'pelas', 'pelo', 'pelos', 'por', 'porque',
  'qual', 'quando', 'que', 'quem', 'sao', 'são', 'se', 'sem', 'ser',
  'sera', 'será', 'seu', 'seus', 'sido', 'so', 'só', 'sobre', 'somos',
  'sua', 'suas', 'tal', 'tambem', 'também', 'te', 'tem', 'tinha', 'teu',
  'teus', 'ti', 'tua', 'tuas', 'tu', 'tudo', 'um', 'uma', 'umas', 'uns',
  'vai', 'vamos', 'voce', 'você', 'voces', 'vocês', 'vos', 'vossa',
  'era', 'estar', 'estava', 'estou', 'estão', 'fui', 'fomos', 'foram',
  'sendo', 'ter', 'tendo', 'tenho', 'temos', 'tinha', 'tinham',
  'pode', 'podem', 'pra', 'pro', 'pros', 'pras', 'ainda', 'aí', 'ali',
  'aqui', 'bem', 'bom', 'boa', 'cada', 'coisa', 'coisas', 'com', 'como',
  'dai', 'daí', 'deu', 'dia', 'dos', 'duas', 'dois', 'ela', 'eles',
  'então', 'entao', 'essa', 'esse', 'esta', 'este', 'fazer', 'faz',
  'fica', 'ficar', 'gente', 'hein', 'hoje', 'isso', 'mim', 'nada',
  'ninguem', 'ninguém', 'onde', 'quer', 'sim', 'sou', 'tá', 'tão',
  'todo', 'toda', 'todos', 'todas', 'ver', 'vez', 'vezes',
]);

export class WordOfDayService {
  private db: Database.Database | null = null;

  /**
   * Inicializa a tabela de word_of_day. Deve ser chamado após o storage.init().
   */
  initTable(db: Database.Database): void {
    this.db = db;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS word_of_day (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id TEXT NOT NULL,
        word TEXT NOT NULL,
        count INTEGER NOT NULL,
        unique_senders INTEGER NOT NULL,
        date TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_word_of_day_group_date
        ON word_of_day(group_id, date DESC);
    `);

    logger.debug('WordOfDay: tabela inicializada');
  }

  /**
   * Gera a palavra do dia para um grupo com base nas mensagens de hoje.
   * Retorna null se não houver palavras relevantes.
   */
  async generateWordOfDay(
    groupId: string,
    storage: IMessageStorage
  ): Promise<WordOfDayResult | null> {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const fromTimestamp = Math.floor(startOfDay.getTime() / 1000);
    const toTimestamp = Math.floor(Date.now() / 1000);

    const messages = await storage.getMessagesByTimeRange(groupId, fromTimestamp, toTimestamp);

    if (messages.length === 0) {
      return null;
    }

    // Contagem de frequência por palavra e senders únicos por palavra
    const wordCounts = new Map<string, number>();
    const wordSenders = new Map<string, Set<string>>();

    for (const msg of messages) {
      const tokens = this.tokenize(msg.content);

      for (const token of tokens) {
        wordCounts.set(token, (wordCounts.get(token) ?? 0) + 1);

        if (!wordSenders.has(token)) {
          wordSenders.set(token, new Set());
        }
        wordSenders.get(token)!.add(msg.senderId);
      }
    }

    if (wordCounts.size === 0) {
      return null;
    }

    // Encontrar a palavra com maior frequência
    let topWord = '';
    let topCount = 0;

    for (const [word, count] of wordCounts) {
      if (count > topCount) {
        topWord = word;
        topCount = count;
      }
    }

    const uniqueSenders = wordSenders.get(topWord)?.size ?? 0;

    const result: WordOfDayResult = {
      word: topWord,
      count: topCount,
      uniqueSenders,
    };

    // Salvar no banco
    this.saveEntry(groupId, result, this.formatDate(now));

    return result;
  }

  /**
   * Retorna o histórico de palavras do dia para um grupo.
   */
  getHistory(groupId: string, limit: number = 7): WordOfDayEntry[] {
    if (!this.db) return [];

    const stmt = this.db.prepare(`
      SELECT id, group_id, word, count, unique_senders, date, created_at
      FROM word_of_day
      WHERE group_id = ?
      ORDER BY date DESC
      LIMIT ?
    `);

    const rows = stmt.all(groupId, limit) as Array<{
      id: number;
      group_id: string;
      word: string;
      count: number;
      unique_senders: number;
      date: string;
      created_at: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      groupId: row.group_id,
      word: row.word,
      count: row.count,
      uniqueSenders: row.unique_senders,
      date: row.date,
      createdAt: row.created_at,
    }));
  }

  /**
   * Tokeniza um texto: split por espaços, lowercase, remove pontuação,
   * filtra stop words e palavras com < 3 caracteres.
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '') // remove pontuação, mantém letras/números/espaços
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
  }

  /**
   * Salva uma entrada no banco de dados.
   */
  private saveEntry(groupId: string, result: WordOfDayResult, date: string): void {
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`
        INSERT INTO word_of_day (group_id, word, count, unique_senders, date)
        VALUES (?, ?, ?, ?, ?)
      `);

      stmt.run(groupId, result.word, result.count, result.uniqueSenders, date);
    } catch (error) {
      logger.warn({ error }, 'WordOfDay: erro ao salvar entrada');
    }
  }

  /**
   * Formata uma data como dd/MM/yyyy para uso como chave de data.
   */
  private formatDate(date: Date): string {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${yyyy}-${mm}-${dd}`;
  }
}
