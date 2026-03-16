/**
 * Comando /quiz — "Quem disse isso?"
 *
 * Inicia um quiz onde os participantes devem adivinhar quem
 * enviou determinada mensagem no grupo.
 *
 * Uso:
 *   /quiz          — inicia uma rodada
 *   /quiz ranking  — mostra o placar
 */
import { ICommand, CommandContext, IMessageStorage } from '../types';
import { QuizService } from '../services/quiz-service';

/**
 * Checks whether a text is a quiz numeric answer (1-4).
 * Returns the number or null.
 */
export function isQuizAnswer(text: string): number | null {
  const trimmed = text.trim();
  if (/^[1-4]$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }
  return null;
}

export class QuizCommand implements ICommand {
  readonly name = 'quiz';
  readonly aliases = ['quem'];
  readonly description = 'Inicia um quiz "Quem disse isso?" no grupo';

  constructor(
    private quizService: QuizService,
    private storage: IMessageStorage,
  ) {}

  async execute(ctx: CommandContext): Promise<void> {
    const arg = ctx.args.trim().toLowerCase();

    // ── Ranking ────────────────────────────────────────────
    if (arg === 'ranking' || arg === 'placar') {
      const scores = this.quizService.getRanking(ctx.groupId);
      if (scores.length === 0) {
        await ctx.reply('Nenhuma pontuação registrada neste grupo ainda.');
        return;
      }

      let text = '🏆 *Ranking — Quem disse isso?*\n\n';
      scores.forEach((s, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        text += `${medal} ${s.sender_name} — ${s.points} pts (${s.games_played} jogos)\n`;
      });

      await ctx.reply(text.trim());
      return;
    }

    // ── Start round ────────────────────────────────────────
    if (this.quizService.isActiveRound(ctx.groupId)) {
      await ctx.reply('⚠️ Já existe um quiz em andamento neste grupo! Responda com o número.');
      return;
    }

    const result = await this.quizService.startRound(ctx.groupId, this.storage);

    if (!result) {
      await ctx.reply(
        '❌ Não foi possível criar o quiz. Preciso de pelo menos 4 participantes ' +
        'com mensagens de texto recentes no grupo.',
      );
      return;
    }

    let text = `🎯 *Quem disse isso?*\n_"${result.questionText}"_\n\n`;
    result.options.forEach((name, i) => {
      text += `${i + 1}. ${name}\n`;
    });
    text += '\nRespondam com o número! (30s)';

    await ctx.reply(text);
  }
}
