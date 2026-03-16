/**
 * Event Bus — EventEmitter centralizado para comunicação entre serviços.
 *
 * Singleton simples. Todos os serviços podem emitir eventos aqui,
 * e o dashboard (WebSocket, etc.) pode escutar.
 */
import { EventEmitter } from 'events';

export interface BotEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

class EventBus extends EventEmitter {
  /**
   * Emite um evento genérico do bot.
   * @param type - Tipo do evento (ex: 'message', 'command', 'error')
   * @param data - Dados associados ao evento
   */
  emitBotEvent(type: string, data: Record<string, unknown>): void {
    this.emit('bot:event', { type, data, timestamp: Date.now() });
  }

  emitMessage(groupId: string, senderName: string, content: string, messageType: string): void {
    this.emitBotEvent('message', { groupId, senderName, content: content.substring(0, 200), messageType });
  }

  emitCommand(groupId: string, senderName: string, command: string, durationMs: number, success: boolean): void {
    this.emitBotEvent('command', { groupId, senderName, command, durationMs, success });
  }

  emitMedia(groupId: string, mediaType: string, durationMs: number): void {
    this.emitBotEvent('media', { groupId, mediaType, durationMs });
  }

  emitSentiment(groupId: string, score: number, label: string): void {
    this.emitBotEvent('sentiment', { groupId, score, label });
  }

  emitError(service: string, message: string): void {
    this.emitBotEvent('error', { service, message });
  }

  emitLLMCall(provider: string, model: string, tokensInput: number, tokensOutput: number, costUsd: number, durationMs: number): void {
    this.emitBotEvent('llm_call', { provider, model, tokensInput, tokensOutput, costUsd, durationMs });
  }
}

/** Instância singleton do EventBus */
export const eventBus = new EventBus();
