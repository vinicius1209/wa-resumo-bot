/**
 * Command Debouncer — agrupa comandos repetidos do mesmo usuário.
 *
 * Se um usuário manda /resumo 50 vezes em 2 segundos,
 * apenas a última invocação é executada.
 *
 * Lógica:
 * - Primeiro call: executa IMEDIATAMENTE (sem delay)
 * - Calls subsequentes dentro da janela: cancela anteriores,
 *   só o último executa após o delay expirar
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

interface CooldownEntry {
  expiresAt: number;
}

export class CommandDebouncer {
  /** Comandos aguardando debounce (a partir do 2º call) */
  private pending: Map<string, PendingEntry> = new Map();
  /** Cooldown do primeiro call — marca que a key está "quente" */
  private cooldowns: Map<string, CooldownEntry> = new Map();
  private delayMs: number;

  constructor(delayMs = 2000) {
    this.delayMs = delayMs;
  }

  /**
   * Debounce um comando. Retorna uma Promise que resolve:
   * - `true` se este call deve ser executado
   * - `false` se foi substituído por um call mais recente
   *
   * Primeiro call para uma key: retorna `true` imediatamente.
   * Calls subsequentes dentro da janela: só o último retorna `true` após delay.
   */
  debounce(key: string): Promise<boolean> {
    const now = Date.now();
    const cooldown = this.cooldowns.get(key);

    // Primeiro call (ou cooldown expirou): executar imediatamente
    if (!cooldown || now >= cooldown.expiresAt) {
      // Marcar cooldown para que calls futuros dentro da janela sejam debounced
      this.cooldowns.set(key, { expiresAt: now + this.delayMs });
      return Promise.resolve(true);
    }

    // Call subsequente dentro da janela — debounce
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
          // Renovar cooldown
          this.cooldowns.set(key, { expiresAt: Date.now() + this.delayMs });
          logger.info({ key, debounced: newCount }, 'Debounce: executando após agrupar comandos');
          resolve(true);
        }, this.delayMs);

        this.pending.set(key, { timer, resolve, count: newCount });
      });
    }

    // Segundo call (primeiro debounce)
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        this.cooldowns.set(key, { expiresAt: Date.now() + this.delayMs });
        resolve(true);
      }, this.delayMs);

      this.pending.set(key, { timer, resolve, count: 2 });
    });
  }

  /**
   * Limpa todos os timers pendentes e cooldowns.
   */
  cleanup(): void {
    for (const [, entry] of this.pending.entries()) {
      clearTimeout(entry.timer);
      entry.resolve(false);
    }
    this.pending.clear();

    // Limpar cooldowns expirados
    const now = Date.now();
    for (const [key, cooldown] of this.cooldowns.entries()) {
      if (now >= cooldown.expiresAt) {
        this.cooldowns.delete(key);
      }
    }
  }
}
