/**
 * PersonaStats — análise estatística de mensagens de grupo (sem LLM).
 *
 * Extrai gírias, emojis, horários de pico, estilo de mensagem, etc.
 */
import { StoredMessage } from '../types';

export interface GroupStatsResult {
  topSlang: string[];
  topEmojis: string[];
  avgMessageLength: number;
  peakHours: number[];
  messageStyle: 'curto' | 'medio' | 'longo';
}

// Regex para detectar emojis (incluindo sequências com modificadores e ZWJ)
const EMOJI_REGEX =
  /(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*/gu;

// Stop words pt-BR — palavras extremamente comuns que devem ser ignoradas
const STOP_WORDS = new Set([
  'a', 'e', 'o', 'de', 'da', 'do', 'que', 'em', 'é', 'no', 'na', 'um', 'uma',
  'para', 'com', 'não', 'nao', 'se', 'os', 'as', 'por', 'mais', 'mas', 'eu',
  'ele', 'ela', 'nos', 'já', 'ja', 'ou', 'ser', 'quando', 'muito', 'tem', 'foi',
  'são', 'sao', 'estar', 'está', 'esta', 'até', 'ate', 'isso', 'esse', 'essa',
  'num', 'numa', 'pelos', 'pelas', 'como', 'ao', 'aos', 'das', 'dos', 'seu',
  'sua', 'meu', 'minha', 'me', 'te', 'lhe', 'nos', 'vos', 'lhes', 'qual',
  'quem', 'onde', 'este', 'aqui', 'ali', 'lá', 'la', 'vai', 'vou', 'tá',
  'ta', 'né', 'ne', 'sim', 'pra', 'pro', 'era', 'ter', 'só', 'so',
  'bem', 'sem', 'pode', 'depois', 'mesmo', 'sobre', 'entre', 'cada',
  'ainda', 'também', 'tambem', 'outro', 'outra', 'aquele', 'aquela',
  'seus', 'suas', 'desse', 'dessa', 'nesse', 'nessa', 'meus', 'minhas',
  'todos', 'toda', 'todo', 'tudo', 'nada', 'coisa', 'dia', 'vez',
]);

// Palavras comuns do português (~200) — palavras que NÃO são gírias
const COMMON_WORDS = new Set([
  ...STOP_WORDS,
  'agora', 'amanhã', 'amanha', 'ano', 'antes', 'bom', 'boa', 'casa', 'certo',
  'certa', 'cidade', 'coisa', 'coisas', 'conta', 'dar', 'demais', 'dentro',
  'depois', 'desde', 'dizer', 'duas', 'dois', 'durante', 'então', 'entao',
  'exemplo', 'fazer', 'feito', 'ficar', 'fora', 'forma', 'gente', 'governo',
  'grande', 'grupo', 'hoje', 'homem', 'hora', 'horas', 'ir', 'isto', 'lado',
  'lugar', 'maior', 'mal', 'melhor', 'menor', 'menos', 'mês', 'mes', 'mundo',
  'nenhum', 'nenhuma', 'noite', 'nome', 'nosso', 'nossa', 'novo', 'nova',
  'número', 'numero', 'ontem', 'parte', 'partir', 'passar', 'passo', 'pedir',
  'pensar', 'pequeno', 'pequena', 'pessoa', 'pessoas', 'poder', 'pois',
  'pouco', 'poucos', 'primeiro', 'primeira', 'problema', 'próprio', 'quanto',
  'quase', 'quatro', 'querer', 'saber', 'sempre', 'sendo', 'sentir', 'sido',
  'tanto', 'tempo', 'tenho', 'tinha', 'tipo', 'trabalho', 'três', 'tres',
  'último', 'ultimo', 'ver', 'verdade', 'vida', 'vir', 'vocês', 'voces',
  'você', 'voce', 'volta', 'olha', 'cara', 'legal', 'falar', 'falou',
  'disse', 'deu', 'aquilo', 'colocou', 'acho', 'achar', 'precisa', 'quer',
  'sabe', 'sei', 'vamos', 'assim', 'meio', 'dá', 'desse', 'dele', 'dela',
  'nele', 'nela', 'aí', 'ai', 'cima', 'baixo', 'pela', 'pelo', 'algo',
  'algum', 'alguma', 'alguns', 'algumas', 'muita', 'muitas', 'muitos',
  'outra', 'outras', 'outros', 'pouca', 'poucas', 'tantas', 'tantos',
  'vários', 'varias', 'bora', 'obrigado', 'obrigada', 'tchau', 'oi',
  'olá', 'ola', 'bom', 'boa', 'noite', 'tarde', 'manhã', 'manha',
  'semana', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado',
  'sabado', 'domingo', 'janeiro', 'fevereiro', 'março', 'abril', 'maio',
  'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  'real', 'reais', 'dinheiro', 'banco', 'carro', 'comida', 'água', 'cafe',
  'sim', 'não', 'talvez', 'claro', 'certeza', 'provavelmente', 'realmente',
  'exatamente', 'praticamente', 'absolutamente', 'totalmente', 'geralmente',
]);

export class PersonaStats {
  /**
   * Analisa mensagens de um grupo e retorna estatísticas sem uso de LLM.
   */
  static analyzeGroup(messages: StoredMessage[]): GroupStatsResult {
    if (messages.length === 0) {
      return {
        topSlang: [],
        topEmojis: [],
        avgMessageLength: 0,
        peakHours: [],
        messageStyle: 'curto',
      };
    }

    const wordFreq = new Map<string, number>();
    const emojiFreq = new Map<string, number>();
    const hourCounts = new Array(24).fill(0);
    let totalLength = 0;

    for (const msg of messages) {
      const text = msg.content || '';
      totalLength += text.length;

      // Contagem de horas
      const date = new Date(msg.timestamp * 1000);
      hourCounts[date.getHours()]++;

      // Extrair emojis
      const emojis = text.match(EMOJI_REGEX);
      if (emojis) {
        for (const emoji of emojis) {
          emojiFreq.set(emoji, (emojiFreq.get(emoji) || 0) + 1);
        }
      }

      // Contagem de palavras (limpar emojis e pontuação)
      const cleaned = text.replace(EMOJI_REGEX, ' ').toLowerCase();
      const words = cleaned.split(/\s+/).filter((w) => w.length > 2);
      for (const word of words) {
        // Remover pontuação das bordas
        const clean = word.replace(/^[^a-záàâãéèêíïóôõúüç]+|[^a-záàâãéèêíïóôõúüç]+$/gi, '');
        if (clean.length > 2 && !STOP_WORDS.has(clean)) {
          wordFreq.set(clean, (wordFreq.get(clean) || 0) + 1);
        }
      }
    }

    // Gírias: palavras frequentes (>3 usos) que NÃO estão no dicionário comum
    const slangCandidates = [...wordFreq.entries()]
      .filter(([word, count]) => count > 3 && !COMMON_WORDS.has(word))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([word]) => word);

    // Top 5 emojis
    const topEmojis = [...emojiFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([emoji]) => emoji);

    // Média de tamanho
    const avgMessageLength = Math.round(totalLength / messages.length);

    // Horários de pico (top 3)
    const peakHours = hourCounts
      .map((count, hour) => ({ hour, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map((h) => h.hour)
      .sort((a, b) => a - b);

    // Estilo de mensagem
    let messageStyle: 'curto' | 'medio' | 'longo';
    if (avgMessageLength < 30) {
      messageStyle = 'curto';
    } else if (avgMessageLength < 80) {
      messageStyle = 'medio';
    } else {
      messageStyle = 'longo';
    }

    return {
      topSlang: slangCandidates,
      topEmojis,
      avgMessageLength,
      peakHours,
      messageStyle,
    };
  }
}
