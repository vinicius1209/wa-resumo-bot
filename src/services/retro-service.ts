/**
 * Serviço de Retrospectiva Semanal — gera narrativa divertida com LLM.
 *
 * Usa o LLM diretamente (OpenAI ou Anthropic) para gerar um wrap-up
 * semanal em tom zoeiro com premiações e ranking.
 */
import Database from 'better-sqlite3';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import pino from 'pino';
import { config } from '../config';
import { WeeklyStats } from './stats-service';

const logger = pino({ level: config.logLevel });

export class RetroService {
  private db: Database.Database | null = null;

  /**
   * Inicializa a tabela de estatísticas de grupo.
   */
  initTable(db: Database.Database): void {
    this.db = db;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS group_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id TEXT NOT NULL,
        period_start INTEGER NOT NULL,
        period_end INTEGER NOT NULL,
        stats_json TEXT NOT NULL,
        narrative TEXT,
        created_at INTEGER DEFAULT (unixepoch())
      );
    `);

    logger.debug('RetroService: tabela group_stats inicializada');
  }

  /**
   * Gera a retrospectiva semanal narrativa usando o LLM configurado.
   */
  async generateRetro(
    groupId: string,
    stats: WeeklyStats
  ): Promise<string> {
    const prompt = this.buildPrompt(stats);

    logger.info(
      { groupId, provider: config.llm.provider },
      'Gerando retrospectiva semanal'
    );

    let narrative: string;

    if (config.llm.provider === 'anthropic') {
      narrative = await this.callAnthropic(prompt);
    } else {
      narrative = await this.callOpenAI(prompt);
    }

    // Salvar no banco
    this.saveStats(groupId, stats, narrative);

    return narrative;
  }

  private buildPrompt(stats: WeeklyStats): string {
    const ranking = stats.messagesByPerson
      .map((p, i) => `${i + 1}. ${p.name} — ${p.count} mensagens`)
      .join('\n');

    const mediaLines = Object.entries(stats.mediaByType)
      .map(([type, count]) => `- ${type}: ${count}`)
      .join('\n');

    const awards: string[] = [];

    if (stats.nightOwl) {
      awards.push(
        `🦉 Coruja da Semana: ${stats.nightOwl.name} (${stats.nightOwl.count} mensagens entre 00h e 06h)`
      );
    }
    if (stats.audioKing) {
      awards.push(
        `🎙️ Rei do Áudio: ${stats.audioKing.name} (${stats.audioKing.count} áudios)`
      );
    }
    if (stats.stickerKing) {
      awards.push(
        `🃏 Rei do Sticker: ${stats.stickerKing.name} (${stats.stickerKing.count} stickers)`
      );
    }
    if (stats.longestMessage.length > 0) {
      awards.push(
        `📜 Textão da Semana: ${stats.longestMessage.name} (mensagem de ${stats.longestMessage.length} caracteres)`
      );
    }

    return `Você é um apresentador de retrospectiva semanal de um grupo de WhatsApp. Seu tom deve ser zoeiro, divertido e descontraído, como um amigo do grupo que tá fazendo o wrap-up da semana. Escreva em pt-BR.

## Dados da semana:

- Total de mensagens: ${stats.totalMessages}
- Horário de pico: ${stats.peakHour}h
- Dia mais ativo: ${stats.mostActiveDay}

### Ranking de tagarelas:
${ranking}

### Mídias enviadas:
${mediaLines || 'Nenhuma mídia'}

### Premiações:
${awards.length > 0 ? awards.join('\n') : 'Nenhuma premiação especial esta semana'}

## Instruções:

1. Comece com um título chamativo tipo "🏆 RETROSPECTIVA SEMANAL 🏆"
2. Faça um ranking zoeiro dos top falantes com comentários engraçados
3. Entregue as premiações (Coruja da Semana, Rei do Áudio, Rei do Sticker, Textão da Semana) de forma divertida
4. Mencione o horário de pico e o dia mais movimentado com humor
5. Finalize com uma frase de efeito ou provocação leve pro grupo
6. Use emojis moderadamente
7. Mantenha curto e direto — no máximo 2000 caracteres
8. NÃO invente dados. Use APENAS os números fornecidos acima.`;
  }

  private async callOpenAI(prompt: string): Promise<string> {
    const client = new OpenAI({ apiKey: config.llm.openai.apiKey });

    const response = await client.chat.completions.create({
      model: config.llm.openai.model,
      temperature: 0.7,
      max_tokens: 2000,
      messages: [
        { role: 'user', content: prompt },
      ],
    });

    return response.choices[0]?.message?.content ?? 'Não foi possível gerar a retrospectiva.';
  }

  private async callAnthropic(prompt: string): Promise<string> {
    const client = new Anthropic({ apiKey: config.llm.anthropic.apiKey });

    const response = await client.messages.create({
      model: config.llm.anthropic.model,
      max_tokens: 2000,
      temperature: 0.7,
      messages: [
        { role: 'user', content: prompt },
      ],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    return textBlock && 'text' in textBlock
      ? textBlock.text
      : 'Não foi possível gerar a retrospectiva.';
  }

  private saveStats(
    groupId: string,
    stats: WeeklyStats,
    narrative: string
  ): void {
    if (!this.db) return;

    try {
      const now = Math.floor(Date.now() / 1000);
      const weekAgo = now - 7 * 24 * 60 * 60;

      const stmt = this.db.prepare(`
        INSERT INTO group_stats (group_id, period_start, period_end, stats_json, narrative)
        VALUES (?, ?, ?, ?, ?)
      `);

      stmt.run(groupId, weekAgo, now, JSON.stringify(stats), narrative);

      logger.debug({ groupId }, 'RetroService: estatísticas salvas');
    } catch (error) {
      logger.warn({ error }, 'RetroService: erro ao salvar estatísticas');
    }
  }
}
