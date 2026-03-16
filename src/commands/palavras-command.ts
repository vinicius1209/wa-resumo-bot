/**
 * Comando /palavras — mostra o histórico de palavras do dia.
 */
import { ICommand, CommandContext } from '../types';
import { WordOfDayService } from '../services/word-of-day-service';

export class PalavrasCommand implements ICommand {
  readonly name = 'palavras';
  readonly aliases = ['wordofday', 'palavra'];
  readonly description = 'Mostra as últimas palavras do dia';

  constructor(private wordOfDayService: WordOfDayService) {}

  async execute(ctx: CommandContext): Promise<void> {
    const history = this.wordOfDayService.getHistory(ctx.groupId);

    if (history.length === 0) {
      await ctx.reply('📭 Nenhuma palavra do dia registrada ainda para este grupo.');
      return;
    }

    const lines = ['🏆 *Palavras do dia*\n'];

    for (const entry of history) {
      const displayDate = this.formatDisplayDate(entry.date);
      lines.push(
        `• ${displayDate} — *${entry.word}* (${entry.count}x por ${entry.uniqueSenders} ${entry.uniqueSenders === 1 ? 'pessoa' : 'pessoas'})`
      );
    }

    await ctx.reply(lines.join('\n'));
  }

  /**
   * Converte data yyyy-MM-dd para dd/MM.
   */
  private formatDisplayDate(date: string): string {
    const parts = date.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}`;
    }
    return date;
  }
}
