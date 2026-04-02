/**
 * Rate Limit Manager — camada multi-tier sobre o RateLimiter.
 *
 * Combina limites por-usuário, por-grupo e por-tipo de comando
 * em um único ponto de verificação.
 *
 * Tiers:
 * 1. Per-user burst:      2 comandos / 30s   (qualquer comando)
 * 2. Per-user LLM/hora:   5 comandos / 1h    (só comandos LLM)
 * 3. Per-group LLM/hora:  15 comandos / 1h   (só comandos LLM)
 * 4. Per-user cheap:       10 comandos / 60s  (comandos sem LLM)
 * 5. DM:                   3 mensagens / 5min (conversas DM)
 * 6. Conversation (grupo): 10 mensagens / 5min
 */
import { RateLimitResult } from '../types';
import { RateLimiter } from './rate-limiter';

export interface RateLimitCheckResult extends RateLimitResult {
  /** Qual tier bloqueou (para mensagem contextual) */
  tier?: 'burst' | 'user-llm' | 'group-llm' | 'user-cheap' | 'dm' | 'conversation';
}

export class RateLimitManager {
  private perUserBurst: RateLimiter;
  private perUserHourlyLLM: RateLimiter;
  private perGroupHourlyLLM: RateLimiter;
  private perUserCheap: RateLimiter;
  private dmLimiter: RateLimiter;
  private conversationLimiter: RateLimiter;

  constructor() {
    this.perUserBurst = new RateLimiter(2, 30);
    this.perUserHourlyLLM = new RateLimiter(5, 3600);
    this.perGroupHourlyLLM = new RateLimiter(15, 3600);
    this.perUserCheap = new RateLimiter(10, 60);
    this.dmLimiter = new RateLimiter(3, 300);
    this.conversationLimiter = new RateLimiter(10, 300);
  }

  /**
   * Verifica todos os tiers aplicáveis para um comando.
   * Só consome quotas se TODOS os tiers permitirem.
   */
  checkCommand(senderId: string, groupId: string, isLLM: boolean): RateLimitCheckResult {
    const burstKey = `burst:${senderId}`;

    // 1. Peek all applicable tiers first
    const burstCheck = this.perUserBurst.peek(burstKey);
    if (!burstCheck.allowed) {
      return { ...burstCheck, tier: 'burst' };
    }

    if (isLLM) {
      const userLLMCheck = this.perUserHourlyLLM.peek(`user-llm:${senderId}`);
      if (!userLLMCheck.allowed) {
        return { ...userLLMCheck, tier: 'user-llm' };
      }

      const groupLLMCheck = this.perGroupHourlyLLM.peek(`group-llm:${groupId}`);
      if (!groupLLMCheck.allowed) {
        return { ...groupLLMCheck, tier: 'group-llm' };
      }

      // All passed — consume all
      this.perUserBurst.consume(burstKey);
      this.perUserHourlyLLM.consume(`user-llm:${senderId}`);
      this.perGroupHourlyLLM.consume(`group-llm:${groupId}`);
    } else {
      const cheapCheck = this.perUserCheap.peek(`cheap:${senderId}`);
      if (!cheapCheck.allowed) {
        return { ...cheapCheck, tier: 'user-cheap' };
      }

      // All passed — consume all
      this.perUserBurst.consume(burstKey);
      this.perUserCheap.consume(`cheap:${senderId}`);
    }

    return { allowed: true, retryAfterSeconds: 0 };
  }

  /**
   * Verifica rate limit para DM conversacional.
   */
  checkDM(senderId: string): RateLimitCheckResult {
    const result = this.dmLimiter.consume(`dm:${senderId}`);
    return { ...result, tier: result.allowed ? undefined : 'dm' };
  }

  /**
   * Verifica rate limit para conversa em grupo (@mention).
   */
  checkConversation(groupId: string): RateLimitCheckResult {
    const result = this.conversationLimiter.consume(`conv:${groupId}`);
    return { ...result, tier: result.allowed ? undefined : 'conversation' };
  }

  /**
   * Limpa entradas expiradas de todos os tiers.
   */
  cleanup(): void {
    this.perUserBurst.cleanup();
    this.perUserHourlyLLM.cleanup();
    this.perGroupHourlyLLM.cleanup();
    this.perUserCheap.cleanup();
    this.dmLimiter.cleanup();
    this.conversationLimiter.cleanup();
  }
}
