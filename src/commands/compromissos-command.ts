/**
 * Comando /compromissos — lista e gerencia compromissos do grupo.
 *
 * Exemplos:
 *   /compromissos                          → lista próximos compromissos
 *   /compromissos add Churrasco sexta 20h  → adiciona compromisso
 *   /compromissos limpar                   → remove compromissos passados
 */
import { ICommand, CommandContext } from '../types';
import { CommitmentService } from '../services/commitment-service';

export class CompromissosCommand implements ICommand {
  readonly name = 'compromissos';
  readonly aliases = ['compromisso', 'agenda', 'lembrete'];
  readonly description = 'Lista e gerencia compromissos do grupo';
  readonly usage = '/compromissos add Churrasco sexta 20h';

  constructor(private commitmentService: CommitmentService) {}

  async execute(ctx: CommandContext): Promise<void> {
    const args = ctx.args.trim();

    if (!args) {
      await this.listUpcoming(ctx);
      return;
    }

    const lower = args.toLowerCase();

    if (lower === 'limpar') {
      await this.clearPast(ctx);
      return;
    }

    if (lower.startsWith('add ') || lower.startsWith('adicionar ')) {
      const content = lower.startsWith('add ') ? args.slice(4).trim() : args.slice(10).trim();
      await this.addCommitment(ctx, content);
      return;
    }

    // Default: list
    await this.listUpcoming(ctx);
  }

  private async listUpcoming(ctx: CommandContext): Promise<void> {
    const commitments = this.commitmentService.getUpcoming(ctx.groupId);

    if (commitments.length === 0) {
      await ctx.reply('📅 Nenhum compromisso agendado para este grupo.');
      return;
    }

    const lines: string[] = ['📅 *Próximos compromissos*\n'];

    for (const c of commitments) {
      const dateStr = c.event_date ? this.formatDate(new Date(c.event_date * 1000)) : 'sem data';
      lines.push(`• ${c.description} — ${dateStr} (${c.created_by_name})`);
    }

    lines.push('');
    lines.push(`Total: ${commitments.length} compromisso${commitments.length > 1 ? 's' : ''}`);

    await ctx.reply(lines.join('\n'));
  }

  private async addCommitment(ctx: CommandContext, content: string): Promise<void> {
    if (!content) {
      await ctx.reply(
        '❌ Formato inválido. Use:\n' +
        '  /compromissos add Churrasco sexta 20h\n' +
        '  /compromissos add Reunião dia 15 às 14h',
      );
      return;
    }

    // Try to detect and parse a date from the content
    const detection = this.commitmentService.detectDateMention(content);
    let eventDate: Date | null = null;
    let description = content;

    if (detection.hasDate) {
      eventDate = this.commitmentService.parseDateFromText(content);
      // Remove the date portion from description to get a cleaner title
      // But keep the full text as description if removal would empty it
      const cleaned = content.replace(detection.rawMatch, '').trim();
      if (cleaned) {
        description = cleaned;
      }
    }

    this.commitmentService.addCommitment(
      ctx.groupId,
      description,
      eventDate,
      ctx.senderId,
      ctx.senderName,
    );

    const dateInfo = eventDate ? ` para ${this.formatDate(eventDate)}` : ' (sem data definida)';
    await ctx.reply(`✅ Compromisso registrado: ${description}${dateInfo}`);
  }

  private async clearPast(ctx: CommandContext): Promise<void> {
    const count = this.commitmentService.clearPast(ctx.groupId);

    if (count === 0) {
      await ctx.reply('✅ Nenhum compromisso passado para remover.');
    } else {
      await ctx.reply(`🗑️ ${count} compromisso${count > 1 ? 's' : ''} passado${count > 1 ? 's' : ''} removido${count > 1 ? 's' : ''}.`);
    }
  }

  private formatDate(date: Date): string {
    const days = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
    const dayName = days[date.getDay()];
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${dayName} ${day}/${month} às ${hours}:${minutes}`;
  }
}
