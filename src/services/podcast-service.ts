/**
 * Serviço de Podcast — orquestra resumo + roteiro + TTS.
 *
 * Pipeline:
 * 1. Buscar mensagens do grupo
 * 2. Verificar cache (hash das mensagens)
 * 3. Se cache hit → retornar áudio imediatamente
 * 4. Se cache miss → gerar resumo + roteiro + TTS
 * 5. Salvar no cache e retornar
 */
import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { IMessageStorage, ILLMProvider, ITTSProvider, StoredMessage, PodcastLine } from '../types';
import { AnalyticsService } from './analytics-service';
import { eventBus } from './event-bus';
import { config } from '../config';
import { fetchGroupMessages } from '../utils/message-fetcher';
import { PODCAST_SYSTEM_PROMPT, buildPodcastUserPrompt } from '../llm/podcast-prompt';
import pino from 'pino';

const logger = pino({ level: config.logLevel });

/** TTL do cache em segundos (15 minutos) */
const CACHE_TTL_SECONDS = 15 * 60;

export interface PodcastResult {
  success: boolean;
  audioBuffer?: Buffer;
  durationSeconds?: number;
  messageCount?: number;
  llmProvider?: string;
  llmModel?: string;
  ttsProvider?: string;
  estimatedCostUsd?: number;
  errorMessage?: string;
  /** true quando o resultado veio do cache */
  cached?: boolean;
}

export class PodcastService {
  private analytics: AnalyticsService | null = null;
  private db: Database.Database | null = null;

  constructor(
    private storage: IMessageStorage,
    private llmProvider: ILLMProvider,
    private ttsProvider: ITTSProvider,
  ) {}

  setAnalytics(analytics: AnalyticsService): void {
    this.analytics = analytics;
  }

