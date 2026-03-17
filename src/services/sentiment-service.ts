/**
 * SentimentService — Detector de treta (conflito/sentimento) em grupos.
 *
 * Usa heurísticas simples (sem LLM) para calcular uma "temperatura"
 * do grupo com base em mensagens recentes (janela deslizante de 30 min).
 *
 * Keywords centralizadas em ./sentiment-keywords.ts
 */
import { StoredMessage } from '../types';
import { WEIGHTED_KEYWORDS } from './sentiment-keywords';

interface ScoredMessage {
  senderId: string;
  senderName: string;
  content: string;
  timestamp: number;
  score: number;
}

interface SentimentWindow {
  messages: ScoredMessage[];
  lastAlertAt: number;
  lastReactAt: number;
}

export class SentimentService {
  private windows = new Map<string, SentimentWindow>();
  private readonly windowDurationMs = 30 * 60 * 1000; // 30 minutes

  constructor(
    private readonly threshold: number = 15,
    private readonly cooldownMs: number = 30 * 60 * 1000, // 30 minutes
    private readonly reactCooldownMs: number = 15 * 60 * 1000, // 15 minutes
  ) {}

  /**
   * Analisa uma mensagem e atualiza a janela deslizante do grupo.
   */
  feedMessage(message: StoredMessage): void {
    const content = message.content ?? '';
    if (!content.trim()) return;

    const score = this.scoreMessage(content);
    if (score === 0) return;

    const window = this.getOrCreateWindow(message.groupId);
    window.messages.push({
      senderId: message.senderId,
      senderName: message.senderName,
      content: content.slice(0, 300),
      timestamp: message.timestamp,
      score,
    });

    this.pruneWindow(window);
  }

  /**
   * Retorna a temperatura atual do grupo (score + label com emoji).
   */
  getTemperature(groupId: string): { score: number; label: string; heatedCount: number } {
    const window = this.windows.get(groupId);
    const score = window ? this.calcScore(window) : 0;
    const heatedCount = window ? window.messages.length : 0;

    let label: string;
    if (score <= 3) {
      label = '😎 Tranquilo';
    } else if (score <= 8) {
      label = '😐 Normal';
    } else if (score <= 14) {
      label = '😤 Esquentando';
    } else {
      label = '🔥 Pegando fogo';
    }

    return { score, label, heatedCount };
  }

  /**
   * Indica se deve disparar alerta automático (score >= threshold e cooldown respeitado).
   */
  shouldAlert(groupId: string): boolean {
    const window = this.windows.get(groupId);
    if (!window) return false;

    const score = this.calcScore(window);
    if (score < this.threshold) return false;

    const now = Date.now();
    return now - window.lastAlertAt >= this.cooldownMs;
  }

  /**
   * Indica se deve disparar reação provocativa (score >= 9 "Esquentando" e cooldown respeitado).
   */
  shouldReact(groupId: string): boolean {
    const window = this.windows.get(groupId);
    if (!window) return false;

    const score = this.calcScore(window);
    if (score < 9) return false;

    const now = Date.now();
    return now - window.lastReactAt >= this.reactCooldownMs;
  }

  /**
   * Marca que a reação provocativa foi disparada.
   */
  markReacted(groupId: string): void {
    const window = this.windows.get(groupId);
    if (window) {
      window.lastReactAt = Date.now();
    }
  }

  /**
   * Marca que o alerta foi disparado (atualiza cooldown).
   */
  markAlerted(groupId: string): void {
    const window = this.windows.get(groupId);
    if (window) {
      window.lastAlertAt = Date.now();
    }
  }

  /**
   * Retorna as mensagens mais quentes da janela para dar contexto ao LLM.
   */
  getHeatedMessages(groupId: string, limit: number = 10): Array<{ senderName: string; content: string }> {
    const window = this.windows.get(groupId);
    if (!window) return [];

    this.pruneWindow(window);
    return window.messages
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((m) => ({ senderName: m.senderName, content: m.content }));
  }

  // ── private helpers ──────────────────────────────────

  private getOrCreateWindow(groupId: string): SentimentWindow {
    let window = this.windows.get(groupId);
    if (!window) {
      window = { messages: [], lastAlertAt: 0, lastReactAt: 0 };
      this.windows.set(groupId, window);
    }
    return window;
  }

  private pruneWindow(window: SentimentWindow): void {
    const cutoff = Date.now() - this.windowDurationMs;
    // timestamp vem do Baileys em Unix seconds — converte para ms antes de comparar
    window.messages = window.messages.filter((m) => m.timestamp * 1000 >= cutoff);
  }

  private calcScore(window: SentimentWindow): number {
    this.pruneWindow(window);
    return window.messages.reduce((sum, m) => sum + m.score, 0);
  }

  private scoreMessage(content: string): number {
    let score = 0;
    const lower = content.toLowerCase();

    // CAPS LOCK: > 50% uppercase chars (min 10 chars)
    const letters = content.replace(/[^a-zA-ZÀ-ÿ]/g, '');
    if (letters.length >= 10) {
      const upperCount = letters.replace(/[^A-ZÀ-Ý]/g, '').length;
      if (upperCount / letters.length > 0.5) {
        score += 2;
      }
    }

    // Excessive punctuation: "!!!" or "???"
    if (/!{3,}/.test(content) || /\?{3,}/.test(content)) {
      score += 1;
    }

    // Keywords com peso por categoria (heavy=3, medium=2, light=1)
    let keywordScore = 0;
    for (const { words, weight } of WEIGHTED_KEYWORDS) {
      for (const keyword of words) {
        if (lower.includes(keyword)) {
          keywordScore += weight;
        }
      }
    }
    // Cap por mensagem para evitar que uma mensagem sozinha domine
    score += Math.min(keywordScore, 8);

    // Long angry messages (> 200 chars with high score)
    if (content.length > 200 && score > 0) {
      score += 1;
    }

    // Mensagens curtas e agressivas (< 30 chars com keyword) — típico de briga
    if (content.length < 30 && keywordScore > 0) {
      score += 1;
    }

    return score;
  }
}
