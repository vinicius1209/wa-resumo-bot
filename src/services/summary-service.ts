/**
 * Serviço de Resumo — orquestra storage + LLM + rate limit.
 *
 * Responsabilidades:
 * - Buscar mensagens do storage
 * - Parsear argumentos do usuário (período, quantidade)
 * - Chamar o LLM provider
 * - Formatar a resposta final
 */
import { IMessageStorage, ILLMProvider, StoredMessage } from '../types';
import { AnalyticsService } from './analytics-service';
import { eventBus } from './event-bus';
import { config } from '../config';
import { fetchGroupMessages } from '../utils/message-fetcher';
import pino from 'pino';

const logger = pino({ level: config.logLevel });

export interface SummaryResult {
  success: boolean;
  text: string;
  messageCount?: number;
  provider?: string;
  model?: string;
}

export class SummaryService {
  private analytics: AnalyticsService | null = null;

  constructor(
    private storage: IMessageStorage,
    private llmProvider: ILLMProvider,
  ) {}

  setAnalytics(analytics: AnalyticsService): void {
    this.analytics = analytics;
  }

  /**
   * Gera um resumo para um grupo.
   *
   * @param groupId - JID do grupo
   * @param senderId - quem solicitou (para rate limit)
   * @param args - argumentos opcionais ("2h", "hoje", "50 mensagens")
   */
  async generateSummary(
    groupId: string,
    senderId: string,
    args: string
  ): Promise<SummaryResult> {
    // 1. Buscar mensagens
    let messages: StoredMessage[];
    try {
      messages = await fetchGroupMessages(this.storage, groupId, args);
    } catch (error) {
      logger.error({ error, groupId }, 'Erro ao buscar mensagens');
      return {
        success: false,
        text: '❌ Erro ao buscar mensagens do grupo.',
      };
    }

    // Filtrar comandos do bot e respostas do bot
    const prefix = config.bot.commandPrefix;
    messages = messages.filter((m) => !m.content.startsWith(prefix) && !m.content.startsWith('🔄') && !m.content.startsWith('📋'));

    if (messages.length === 0) {
      return {
        success: false,
        text: '📭 Nenhuma mensagem encontrada no período solicitado.',
      };
    }

    if (messages.length < 3) {
      return {
        success: false,
        text: '📭 Poucas mensagens para gerar um resumo (mínimo 3).',
      };
    }

    // 3. Chamar a LLM
    const llmStart = Date.now();
    try {
      logger.info(
        { groupId, messageCount: messages.length, provider: this.llmProvider.name },
        'Gerando resumo...'
      );

      const response = await this.llmProvider.summarize({
        messages,
        language: config.summary.language,
        userInstruction: args || undefined,
      });

      const llmDurationMs = Date.now() - llmStart;

      this.analytics?.track({
        eventType: 'llm_call',
        groupId,
        senderId,
        provider: response.provider,
        model: response.model,
        tokensInput: response.tokensUsed.input,
        tokensOutput: response.tokensUsed.output,
        durationMs: llmDurationMs,
        success: true,
        metadata: { messageCount: messages.length },
      });

      eventBus.emitLLMCall(
        response.provider,
        response.model,
        response.tokensUsed.input,
        response.tokensUsed.output,
        0,
        llmDurationMs
      );

      const header = `📋 *Resumo* (${messages.length} mensagens | ${response.provider}/${response.model})`;

      return {
        success: true,
        text: `${header}\n\n${response.summary}`,
        messageCount: messages.length,
        provider: response.provider,
        model: response.model,
      };
    } catch (error) {
      this.analytics?.track({
        eventType: 'llm_call',
        groupId,
        senderId,
        provider: this.llmProvider.name,
        durationMs: Date.now() - llmStart,
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });

      logger.error({ error, groupId }, 'Erro ao gerar resumo com LLM');
      return {
        success: false,
        text: '❌ Erro ao gerar resumo. Tente novamente em alguns instantes.',
      };
    }
  }

}