  /**
   * Inicializa a tabela de cache no SQLite.
   */
  initTable(db: Database.Database): void {
    this.db = db;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS podcast_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id TEXT NOT NULL,
        messages_hash TEXT NOT NULL,
        audio_blob BLOB NOT NULL,
        duration_seconds INTEGER NOT NULL,
        message_count INTEGER NOT NULL,
        tts_provider TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch()),
        UNIQUE(group_id, messages_hash)
      );

      CREATE INDEX IF NOT EXISTS idx_podcast_cache_group
        ON podcast_cache(group_id, created_at);
    `);

    logger.debug('PodcastService: tabela podcast_cache pronta');
  }

  /**
   * Gera um podcast em áudio para um grupo.
   */
  async generatePodcast(
    groupId: string,
    senderId: string,
    args: string
  ): Promise<PodcastResult> {
    const totalStart = Date.now();

    // 1. Buscar mensagens
    let messages: StoredMessage[];
    try {
      messages = await fetchGroupMessages(this.storage, groupId, args);
    } catch (error) {
      logger.error({ error, groupId }, 'Erro ao buscar mensagens para podcast');
      return { success: false, errorMessage: '❌ Erro ao buscar mensagens do grupo.' };
    }

    // Filtrar comandos e respostas do bot
    const prefix = config.bot.commandPrefix;
    messages = messages.filter(
      (m) => !m.content.startsWith(prefix) && !m.content.startsWith('🔄') && !m.content.startsWith('📋') && !m.content.startsWith('🎙️')
    );

    if (messages.length < 3) {
      return { success: false, errorMessage: '📭 Poucas mensagens para gerar um podcast (mínimo 3).' };
    }

    // 2. Verificar cache
    const messagesHash = this.computeHash(messages);
    const cached = this.getFromCache(groupId, messagesHash);

    if (cached) {
      logger.info(
        { groupId, messageCount: messages.length, ms: Date.now() - totalStart },
        'Podcast servido do cache'
      );
      return {
        success: true,
        audioBuffer: cached.audio_blob,
        durationSeconds: cached.duration_seconds,
        messageCount: cached.message_count,
        ttsProvider: cached.tts_provider,
        cached: true,
      };
    }

    // 3. Gerar resumo texto via LLM
    let summaryText: string;
    let llmProvider: string;
    let llmModel: string;
    try {
      const llmStart = Date.now();
      const summaryResponse = await this.llmProvider.summarize({
        messages,
        language: config.summary.language,
        userInstruction: args || undefined,
      });

      summaryText = summaryResponse.summary;
      llmProvider = summaryResponse.provider;
      llmModel = summaryResponse.model;

      this.analytics?.track({
        eventType: 'llm_call',
        groupId,
        senderId,
        provider: summaryResponse.provider,
        model: summaryResponse.model,
        tokensInput: summaryResponse.tokensUsed.input,
        tokensOutput: summaryResponse.tokensUsed.output,
        durationMs: Date.now() - llmStart,
        success: true,
        metadata: { purpose: 'podcast_summary', messageCount: messages.length },
      });

      logger.info({ groupId, summaryLength: summaryText.length }, 'Resumo gerado para podcast');
    } catch (error) {
      logger.error({ error, groupId }, 'Erro ao gerar resumo para podcast');
      return { success: false, errorMessage: '❌ Erro ao gerar resumo. Tente novamente.' };
    }

    // 4. Gerar roteiro de podcast via LLM chat()
    let script: PodcastLine[];
    try {
      if (!this.llmProvider.chat) {
        return { success: false, errorMessage: '❌ Provider LLM não suporta chat (necessário para roteiro).' };
      }

      const scriptStart = Date.now();
      const scriptResponse = await this.llmProvider.chat({
        messages: [
          { role: 'system', content: PODCAST_SYSTEM_PROMPT },
          { role: 'user', content: buildPodcastUserPrompt(summaryText, messages.length) },
        ],
        temperature: 0.8,
        maxTokens: 4000,
      });

      script = this.parseScript(scriptResponse.content);

      this.analytics?.track({
        eventType: 'llm_call',
        groupId,
        senderId,
        provider: scriptResponse.provider,
        model: scriptResponse.model,
        tokensInput: scriptResponse.tokensUsed.input,
        tokensOutput: scriptResponse.tokensUsed.output,
        durationMs: Date.now() - scriptStart,
        success: true,
        metadata: { purpose: 'podcast_script', scriptLines: script.length },
      });

      logger.info({ groupId, scriptLines: script.length }, 'Roteiro de podcast gerado');
    } catch (error) {
      logger.error({ error, groupId }, 'Erro ao gerar roteiro de podcast');
      return { success: false, errorMessage: '❌ Erro ao gerar roteiro do podcast. Tente novamente.' };
    }

    // 5. Sintetizar áudio via TTS
    try {
      const ttsResponse = await this.ttsProvider.synthesize({ script });

      this.analytics?.track({
        eventType: 'llm_call',
        groupId,
        senderId,
        provider: ttsResponse.provider,
        model: config.podcast.geminiModel,
        estimatedCostUsd: ttsResponse.estimatedCostUsd,
        durationMs: Date.now() - totalStart,
        success: true,
        metadata: {
          purpose: 'podcast_tts',
          audioDurationSeconds: ttsResponse.durationSeconds,
          audioBytes: ttsResponse.audioBuffer.length,
        },
      });

      eventBus.emitPodcast(
        groupId,
        ttsResponse.durationSeconds,
        ttsResponse.provider,
        Date.now() - totalStart
      );

      // 6. Salvar no cache
      this.saveToCache(
        groupId,
        messagesHash,
        ttsResponse.audioBuffer,
        ttsResponse.durationSeconds,
        messages.length,
        ttsResponse.provider,
      );

      logger.info(
        {
          groupId,
          messageCount: messages.length,
          durationSeconds: ttsResponse.durationSeconds,
          totalMs: Date.now() - totalStart,
        },
        'Podcast gerado e cacheado'
      );

      return {
        success: true,
        audioBuffer: ttsResponse.audioBuffer,
        durationSeconds: ttsResponse.durationSeconds,
        messageCount: messages.length,
        llmProvider,
        llmModel,
        ttsProvider: ttsResponse.provider,
        estimatedCostUsd: ttsResponse.estimatedCostUsd,
        cached: false,
      };
    } catch (error) {
      logger.error({ error, groupId }, 'Erro ao sintetizar áudio do podcast');
      return { success: false, errorMessage: '❌ Erro ao gerar áudio. Serviço TTS indisponível.' };
    }
  }

  /**
   * Remove entradas expiradas do cache.
   */
  cleanup(): void {
    if (!this.db) return;
    const expiry = Math.floor(Date.now() / 1000) - CACHE_TTL_SECONDS;
    const result = this.db.prepare('DELETE FROM podcast_cache WHERE created_at < ?').run(expiry);
    if (result.changes > 0) {
      logger.info({ purged: result.changes }, 'Cache de podcasts limpo');
    }
  }

  /**
   * Calcula hash SHA-256 das mensagens para chave de cache.
   * Baseado nos IDs e timestamps — muda se qualquer mensagem for adicionada/removida.
   */
  private computeHash(messages: StoredMessage[]): string {
    const payload = messages
      .map((m) => `${m.id}:${m.timestamp}`)
      .join('|');
    return createHash('sha256').update(payload).digest('hex').substring(0, 16);
  }

  /**
   * Busca podcast no cache. Retorna null se não encontrado ou expirado.
   */
  private getFromCache(
    groupId: string,
    messagesHash: string
  ): { audio_blob: Buffer; duration_seconds: number; message_count: number; tts_provider: string } | null {
    if (!this.db) return null;

    const expiry = Math.floor(Date.now() / 1000) - CACHE_TTL_SECONDS;

    return this.db.prepare(`
      SELECT audio_blob, duration_seconds, message_count, tts_provider
      FROM podcast_cache
      WHERE group_id = ? AND messages_hash = ? AND created_at >= ?
    `).get(groupId, messagesHash, expiry) as {
      audio_blob: Buffer; duration_seconds: number; message_count: number; tts_provider: string;
    } | null;
  }

  /**
   * Salva podcast no cache. Usa REPLACE para evitar duplicatas.
   */
  private saveToCache(
    groupId: string,
    messagesHash: string,
    audioBlob: Buffer,
    durationSeconds: number,
    messageCount: number,
    ttsProvider: string,
  ): void {
    if (!this.db) return;

    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO podcast_cache
          (group_id, messages_hash, audio_blob, duration_seconds, message_count, tts_provider, created_at)
        VALUES (?, ?, ?, ?, ?, ?, unixepoch())
      `).run(groupId, messagesHash, audioBlob, durationSeconds, messageCount, ttsProvider);
    } catch (error) {
      logger.warn({ error, groupId }, 'Erro ao salvar podcast no cache');
    }
  }

  /**
   * Parseia o JSON do roteiro retornado pelo LLM.
   * Trata markdown fences e variações de formato.
   */
  private parseScript(raw: string): PodcastLine[] {
    // Strip markdown code fences se presentes
    let cleaned = raw.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
    cleaned = cleaned.trim();

    let parsed: { lines: Array<{ speaker: string; text: string }> };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error(`Falha ao parsear roteiro JSON: ${cleaned.substring(0, 200)}`);
    }

    if (!parsed.lines || !Array.isArray(parsed.lines) || parsed.lines.length === 0) {
      throw new Error('Roteiro inválido: campo "lines" vazio ou ausente');
    }

    return parsed.lines.map((line) => ({
      speaker: line.speaker === 'host2' ? 'host2' : 'host1',
      text: line.text,
    }));
  }
}
