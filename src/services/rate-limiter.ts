/**
 * Rate Limiter — Sliding Window em memória.
 *
 * Protege contra spam de comandos no grupo.
 * Chave = groupId (rate limit por grupo, não por usuário).
 *
 * Config padrão: 3 chamadas a cada 5 minutos por grupo.
 */
import { IRateLimiter, RateLimitResult } from '../types';
import { config } from '../config';

interface WindowEntry {
  timestamps: number[];
}

export class RateLimiter implements IRateLimiter {
  private windows: Map<string, WindowEntry> = new Map();
  private maxRequests: number;
  private windowMs: number;

  constructor() {
    this.maxRequests = config.rateLimit.maxRequests;
    this.windowMs = config.rateLimit.windowSeconds * 1000;
  }

  /**
   * Tenta consumir um uso do rate limit.
   * Retorna se foi permitido e quanto tempo esperar se não.
   */
  consume(key: string): RateLimitResult {
    const now = Date.now();
    let entry = this.windows.get(key);

    if (!entry) {
      entry = { timestamps: [] };
      this.windows.set(key, entry);
    }

    // Remover timestamps fora da janela
    entry.timestamps = entry.timestamps.filter(
      (ts) => now - ts < this.windowMs
    );

    if (entry.timestamps.length >= this.maxRequests) {
      // Calcular quanto tempo falta para o timestamp mais antigo expirar
      const oldestInWindow = entry.timestamps[0];
      const retryAfterMs = this.windowMs - (now - oldestInWindow);

      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      };
    }

    // Permitido — registrar o uso
    entry.timestamps.push(now);

    return {
      allowed: true,
      retryAfterSeconds: 0,
    };
  }

  /**
   * Reseta o rate limit para uma chave (útil para admin).
   */
  reset(key: string): void {
    this.windows.delete(key);
  }

  /**
   * Limpa entradas antigas (manutenção periódica).
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.windows.entries()) {
      entry.timestamps = entry.timestamps.filter(
        (ts) => now - ts < this.windowMs
      );
      if (entry.timestamps.length === 0) {
        this.windows.delete(key);
      }
    }
  }
}
