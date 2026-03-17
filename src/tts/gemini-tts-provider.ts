/**
 * Gemini TTS Provider — converte script de podcast em áudio multi-speaker.
 *
 * Usa o Gemini 2.5 Flash TTS com suporte nativo a múltiplos speakers.
 * Output: PCM 24kHz 16-bit mono → OGG Opus via ffmpeg.
 */
import { GoogleGenAI } from '@google/genai';
import { ITTSProvider, TTSRequest, TTSResponse, PodcastLine } from '../types';
import { config } from '../config';
import { execFile } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import pino from 'pino';

const logger = pino({ level: config.logLevel });

export class GeminiTTSProvider implements ITTSProvider {
  readonly name = 'gemini';
  private client: GoogleGenAI;

  constructor() {
    this.client = new GoogleGenAI({ apiKey: config.podcast.googleApiKey });
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const startMs = Date.now();

    // Formatar script com marcadores de speaker
    const scriptText = this.formatScript(request.script);
    const totalChars = scriptText.length;

    logger.info({ scriptChars: totalChars, lines: request.script.length }, 'Gerando áudio via Gemini TTS');

    // Chamar Gemini TTS com multi-speaker
    const response = await this.client.models.generateContent({
      model: config.podcast.geminiModel,
      contents: [{ role: 'user', parts: [{ text: scriptText }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: [
              {
                speaker: 'Host1',
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: config.podcast.host1Voice },
                },
              },
              {
                speaker: 'Host2',
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: config.podcast.host2Voice },
                },
              },
            ],
          },
        },
      },
    });

    // Extrair áudio PCM da resposta
    const audioPart = response.candidates?.[0]?.content?.parts?.[0];
    if (!audioPart?.inlineData?.data) {
      throw new Error('Gemini TTS não retornou dados de áudio');
    }

    const pcmBuffer = Buffer.from(audioPart.inlineData.data, 'base64');
    const durationSeconds = pcmBuffer.length / (24000 * 2); // 24kHz, 16-bit mono

    logger.info(
      { durationSeconds: Math.round(durationSeconds), pcmBytes: pcmBuffer.length },
      'PCM recebido, convertendo para OGG Opus'
    );

    // Converter PCM para OGG Opus via ffmpeg
    const oggBuffer = await this.pcmToOggOpus(pcmBuffer);

    // Estimar custo (input $0.50/1M tokens, output $10/1M tokens de áudio)
    const estimatedCostUsd = (totalChars / 1_000_000) * 0.50 + (durationSeconds / 60) * 0.04;

    logger.info(
      { durationSeconds: Math.round(durationSeconds), oggBytes: oggBuffer.length, ms: Date.now() - startMs },
      'Áudio podcast gerado com sucesso'
    );

    return {
      audioBuffer: oggBuffer,
      durationSeconds: Math.round(durationSeconds),
      provider: 'gemini',
      estimatedCostUsd,
    };
  }

  async healthCheck(): Promise<boolean> {
    return !!config.podcast.googleApiKey;
  }

  /**
   * Formata o script para o formato multi-speaker do Gemini.
   * Usa marcadores [Host1]: e [Host2]: no texto.
   */
  private formatScript(lines: PodcastLine[]): string {
    return lines
      .map((line) => {
        const speaker = line.speaker === 'host1' ? 'Host1' : 'Host2';
        return `${speaker}: ${line.text}`;
      })
      .join('\n');
  }

  /**
   * Converte PCM 24kHz 16-bit mono para OGG Opus via ffmpeg.
   */
  private pcmToOggOpus(pcmBuffer: Buffer): Promise<Buffer> {
    const timestamp = Date.now();
    const pcmPath = join(tmpdir(), `wa-podcast-${timestamp}.pcm`);
    const oggPath = join(tmpdir(), `wa-podcast-${timestamp}.ogg`);

    return new Promise(async (resolve, reject) => {
      try {
        await writeFile(pcmPath, pcmBuffer);

        execFile(
          'ffmpeg',
          [
            '-y',
            '-f', 's16le',
            '-ar', '24000',
            '-ac', '1',
            '-i', pcmPath,
            '-c:a', 'libopus',
            '-b:a', '32k',
            '-vbr', 'on',
            '-application', 'voip',
            oggPath,
          ],
          { timeout: 30000 },
          async (error, _stdout, stderr) => {
            try {
              if (error) {
                logger.error({ error, stderr }, 'Erro no ffmpeg');
                reject(new Error(`ffmpeg falhou: ${error.message}`));
                return;
              }

              const { readFile } = await import('fs/promises');
              const oggBuffer = await readFile(oggPath);
              resolve(oggBuffer);
            } catch (readError) {
              reject(readError);
            } finally {
              // Cleanup temp files
              unlink(pcmPath).catch(() => {});
              unlink(oggPath).catch(() => {});
            }
          }
        );
      } catch (writeError) {
        unlink(pcmPath).catch(() => {});
        reject(writeError);
      }
    });
  }
}
