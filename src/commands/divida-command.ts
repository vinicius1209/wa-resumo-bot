/**
 * Comando /divida — gerencia dívidas entre membros do grupo.
 *
 * Exemplos:
 *   /divida                     → lista dívidas do grupo
 *   /divida listar              → lista dívidas do grupo
 *   /divida João 50 pizza       → registra que João deve R$50 (pizza) a quem chamou
 *   /divida pagar João 50      → registra pagamento de R$50 para João
 */
import { ICommand, CommandContext } from '../types';
import { DebtService } from '../services/debt-service';

export class DividaCommand implements ICommand {
  readonly name = 'divida';
  readonly aliases = ['dividas', 'dívida', 'dívidas', 'debt'];
  readonly description = 'Gerencia dívidas entre membros do grupo';
  readonly usage = '/divida João 50 pizza';

  constructor(private debtService: DebtService) {}

  async execute(ctx: CommandContext): Promise<void> {
    const args = ctx.args.trim();

    if (!args || args.toLowerCase() === 'listar') {
      await this.listDebts(ctx);
      return;
    }

    if (args.toLowerCase().startsWith('pagar ')) {
      await this.settleDebt(ctx, args.slice(6).trim());
      return;
    }

    // Tenta interpretar como nova dívida: "Nome valor descrição"
    await this.addDebt(ctx, args);
  }

  private async listDebts(ctx: CommandContext): Promise<void> {
    const netDebts = this.debtService.getNetBalance(ctx.groupId);
    const rawDebts = this.debtService.getGroupDebts(ctx.groupId);

    if (netDebts.length === 0) {
      await ctx.reply('✅ Nenhuma dívida pendente no grupo!');
      return;
    }

    const lines: string[] = ['💰 *Dívidas do grupo*\n'];

    // Agrupa dívidas brutas por devedor para exibição detalhada
    const debtsByDebtor = new Map<string, typeof rawDebts>();
    for (const d of rawDebts) {
      const list = debtsByDebtor.get(d.debtor_name) ?? [];
      list.push(d);
      debtsByDebtor.set(d.debtor_name, list);
    }

    // Exibe quem é devedor líquido
    const debtors = new Set(netDebts.map((d) => d.fromName));
    const allNames = new Set<string>();
    for (const d of rawDebts) {
      allNames.add(d.debtor_name);
      allNames.add(d.creditor_name);
    }

    for (const [debtorName, debts] of debtsByDebtor) {
      lines.push(`${debtorName} deve:`);
      for (const d of debts) {
        const date = new Date(d.created_at * 1000);
        const dateStr = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
        const desc = d.description ? ` (${d.description})` : '';
        lines.push(`  • R$${d.amount.toFixed(2).replace('.', ',')} para ${d.creditor_name}${desc} — ${dateStr}`);
      }
      lines.push('');
    }

    // Mostra quem está quite
    for (const name of allNames) {
      if (!debtors.has(name) && !debtsByDebtor.has(name)) {
        lines.push(`✅ ${name} está quite!`);
      }
    }

    await ctx.reply(lines.join('\n').trim());
  }

  private async addDebt(ctx: CommandContext, args: string): Promise<void> {
    const parsed = this.parseArgs(args);
    if (!parsed) {
      await ctx.reply(
        '❌ Formato inválido. Use:\n' +
        '  /divida Nome 50 pizza\n' +
        '  /divida @Nome R$50 pizza',
      );
      return;
    }

    const { name, amount, description } = parsed;

    // O remetente é o credor; a pessoa mencionada é o devedor
    this.debtService.addDebt(
      ctx.groupId,
      name, // debtorId — usamos o nome como fallback de ID
      name,
      ctx.senderId,
      ctx.senderName,
      amount,
      description || undefined,
    );

    const desc = description ? ` (${description})` : '';
    await ctx.reply(`✅ Registrado: ${name} deve R$${amount.toFixed(2).replace('.', ',')} para ${ctx.senderName}${desc}`);
  }

  private async settleDebt(ctx: CommandContext, args: string): Promise<void> {
    const parsed = this.parseArgs(args);
    if (!parsed) {
      await ctx.reply(
        '❌ Formato inválido. Use:\n' +
        '  /divida pagar Nome 50',
      );
      return;
    }

    const { name, amount } = parsed;

    // Quem chama "pagar" é o devedor pagando ao credor (name)
    const settled = this.debtService.settleDebt(ctx.groupId, ctx.senderId, name, amount);

    if (settled > 0) {
      await ctx.reply(`✅ Pagamento registrado: ${ctx.senderName} pagou R$${amount.toFixed(2).replace('.', ',')} para ${name}`);
    } else {
      await ctx.reply(`⚠️ Nenhuma dívida encontrada de ${ctx.senderName} para ${name}.`);
    }
  }

  /**
   * Extrai nome, valor e descrição dos argumentos.
   * Aceita: "Nome 50 descrição", "@Nome R$50 descrição", "Nome R$50,00 descrição"
   */
  private parseArgs(args: string): { name: string; amount: number; description: string } | null {
    // Remove @ inicial se presente
    const cleaned = args.replace(/^@/, '');

    // Padrão: Nome [R$]valor [descrição]
    const match = cleaned.match(/^(\S+)\s+R?\$?\s*(\d+(?:[.,]\d{1,2})?)\s*(.*)/i);
    if (!match) return null;

    const name = match[1];
    const amount = parseFloat(match[2].replace(',', '.'));
    const description = match[3].trim();

    if (isNaN(amount) || amount <= 0) return null;

    // Rejeita se o "nome" parece ser um número
    if (/^\d+$/.test(name)) return null;

    return { name, amount, description };
  }
}
