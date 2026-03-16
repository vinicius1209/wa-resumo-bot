/**
 * SentimentService — Detector de treta (conflito/sentimento) em grupos.
 *
 * Usa heurísticas simples (sem LLM) para calcular uma "temperatura"
 * do grupo com base em mensagens recentes (janela deslizante de 5 min).
 */
import { StoredMessage } from '../types';

interface ScoredMessage {
  senderId: string;
  timestamp: number;
  score: number;
}

interface SentimentWindow {
  messages: ScoredMessage[];
  lastAlertAt: number;
}

/** Palavras-chave negativas em pt-BR (lowercase, sem acento quando relevante). */
const NEGATIVE_KEYWORDS: string[] = [
  'absurdo',
  'ridículo',
  'ridiculo',
  'mentira',
  'mentiroso',
  'idiota',
  'burro',
  'burra',
  'palhaço',
  'palhaco',
  'merda',
  'porra',
  'caralho',
  'cala a boca',
  'vai se',
  'vai tomar',
  'não acredito',
  'nao acredito',
  'que ódio',
  'que odio',
  'que raiva',
  'babaca',
  'imbecil',
  'tosco',
  'tosca',
  'otário',
  'otario',
  'otária',
  'otaria',
  'estúpido',
  'estupido',
  'estúpida',
  'estupida',
  'patético',
  'patetico',
  'patética',
  'patetica',
  'nojento',
  'nojenta',
  'insuportável',
  'insuportavel',
  'ignorante',
  'arrogante',
  'desgraça',
  'desgraca',
  'desgraçado',
  'desgracado',
  'filho da puta',
  'fdp',
  'lixo',
  'vergonha',
  'cretino',
  'cretina',
];

export class SentimentService {
  private windows = new Map<string, SentimentWindow>();
  private readonly windowDurationMs = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly threshold: number = 15,
    private readonly cooldownMs: number = 30 * 60 * 1000, // 30 minutes
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
      timestamp: message.timestamp,
      score,
    });

    this.pruneWindow(window);
  }

  /**
   * Retorna a temperatura atual do grupo (score + label com emoji).
   */
  getTemperature(groupId: string): { score: number; label: string } {
    const window = this.windows.get(groupId);
    const score = window ? this.calcScore(window) : 0;

    let label: string;
    if (score <= 5) {
      label = '😎 Tranquilo';
    } else if (score <= 10) {
      label = '😐 Normal';
    } else if (score <= 15) {
      label = '😤 Esquentando';
    } else {
      label = '🔥 Pegando fogo';
    }

    return { score, label };
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
   * Marca que o alerta foi disparado (atualiza cooldown).
   */
  markAlerted(groupId: string): void {
    const window = this.windows.get(groupId);
    if (window) {
      window.lastAlertAt = Date.now();
    }
  }

  // ── private helpers ──────────────────────────────────

  private getOrCreateWindow(groupId: string): SentimentWindow {
    let window = this.windows.get(groupId);
    if (!window) {
      window = { messages: [], lastAlertAt: 0 };
      this.windows.set(groupId, window);
    }
    return window;
  }

  private pruneWindow(window: SentimentWindow): void {
    const cutoff = Date.now() - this.windowDurationMs;
    window.messages = window.messages.filter((m) => m.timestamp * 1000 >= cutoff || m.timestamp >= cutoff);
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

    // Negative keywords
    for (const keyword of NEGATIVE_KEYWORDS) {
      if (lower.includes(keyword)) {
        score += 2;
      }
    }

    // Long angry messages (> 200 chars with high score)
    if (content.length > 200 && score > 0) {
      score += 1;
    }

    return score;
  }
}
