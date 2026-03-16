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

    const lines = [
      '🌡️ *Temperatura do grupo*',
      '',
      `${label} (score: ${score}/${15})`,
    ];

    await ctx.reply(lines.join('\n'));
  }
}
