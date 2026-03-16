/**
 * Comando /stats — exibe métricas de uso do bot.
 *
 * Uso:
 *   /stats        — métricas do dia + semana
 *   /stats custo  — breakdown de custo por provider/modelo
 */
import { ICommand, CommandContext } from '../types';
import { AnalyticsService } from '../services/analytics-service';

export class StatsCommand implements ICommand {
  readonly name = 'stats';
  readonly aliases = ['estatisticas', 'metricas'];
  readonly description = 'Mostra estatísticas de uso do bot';

  constructor(private analytics: AnalyticsService) {}

  async execute(ctx: CommandContext): Promise<void> {
    const subcommand = ctx.args.trim().toLowerCase();

    if (subcommand === 'custo' || subcommand === 'cost') {
      await this.showCost(ctx);
    } else {
      await this.showOverview(ctx);
    }
  }

  private async showOverview(ctx: CommandContext): Promise<void> {
    const daily = this.analytics.getDailyUsage();
    const weekly = this.analytics.getWeeklyCost();
    const activeGroups = this.analytics.getActiveGroups(7);

    const cmdList = Object.entries(daily.commandBreakdown)
      .map(([cmd, cnt]) => `${cnt} ${cmd}`)
      .join(', ');

    const mediaList = [];
    if (daily.mediaProcessed.image > 0) mediaList.push(`${daily.mediaProcessed.image} img`);
    if (daily.mediaProcessed.audio > 0) mediaList.push(`${daily.mediaProcessed.audio} áudio`);
    if (daily.mediaProcessed.video > 0) mediaList.push(`${daily.mediaProcessed.video} vídeo`);

    const lines = [
      '📊 *Estatísticas do bot*\n',
      '*Hoje:*',
      `  Comandos: ${daily.totalCommands}${cmdList ? ` (${cmdList})` : ''}`,
      `  Mídias: ${daily.mediaProcessed.total}${mediaList.length ? ` (${mediaList.join(', ')})` : ''}`,
      `  Tokens: ${this.formatNumber(daily.totalTokens.input + daily.totalTokens.output)} (custo: ~$${daily.estimatedCost.toFixed(4)})`,
      `  Tempo médio: ${daily.avgDurationMs > 0 ? (daily.avgDurationMs / 1000).toFixed(1) + 's' : '-'}`,
    ];

    if (daily.errors > 0) {
      lines.push(`  Erros: ${daily.errors}`);
    }

    lines.push('');
    lines.push('*Semana:*');
    lines.push(`  Grupos ativos: ${activeGroups}`);
    lines.push(`  Custo total: ~$${weekly.totalCost.toFixed(4)}`);
    lines.push(`  Tokens: ${this.formatNumber(weekly.totalTokens.input + weekly.totalTokens.output)}`);

    await ctx.reply(lines.join('\n'));
  }

  private async showCost(ctx: CommandContext): Promise<void> {
    const weekly = this.analytics.getWeeklyCost();

    const lines = [
      '💰 *Custo semanal por modelo*\n',
    ];

    const modelEntries = Object.entries(weekly.byModel)
      .sort(([, a], [, b]) => b - a);

    if (modelEntries.length === 0) {
      lines.push('Nenhum dado de custo registrado ainda.');
    } else {
      for (const [model, cost] of modelEntries) {
        lines.push(`  • ${model}: $${cost.toFixed(4)}`);
      }
      lines.push(`\n*Total:* $${weekly.totalCost.toFixed(4)}`);
    }

    await ctx.reply(lines.join('\n'));
  }

  private formatNumber(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return String(n);
  }
}
