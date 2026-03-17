/**
 * OpenAI TTS Provider — fallback para geração de áudio de podcast.
 *
 * Sintetiza cada linha separadamente com vozes diferentes,
 * depois concatena via ffmpeg em um único OGG Opus.
 */
import OpenAI from 'openai';
import { ITTSProvider, TTSRequest, TTSResponse } from '../types';
import { config } from '../config';
import { execFile } from 'child_process';
import { writeFile, readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import pino from 'pino';

const logger = pino({ level: config.logLevel });

const VOICE_MAP: Record<string, string> = {
  host1: 'alloy',
  host2: 'nova',
};

export class OpenAITTSProvider implements ITTSProvider {
  readonly name = 'openai';
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({ apiKey: config.llm.openai.apiKey });
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const startMs = Date.now();
    const tempFiles: string[] = [];

    try {
      const timestamp = Date.now();
      const chunkPaths: string[] = [];

      logger.info({ lines: request.script.length }, 'Gerando áudio via OpenAI TTS');

      // Sintetizar cada linha com a voz do speaker correspondente
      for (let i = 0; i < request.script.length; i++) {
        const line = request.script[i];
        const voice = VOICE_MAP[line.speaker] || 'alloy';

        const response = await this.client.audio.speech.create({
          model: 'tts-1',
          voice: voice as 'alloy' | 'nova' | 'echo' | 'fable' | 'onyx' | 'shimmer',
          input: line.text,
          response_format: 'opus',
        });

        const buffer = Buffer.from(await response.arrayBuffer());
        const chunkPath = join(tmpdir(), `wa-podcast-${timestamp}-${i}.opus`);
        await writeFile(chunkPath, buffer);
        chunkPaths.push(chunkPath);
        tempFiles.push(chunkPath);
      }

      // Criar arquivo de lista para ffmpeg concat
      const listPath = join(tmpdir(), `wa-podcast-${timestamp}-list.txt`);
      const listContent = chunkPaths.map((p) => `file '${p}'`).join('\n');
      await writeFile(listPath, listContent);
      tempFiles.push(listPath);

      // Concatenar todos os chunks em um único OGG Opus
      const outputPath = join(tmpdir(), `wa-podcast-${timestamp}-final.ogg`);
      tempFiles.push(outputPath);

      await new Promise<void>((resolve, reject) => {
        execFile(
          'ffmpeg',
          [
            '-y',
            '-f', 'concat',
            '-safe', '0',
            '-i', listPath,
            '-c:a', 'libopus',
            '-b:a', '32k',
            '-vbr', 'on',
            '-application', 'voip',
            outputPath,
          ],
          { timeout: 30000 },
          (error, _stdout, stderr) => {
            if (error) {
              logger.error({ error, stderr }, 'Erro no ffmpeg concat');
              reject(new Error(`ffmpeg concat falhou: ${error.message}`));
            } else {
              resolve();
            }
          }
        );
      });

      const oggBuffer = await readFile(outputPath);

      // Obter duração via ffprobe
      const durationSeconds = await this.getDuration(outputPath);

      // Estimar custo ($15/1M chars para tts-1)
      const totalChars = request.script.reduce((sum, line) => sum + line.text.length, 0);
      const estimatedCostUsd = (totalChars / 1_000_000) * 15.0;

      logger.info(
        { durationSeconds, oggBytes: oggBuffer.length, lines: request.script.length, ms: Date.now() - startMs },
        'Áudio podcast gerado via OpenAI TTS'
      );

      return {
        audioBuffer: oggBuffer,
        durationSeconds,
        provider: 'openai',
        estimatedCostUsd,
      };
    } finally {
      // Cleanup de todos os arquivos temporários
      for (const f of tempFiles) {
        unlink(f).catch(() => {});
      }
    }
  }

  async healthCheck(): Promise<boolean> {
    return !!config.llm.openai.apiKey;
  }

  /**
   * Obtém a duração do áudio via ffprobe.
   */
  private getDuration(filePath: string): Promise<number> {
    return new Promise((resolve) => {
      execFile(
        'ffprobe',
        ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
        { timeout: 5000 },
        (error, stdout) => {
          if (error) {
            resolve(0);
          } else {
            resolve(Math.round(parseFloat(stdout.trim()) || 0));
          }
        }
      );
    });
  }
}
