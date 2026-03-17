/**
 * Utilitário para buscar mensagens do storage com parsing de argumentos.
 *
 * Compartilhado entre SummaryService e PodcastService.
 *
 * Suporta:
 * - Vazio ou sem args → últimas N mensagens (config)
 * - "1h", "2h", "30min" → últimas X horas/minutos
 * - "hoje" → desde meia-noite
 * - "50" ou "50 mensagens" → últimas 50 mensagens
 */
import { IMessageStorage, StoredMessage } from '../types';
import { config } from '../config';

export async function fetchGroupMessages(
  storage: IMessageStorage,
  groupId: string,
  args: string,
  maxMessages: number = config.summary.maxMessages
): Promise<StoredMessage[]> {
  const trimmed = args.trim().toLowerCase();

  // Sem argumentos → padrão
  if (!trimmed) {
    return storage.getMessages(groupId, maxMessages);
  }

  // Padrão de tempo: "2h", "30min", "1hora"
  const timeMatch = trimmed.match(/^(\d+)\s*(h|hora|horas|min|minutos?)$/);
  if (timeMatch) {
    const value = parseInt(timeMatch[1]);
    const unit = timeMatch[2];
    let ms: number;

    if (unit.startsWith('h')) {
      ms = value * 60 * 60 * 1000;
    } else {
      ms = value * 60 * 1000;
    }

    const from = Math.floor((Date.now() - ms) / 1000);
    const to = Math.floor(Date.now() / 1000);
    return storage.getMessagesByTimeRange(groupId, from, to);
  }

  // "hoje"
  if (trimmed === 'hoje') {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const from = Math.floor(startOfDay.getTime() / 1000);
    const to = Math.floor(Date.now() / 1000);
    return storage.getMessagesByTimeRange(groupId, from, to);
  }

  // Número de mensagens: "50", "50 mensagens", "100 msgs"
  const countMatch = trimmed.match(/^(\d+)\s*(mensagens?|msgs?)?$/);
  if (countMatch) {
    const count = Math.min(parseInt(countMatch[1]), 500); // Limite de segurança
    return storage.getMessages(groupId, count);
  }

  // Fallback: usa como instrução extra e pega as últimas mensagens padrão
  return storage.getMessages(groupId, maxMessages);
}
