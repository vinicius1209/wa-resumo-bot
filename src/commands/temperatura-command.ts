/**
 * Comando /temperatura — mostra a temperatura (sentimento) atual do grupo.
 */
import { ICommand, CommandContext } from '../types';
import { SentimentService } from '../services/sentiment-service';

export class TemperaturaCommand implements ICommand {
  readonly name = 'temperatura';
  readonly aliases = ['temp', 'humor', 'treta'];
  readonly description = 'Mostra a temperatura atual do grupo';

  constructor(private sentimentService: SentimentService) {}

  async execute(ctx: CommandContext): Promise<void> {
    const { score, label } = this.sentimentService.getTemperature(ctx.groupId);

    const lines = [`${label} (score: ${score})`];

    const heated = this.sentimentService.getHeatedMessages(ctx.groupId, 3);
    if (heated.length > 0) {
      lines.push('');
      lines.push('*Quem ta agitando:*');
      for (const msg of heated) {
        const preview = msg.content.length > 60 ? msg.content.slice(0, 60) + '...' : msg.content;
        lines.push(`- ${msg.senderName}: _"${preview}"_`);
      }
    }

    await ctx.reply(lines.join('\n'));
  }
}
