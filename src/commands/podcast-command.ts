/**
 * Comando /podcast — gera resumo em áudio estilo podcast.
 *
 * Aceita os mesmos argumentos que /resumo: "2h", "hoje", "50 mensagens".
 * Gera um áudio com dois apresentadores discutindo o resumo do grupo.
 */
import { ICommand, CommandContext } from '../types';
import { PodcastService } from '../services/podcast-service';

export class PodcastCommand implements ICommand {
  readonly name = 'podcast';
  readonly aliases = ['audio', 'audioresumo'];
  readonly description = 'Gera um resumo em áudio estilo podcast com dois apresentadores';
  readonly usage = '/podcast [2h | hoje | 50]';

  constructor(private podcastService: PodcastService) {}

  async execute(ctx: CommandContext): Promise<void> {
    if (!ctx.replyAudio) {
      await ctx.reply('❌ Envio de áudio não disponível.');
      return;
    }

    await ctx.reply('🎙️ Preparando podcast...');

    const result = await this.podcastService.generatePodcast(
      ctx.groupId,
      ctx.senderId,
      ctx.args
    );

    if (!result.success || !result.audioBuffer) {
      await ctx.reply(result.errorMessage || '❌ Erro ao gerar podcast.');
      return;
    }

    await ctx.replyAudio(result.audioBuffer, result.durationSeconds ?? 0);

    const duration = result.durationSeconds ?? 0;
    const min = Math.floor(duration / 60);
    const sec = duration % 60;
    const timeStr = min > 0 ? `${min}min${sec > 0 ? `${sec}s` : ''}` : `${sec}s`;

    const cacheTag = result.cached ? ' | cache' : '';
    await ctx.reply(
      `🎙️ *Podcast gerado!* (${result.messageCount} msgs | ${timeStr} | ${result.ttsProvider ?? 'tts'}${cacheTag})`
    );
  }
}
