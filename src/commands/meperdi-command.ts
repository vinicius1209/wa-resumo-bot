/**
 * Comando /meperdi — gera um resumo personalizado do que o membro perdeu
 * desde sua última mensagem no grupo.
 *
 * Exemplos de uso:
 *   /meperdi
 *   /catchup
 *   @ResumoBot meperdi
 */
import { ICommand, CommandContext, IMessageStorage } from '../types';
import { CatchupService } from '../services/catchup-service';
import { SummaryService } from '../services/summary-service';

export class MePerdiCommand implements ICommand {
  readonly name = 'meperdi';
  readonly aliases = ['catchup', 'oqueperdí'];
  readonly description = 'Receba um resumo do que rolou desde sua última mensagem';

  constructor(
    private catchupService: CatchupService,
    private storage: IMessageStorage,
    private summaryService: SummaryService
  ) {}

  async execute(ctx: CommandContext): Promise<void> {
    const lastSeen = this.catchupService.getLastSeen(ctx.groupId, ctx.senderId);

    if (lastSeen === null) {
      await ctx.reply(
        'Não tenho registro de atividade anterior. Use /resumo para ver o resumo geral.'
      );
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const diffSeconds = now - lastSeen;
    const diffHours = diffSeconds / 3600;

    if (diffHours < 1) {
      await ctx.reply('Você não ficou fora tempo suficiente para precisar de um resumo! 😄');
      return;
    }

    await ctx.reply('🔄 Gerando seu resumo personalizado...');

    const summary = await this.catchupService.generateCatchup(
      ctx.groupId,
      ctx.senderId,
      this.storage,
      this.summaryService
    );

    if (summary === null) {
      await ctx.reply('📭 Poucas mensagens desde sua última participação para gerar um resumo.');
      return;
    }

    await ctx.reply(summary);
  }
}
