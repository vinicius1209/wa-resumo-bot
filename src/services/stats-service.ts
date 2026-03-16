/**
 * Serviço de Estatísticas Semanais — calcula métricas do grupo nos últimos 7 dias.
 *
 * Usado pela RetroCommand para gerar a retrospectiva semanal.
 */
import { IMessageStorage, StoredMessage } from '../types';
import pino from 'pino';
import { config } from '../config';

const logger = pino({ level: config.logLevel });

export interface WeeklyStats {
  totalMessages: number;
  messagesByPerson: Array<{ name: string; count: number }>;
  mediaByType: Record<string, number>;
  peakHour: number;
  mostActiveDay: string;
  longestMessage: { name: string; length: number };
  audioKing: { name: string; count: number } | null;
  stickerKing: { name: string; count: number } | null;
  nightOwl: { name: string; count: number } | null;
}

const DAY_NAMES = [
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
];

export class StatsService {
  /**
   * Calcula estatísticas semanais de um grupo.
   */
  async calculateWeeklyStats(
    groupId: string,
    storage: IMessageStorage
  ): Promise<WeeklyStats> {
    const now = Math.floor(Date.now() / 1000);
    const weekAgo = now - 7 * 24 * 60 * 60;

    const messages = await storage.getMessagesByTimeRange(groupId, weekAgo, now);

    logger.info(
      { groupId, messageCount: messages.length },
      'Calculando estatísticas semanais'
    );

    // Messages per person
    const personCount = new Map<string, number>();
    // Media count by type
    const mediaByType: Record<string, number> = {};
    // Hour histogram
    const hourCount = new Map<number, number>();
    // Day-of-week histogram
    const dayCount = new Map<number, number>();
    // Longest message
    let longestMessage = { name: '', length: 0 };
    // Audio per person
    const audioCount = new Map<string, number>();
    // Sticker per person
    const stickerCount = new Map<string, number>();
    // Night owl (00h-06h)
    const nightCount = new Map<string, number>();

    for (const msg of messages) {
      const name = msg.senderName;

      // Per-person count
      personCount.set(name, (personCount.get(name) ?? 0) + 1);

      // Media by type
      if (msg.messageType !== 'text') {
        mediaByType[msg.messageType] = (mediaByType[msg.messageType] ?? 0) + 1;
      }

      // Hour and day
      const date = new Date(msg.timestamp * 1000);
      const hour = date.getHours();
      const day = date.getDay();

      hourCount.set(hour, (hourCount.get(hour) ?? 0) + 1);
      dayCount.set(day, (dayCount.get(day) ?? 0) + 1);

      // Longest message
      if (msg.content.length > longestMessage.length) {
        longestMessage = { name, length: msg.content.length };
      }

      // Audio king
      if (msg.messageType === 'audio') {
        audioCount.set(name, (audioCount.get(name) ?? 0) + 1);
      }

      // Sticker king
      if (msg.messageType === 'sticker') {
        stickerCount.set(name, (stickerCount.get(name) ?? 0) + 1);
      }

      // Night owl (00h-06h)
      if (hour >= 0 && hour < 6) {
        nightCount.set(name, (nightCount.get(name) ?? 0) + 1);
      }
    }

    // Top 10 by messages
    const messagesByPerson = Array.from(personCount.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Peak hour
    let peakHour = 0;
    let peakHourCount = 0;
    for (const [hour, count] of hourCount) {
      if (count > peakHourCount) {
        peakHour = hour;
        peakHourCount = count;
      }
    }

    // Most active day
    let mostActiveDay = 'Segunda-feira';
    let mostActiveDayCount = 0;
    for (const [day, count] of dayCount) {
      if (count > mostActiveDayCount) {
        mostActiveDay = DAY_NAMES[day];
        mostActiveDayCount = count;
      }
    }

    // Audio king
    const audioKing = this.topFromMap(audioCount);

    // Sticker king
    const stickerKing = this.topFromMap(stickerCount);

    // Night owl
    const nightOwl = this.topFromMap(nightCount);

    return {
      totalMessages: messages.length,
      messagesByPerson,
      mediaByType,
      peakHour,
      mostActiveDay,
      longestMessage,
      audioKing,
      stickerKing,
      nightOwl,
    };
  }

  private topFromMap(
    map: Map<string, number>
  ): { name: string; count: number } | null {
    if (map.size === 0) return null;

    let topName = '';
    let topCount = 0;
    for (const [name, count] of map) {
      if (count > topCount) {
        topName = name;
        topCount = count;
      }
    }

    return { name: topName, count: topCount };
  }
}
