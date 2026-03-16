/**
 * Comando /retro — gera a retrospectiva semanal do grupo.
 *
 * Calcula estatísticas dos últimos 7 dias e usa o LLM para
 * gerar uma narrativa divertida com ranking e premiações.
 */
import { ICommand, CommandContext, IMessageStorage } from '../types';
import { StatsService } from '../services/stats-service';
import { RetroService } from '../services/retro-service';
import pino from 'pino';
import { config } from '../config';

const logger = pino({ level: config.logLevel });

export class RetroCommand implements ICommand {
  readonly name = 'retro';
  readonly aliases = ['retrospectiva', 'wrapped'];
  readonly description = 'Gera a retrospectiva semanal do grupo';

  constructor(
    private statsService: StatsService,
    private retroService: RetroService,
    private storage: IMessageStorage
  ) {}

  async execute(ctx: CommandContext): Promise<void> {
    await ctx.reply('🔄 Gerando retrospectiva semanal... Aguarde!');

    try {
      const stats = await this.statsService.calculateWeeklyStats(
        ctx.groupId,
        this.storage
      );

      if (stats.totalMessages === 0) {
        await ctx.reply(
          '📭 Nenhuma mensagem encontrada nos últimos 7 dias para gerar a retrospectiva.'
        );
        return;
      }

      const narrative = await this.retroService.generateRetro(
        ctx.groupId,
        stats
      );

      await ctx.reply(narrative);

      logger.info(
        {
          groupId: ctx.groupId,
          senderId: ctx.senderId,
          totalMessages: stats.totalMessages,
        },
        'Retrospectiva semanal gerada com sucesso'
      );
    } catch (error) {
      logger.error({ error, groupId: ctx.groupId }, 'Erro ao gerar retrospectiva');
      await ctx.reply(
        '❌ Erro ao gerar a retrospectiva semanal. Tente novamente em alguns instantes.'
      );
    }
  }
}
