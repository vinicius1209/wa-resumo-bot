/**
 * Comando /resumo — ponto de entrada principal do bot.
 *
 * Exemplos de uso no grupo:
 *   /resumo
 *   /resumo 2h
 *   /resumo hoje
 *   /resumo 50 mensagens
 *   @ResumoBot resumo das últimas 3h
 */
import { ICommand, CommandContext } from '../types';
import { SummaryService } from '../services/summary-service';

export class ResumoCommand implements ICommand {
  readonly name = 'resumo';
  readonly aliases = ['summary', 'resume', 'r'];
  readonly description = 'Gera um resumo fiel da conversa do grupo usando IA';

  constructor(private summaryService: SummaryService) {}

  async execute(ctx: CommandContext): Promise<void> {
    // Feedback imediato
    await ctx.reply('🔄 Gerando resumo... aguarde.');

    const result = await this.summaryService.generateSummary(
      ctx.groupId,
      ctx.senderId,
      ctx.args
    );

    await ctx.reply(result.text);
  }
}
