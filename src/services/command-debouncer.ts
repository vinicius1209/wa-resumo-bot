/**
 * Command Debouncer — agrupa comandos repetidos do mesmo usuário.
 *
 * Se um usuário manda /resumo 50 vezes em 2 segundos,
 * apenas a última invocação é executada.
 *
 * Chave = `${senderId}:${commandName}`
 */
import pino from 'pino';
import { config } from '../config';

const logger = pino({ level: config.logLevel });

interface PendingEntry {
  timer: NodeJS.Timeout;
  resolve: (shouldExecute: boolean) => void;
  count: number;
}

export class CommandDebouncer {
  private pending: Map<string, PendingEntry> = new Map();
  private delayMs: number;

  constructor(delayMs = 2000) {
    this.delayMs = delayMs;
  }

  /**
   * Debounce um comando. Retorna uma Promise que resolve:
   * - `true` se este call deve ser executado (timer disparou)
   * - `false` se foi substituído por um call mais recente
   */
  debounce(key: string): Promise<boolean> {
    const existing = this.pending.get(key);

    if (existing) {
      // Cancelar o anterior
      clearTimeout(existing.timer);
      existing.resolve(false);
      const newCount = existing.count + 1;

      if (newCount % 50 === 0) {
        logger.warn({ key, count: newCount }, 'Debounce: spam detectado');
      }

      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          this.pending.delete(key);
          logger.info({ key, debounced: newCount }, 'Debounce: executando após agrupar comandos');
          resolve(true);
        }, this.delayMs);

        this.pending.set(key, { timer, resolve, count: newCount });
      });
    }

    // Primeiro call — iniciar timer
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        resolve(true);
      }, this.delayMs);

      this.pending.set(key, { timer, resolve, count: 1 });
    });
  }

  /**
   * Limpa todos os timers pendentes.
   */
  cleanup(): void {
    for (const [key, entry] of this.pending.entries()) {
      clearTimeout(entry.timer);
      entry.resolve(false);
    }
    this.pending.clear();
  }
}
