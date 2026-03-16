/**
 * Processador de mídia — descreve imagens/vídeos via visão e transcreve áudios via Whisper.
 *
 * Processa tudo em memória (baixa, processa, descarta).
 * Usa OpenAI para Whisper (transcrição) e o provider configurado para visão.
 */
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { execFile } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { IMediaProcessor } from '../types';
import { config } from '../config';
import pino from 'pino';

const logger = pino({ level: config.logLevel });

const VISION_PROMPT = 'Descreva esta imagem de forma breve e objetiva em uma ou duas frases, em português.';

export class MediaProcessor implements IMediaProcessor {
  private openaiClient: OpenAI | null;
  private anthropicClient: Anthropic | null;
  private provider: string;

  constructor() {
    this.provider = config.llm.provider;

    // OpenAI é necessário para Whisper (transcrição de áudio) independente do provider
    this.openaiClient = config.llm.openai.apiKey
      ? new OpenAI({ apiKey: config.llm.openai.apiKey })
      : null;

    this.anthropicClient = config.llm.anthropic.apiKey
      ? new Anthropic({ apiKey: config.llm.anthropic.apiKey })
      : null;
  }

  async processImage(buffer: Buffer, mimeType: string): Promise<string> {
    const base64 = buffer.toString('base64');

    if (this.provider === 'anthropic' && this.anthropicClient) {
      return this.describeImageAnthropic(base64, mimeType);
    }
    if (this.openaiClient) {
      return this.describeImageOpenAI(base64, mimeType);
    }

    return '[Imagem não processada: nenhum provider de visão configurado]';
  }

  async processAudio(buffer: Buffer, mimeType: string): Promise<string> {
    if (!this.openaiClient) {
      return '[Áudio não transcrito: OPENAI_API_KEY necessária para Whisper]';
    }

    const ext = this.audioExtension(mimeType);
    const tmpPath = path.join(tmpdir(), `wa-audio-${Date.now()}.${ext}`);

    try {
      await writeFile(tmpPath, buffer);

      const file = await import('fs');
      const transcription = await this.openaiClient.audio.transcriptions.create({
        file: file.createReadStream(tmpPath),
        model: 'whisper-1',
      });

      return transcription.text || '[Áudio sem conteúdo audível]';
    } finally {
      await unlink(tmpPath).catch(() => {});
    }
  }

  async processVideo(buffer: Buffer, mimeType: string): Promise<string> {
    const ext = mimeType.includes('mp4') ? 'mp4' : 'vid';
    const tmpVideo = path.join(tmpdir(), `wa-video-${Date.now()}.${ext}`);
    const tmpFrame = path.join(tmpdir(), `wa-frame-${Date.now()}.jpg`);

    try {
      await writeFile(tmpVideo, buffer);

      // Extrair frame do meio do vídeo
      await this.extractFrame(tmpVideo, tmpFrame);

      const { readFile } = await import('fs/promises');
      const frameBuffer = await readFile(tmpFrame);

      return this.processImage(frameBuffer, 'image/jpeg');
    } catch (error) {
      logger.warn({ error }, 'Erro ao processar vídeo (ffmpeg instalado?)');
      return '[Vídeo não processado: erro ao extrair frame]';
    } finally {
      await unlink(tmpVideo).catch(() => {});
      await unlink(tmpFrame).catch(() => {});
    }
  }

  private async describeImageOpenAI(base64: string, mimeType: string): Promise<string> {
    const response = await this.openaiClient!.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: VISION_PROMPT },
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'low' },
            },
          ],
        },
      ],
      max_tokens: 300,
    });

    return response.choices[0]?.message?.content || '[Imagem sem descrição]';
  }

  private async describeImageAnthropic(base64: string, mimeType: string): Promise<string> {
    const mediaType = mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

    const response = await this.anthropicClient!.messages.create({
      model: config.llm.anthropic.model,
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            { type: 'text', text: VISION_PROMPT },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    return textBlock && 'text' in textBlock ? textBlock.text : '[Imagem sem descrição]';
  }

  private extractFrame(videoPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Extrair frame aos 1 segundo do vídeo
      execFile(
        'ffmpeg',
        ['-i', videoPath, '-ss', '1', '-frames:v', '1', '-q:v', '2', outputPath, '-y'],
        { timeout: 15000 },
        (error) => {
          if (error) reject(error);
          else resolve();
        }
      );
    });
  }

  private audioExtension(mimeType: string): string {
    if (mimeType.includes('ogg')) return 'ogg';
    if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a';
    if (mimeType.includes('mpeg')) return 'mp3';
    if (mimeType.includes('wav')) return 'wav';
    return 'ogg'; // WhatsApp default
  }
}
