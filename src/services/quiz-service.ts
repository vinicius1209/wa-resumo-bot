/**
 * QuizService — "Quem disse isso?" quiz game.
 *
 * Picks a random message from the group history and asks
 * players to guess who wrote it. Scores are persisted in SQLite.
 */
import Database from 'better-sqlite3';
import pino from 'pino';
import { IMessageStorage, StoredMessage } from '../types';

const logger = pino({ name: 'quiz-service' });

// ── Types ────────────────────────────────────────────────────

export interface QuizRound {
  messageText: string;
  correctAnswer: number; // 1-4
  correctName: string;
  options: string[]; // 4 names
  startedAt: number;
  timeout: NodeJS.Timeout;
  answeredBy: Set<string>;
}

export interface QuizAnswerResult {
  correct: boolean;
  correctName?: string;
  senderName?: string;
  scores?: QuizScoreRow[];
}

export interface QuizScoreRow {
  sender_id: string;
  sender_name: string;
  points: number;
  games_played: number;
}

export interface QuizStartResult {
  questionText: string;
  options: string[];
}

type OnRoundEndCallback = (groupId: string, result: { message: string }) => void;

// ── Service ──────────────────────────────────────────────────

export class QuizService {
  private db!: Database.Database;
  private rounds = new Map<string, QuizRound>();
  private onRoundEndCallback: OnRoundEndCallback | null = null;

  /** Initialise the quiz_scores table on the shared database. */
  initTable(db: Database.Database): void {
    this.db = db;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS quiz_scores (
        group_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        points INTEGER DEFAULT 0,
        games_played INTEGER DEFAULT 0,
        PRIMARY KEY (group_id, sender_id)
      );
    `);

    logger.info('quiz_scores table ready');
  }

  /** Register a callback invoked when a round ends by timeout. */
  setOnRoundEnd(callback: OnRoundEndCallback): void {
    this.onRoundEndCallback = callback;
  }

  /** Whether there is an active round for the group. */
  isActiveRound(groupId: string): boolean {
    return this.rounds.has(groupId);
  }

  /** Return the current round (if any). */
  getActiveRound(groupId: string): QuizRound | undefined {
    return this.rounds.get(groupId);
  }

  /**
   * Start a new quiz round for the given group.
   * Returns the question + options, or null if a round cannot be created.
   */
  async startRound(
    groupId: string,
    storage: IMessageStorage,
  ): Promise<QuizStartResult | null> {
    if (this.rounds.has(groupId)) {
      return null; // already active
    }

    // Fetch recent messages
    const messages = await storage.getMessages(groupId, 200);

    // Filter to good candidates
    const candidates = messages.filter((m) => {
      if (m.messageType !== 'text') return false;
      const t = m.content.trim();
      if (t.length <= 10 || t.length >= 200) return false;
      if (t.startsWith('/')) return false;
      if (t.startsWith('[')) return false; // media placeholders like [imagem]
      return true;
    });

    // Need at least 4 unique senders
    const senderMap = new Map<string, string>(); // id -> name
    for (const m of candidates) {
      senderMap.set(m.senderId, m.senderName);
    }
    if (senderMap.size < 4) {
      return null;
    }

    // Pick a random message
    const picked = candidates[Math.floor(Math.random() * candidates.length)];

    // Build options: correct sender + 3 random others
    const otherSenders = Array.from(senderMap.entries()).filter(
      ([id]) => id !== picked.senderId,
    );
    // Shuffle and take 3
    for (let i = otherSenders.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [otherSenders[i], otherSenders[j]] = [otherSenders[j], otherSenders[i]];
    }
    const wrongOptions = otherSenders.slice(0, 3).map(([, name]) => name);

    // Combine and shuffle
    const options = [...wrongOptions, picked.senderName];
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }

    const correctAnswer = options.indexOf(picked.senderName) + 1; // 1-based

    // Timeout: auto-reveal after 30 seconds
    const timeout = setTimeout(() => {
      this.handleTimeout(groupId);
    }, 30_000);

    const round: QuizRound = {
      messageText: picked.content.trim(),
      correctAnswer,
      correctName: picked.senderName,
      options,
      startedAt: Date.now(),
      timeout,
      answeredBy: new Set(),
    };

    this.rounds.set(groupId, round);

    return {
      questionText: picked.content.trim(),
      options,
    };
  }

  /**
   * Check an answer for the active round.
   * Returns null if no round or already answered.
   */
  checkAnswer(
    groupId: string,
    senderId: string,
    senderName: string,
    answer: number,
  ): QuizAnswerResult | null {
    const round = this.rounds.get(groupId);
    if (!round) return null;
    if (round.answeredBy.has(senderId)) return null;

    round.answeredBy.add(senderId);

    if (answer === round.correctAnswer) {
      // Update score
      this.upsertScore(groupId, senderId, senderName);
      const scores = this.getRanking(groupId);
      this.endRound(groupId);
      return {
        correct: true,
        correctName: round.correctName,
        senderName,
        scores,
      };
    }

    return { correct: false };
  }

  /** End a round, clearing timeout. */
  endRound(groupId: string): void {
    const round = this.rounds.get(groupId);
    if (round) {
      clearTimeout(round.timeout);
      this.rounds.delete(groupId);
    }
  }

  /** Get the leaderboard for a group ordered by points descending. */
  getRanking(groupId: string): QuizScoreRow[] {
    const stmt = this.db.prepare(
      `SELECT sender_id, sender_name, points, games_played
       FROM quiz_scores
       WHERE group_id = ?
       ORDER BY points DESC
       LIMIT 10`,
    );
    return stmt.all(groupId) as QuizScoreRow[];
  }

  // ── Private ──────────────────────────────────────────────

  private upsertScore(groupId: string, senderId: string, senderName: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO quiz_scores (group_id, sender_id, sender_name, points, games_played)
      VALUES (?, ?, ?, 1, 1)
      ON CONFLICT(group_id, sender_id) DO UPDATE SET
        sender_name = excluded.sender_name,
        points = points + 1,
        games_played = games_played + 1
    `);
    stmt.run(groupId, senderId, senderName);
  }

  private handleTimeout(groupId: string): void {
    const round = this.rounds.get(groupId);
    if (!round) return;

    const message =
      `⏰ *Tempo esgotado!*\n\n` +
      `Ninguém acertou! A resposta era:\n` +
      `*${round.correctAnswer}. ${round.correctName}*`;

    this.rounds.delete(groupId);

    if (this.onRoundEndCallback) {
      this.onRoundEndCallback(groupId, { message });
    }
  }
}
