/**
 * Comando /links — mostra os últimos links compartilhados no grupo.
 *
 * Suporta:
 * - Sem args: últimos 10 links
 * - "semana": links dos últimos 7 dias
 * - Nome de categoria: filtra por categoria (vídeo, social, dev, notícia, outro)
 */
import { ICommand, CommandContext } from '../types';
import { LinkService, StoredLink } from '../services/link-service';

// Emoji por categoria
const CATEGORY_EMOJI: Record<string, string> = {
  'vídeo': '📺',
  'social': '💬',
  'dev': '💻',
  'notícia': '📰',
  'outro': '🔗',
};

// Labels por categoria (plural)
const CATEGORY_LABEL: Record<string, string> = {
  'vídeo': 'Vídeos',
  'social': 'Social',
  'dev': 'Dev',
  'notícia': 'Notícias',
  'outro': 'Outros',
};

export class LinksCommand implements ICommand {
  readonly name = 'links';
  readonly aliases = ['link', 'urls'];
  readonly description = 'Mostra os últimos links compartilhados no grupo';

  constructor(private linkService: LinkService) {}

  async execute(ctx: CommandContext): Promise<void> {
    const trimmed = ctx.args.trim().toLowerCase();

    let links: StoredLink[];

    if (trimmed === 'semana') {
      // Últimos 7 dias
      const now = Math.floor(Date.now() / 1000);
      const weekAgo = now - 7 * 24 * 60 * 60;
      links = this.linkService.getLinksByPeriod(ctx.groupId, weekAgo, now);
    } else if (trimmed && this.isCategory(trimmed)) {
      // Filtrar por categoria
      links = this.linkService.getLinksByCategory(ctx.groupId, trimmed, 10);
    } else {
      // Últimos 10
      links = this.linkService.getLinks(ctx.groupId, 10);
    }

    if (links.length === 0) {
      await ctx.reply('📭 Nenhum link encontrado no período solicitado.');
      return;
    }

    const output = this.formatLinks(links);
    await ctx.reply(output);
  }

  /**
   * Verifica se o argumento é um nome de categoria válido.
   */
  private isCategory(arg: string): boolean {
    const categories = ['vídeo', 'video', 'social', 'dev', 'notícia', 'noticia', 'outro'];
    return categories.includes(arg);
  }

  /**
   * Formata a lista de links agrupados por categoria.
   */
  private formatLinks(links: StoredLink[]): string {
    // Agrupar por categoria
    const groups = new Map<string, StoredLink[]>();
    for (const link of links) {
      const cat = link.category ?? 'outro';
      if (!groups.has(cat)) {
        groups.set(cat, []);
      }
      groups.get(cat)!.push(link);
    }

    const lines: string[] = ['🔗 *Links do grupo*\n'];

    // Ordem fixa de categorias
    const categoryOrder = ['vídeo', 'notícia', 'dev', 'social', 'outro'];

    for (const cat of categoryOrder) {
      const catLinks = groups.get(cat);
      if (!catLinks || catLinks.length === 0) continue;

      const emoji = CATEGORY_EMOJI[cat] ?? '🔗';
      const label = CATEGORY_LABEL[cat] ?? cat;
      lines.push(`${emoji} *${label}:*`);

      for (const link of catLinks) {
        const domain = this.extractDomain(link.url);
        const time = this.formatTime(link.timestamp);
        const titlePart = link.title ? `${link.title} — ` : '';
        lines.push(`  • ${titlePart}${domain} (${link.sharedByName}, ${time})`);
      }

      lines.push(''); // Linha em branco entre categorias
    }

    return lines.join('\n').trimEnd();
  }

  /**
   * Extrai o domínio de uma URL.
   */
  private extractDomain(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  /**
   * Formata timestamp unix para HH:mm.
   */
  private formatTime(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  }
}
