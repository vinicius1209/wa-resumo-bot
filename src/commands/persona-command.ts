/**
 * Comando /persona — mostra o perfil/persona do grupo.
 *
 * Exemplos:
 *   /persona           → mostra persona em cache (ou gera se não houver)
 *   /persona atualizar → força re-análise
 *   /perfil            → alias
 */
import { ICommand, CommandContext, IMessageStorage } from '../types';
import { PersonaService, PersonaData } from '../services/persona-service';

export class PersonaCommand implements ICommand {
  readonly name = 'persona';
  readonly aliases = ['perfil'];
  readonly description = 'Mostra o perfil/persona do grupo';

  constructor(
    private personaService: PersonaService,
    private storage: IMessageStorage
  ) {}

  async execute(ctx: CommandContext): Promise<void> {
    const arg = ctx.args.trim().toLowerCase();
    const forceUpdate = arg === 'atualizar';

    // Tentar cache primeiro (a menos que seja forçado)
    if (!forceUpdate) {
      const cached = this.personaService.getPersona(ctx.groupId);
      if (cached) {
        await ctx.reply(this.formatPersona(cached));
        return;
      }
    }

    await ctx.reply('🔄 Analisando o grupo... aguarde.');

    try {
      const persona = await this.personaService.generatePersona(
        ctx.groupId,
        this.storage
      );
      await ctx.reply(this.formatPersona(persona));
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Erro desconhecido';
      await ctx.reply(`❌ Não foi possível gerar a persona: ${message}`);
    }
  }

  private formatPersona(persona: PersonaData): string {
    const lines = [
      '🎭 *Persona do grupo*',
      '',
    ];

    if (persona.tom) {
      lines.push(`*Tom:* ${persona.tom}`);
    }
    if (persona.girias?.length) {
      lines.push(`*Gírias:* ${persona.girias.join(', ')}`);
    }
    if (persona.assuntos?.length) {
      lines.push(`*Assuntos:* ${persona.assuntos.join(', ')}`);
    }
    if (persona.emojis?.length) {
      lines.push(`*Emojis:* ${persona.emojis.join(' ')}`);
    }
    if (persona.estilo_resposta) {
      lines.push(`*Estilo:* ${persona.estilo_resposta}`);
    }
    if (persona.cumprimento) {
      lines.push(`*Cumprimento:* ${persona.cumprimento}`);
    }
    if (persona.piadas_internas?.length) {
      lines.push(`*Piadas internas:* ${persona.piadas_internas.join(', ')}`);
    }

    return lines.join('\n');
  }
}
