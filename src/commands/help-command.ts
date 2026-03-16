/**
 * Comando /ajuda — lista os comandos disponíveis.
 */
import { ICommand, CommandContext } from '../types';
import { config } from '../config';

export class HelpCommand implements ICommand {
  readonly name = 'ajuda';
  readonly aliases = ['help', 'h', 'comandos'];
  readonly description = 'Lista os comandos disponíveis';

  constructor(private commands: ICommand[]) {}

  async execute(ctx: CommandContext): Promise<void> {
    const prefix = config.bot.commandPrefix;
    const lines = [
      `🤖 *${config.bot.name}* — Comandos disponíveis:\n`,
    ];

    for (const cmd of this.commands) {
      const aliases = cmd.aliases.length > 0
        ? ` (${cmd.aliases.map((a) => prefix + a).join(', ')})`
        : '';
      lines.push(`• *${prefix}${cmd.name}*${aliases} — ${cmd.description}`);
    }

    lines.push(`\nVocê também pode me mencionar: _@${config.bot.name} resumo 2h_`);

    await ctx.reply(lines.join('\n'));
  }
}
