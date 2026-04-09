/**
 * TriageClassifier — classifica mensagens de DM via LLM.
 *
 * Recebe o conteúdo bruto de uma mensagem (texto + mídia opcional)
 * e retorna um TriageClassification estruturado com tipo, prioridade,
 * título, descrição e tags.
 */
import { ILLMProvider } from '../types';
import { TriageClassification, TriagePriority, TriageType } from './types';
import pino from 'pino';

const logger = pino({ name: 'triage-classifier' });

const CLASSIFICATION_SYSTEM_PROMPT = `Você é um classificador especializado em triagem de mensagens de suporte e desenvolvimento de software.

Você receberá o conteúdo de uma mensagem enviada via WhatsApp e deve classificá-la de forma estruturada.

## Tipos de classificação:

- **bug**: Relato de comportamento inesperado, erro, falha ou problema em produção
- **feature**: Solicitação de nova funcionalidade, melhoria ou mudança de comportamento
- **question**: Dúvida técnica, pedido de informação, pergunta sobre comportamento atual
- **support**: Pedido de ajuda operacional, acesso, configuração, ou problema não-técnico
- **update**: Atualização de status sobre algo em andamento, ou informação proativa sem necessidade de ação

## Prioridades:

- **p0**: Crítico — sistema fora do ar, perda de dados, produção completamente comprometida
- **p1**: Alta — bloqueia trabalho, afeta usuários em produção, sem workaround
- **p2**: Média — problema real mas há workaround, não bloqueia totalmente
- **p3**: Baixa — nice-to-have, melhoria cosmética, dúvida não urgente

## Regras:

1. Seja objetivo e conciso. Extraia APENAS o que está na mensagem.
2. O título deve ter no máximo 80 caracteres, em pt-BR, na forma imperativa (ex: "Corrigir erro 500 na tela de login").
3. A descrição deve ser um resumo estruturado: contexto + impacto + detalhes relevantes.
4. As tags devem ser palavras-chave técnicas extraídas do conteúdo (máximo 5).
5. Nunca invente informações que não estejam na mensagem.
6. Responda SOMENTE com o JSON abaixo, sem markdown, sem explicações:

{
  "type": "bug|feature|question|support|update",
  "priority": "p0|p1|p2|p3",
  "title": "título conciso da issue",
  "description": "descrição estruturada",
  "tags": ["tag1", "tag2"]
}`;

interface RawClassification {
  type?: string;
  priority?: string;
  title?: string;
  description?: string;
  tags?: unknown;
}

const VALID_TYPES = new Set<TriageType>(['bug', 'feature', 'question', 'support', 'update']);
const VALID_PRIORITIES = new Set<TriagePriority>(['p0', 'p1', 'p2', 'p3']);

function buildFallback(content: string): TriageClassification {
  const truncated = content.substring(0, 80);
  return {
    type: 'support',
    priority: 'p2',
    title: truncated.length < content.length ? `${truncated}...` : truncated,
    description: content,
    tags: [],
  };
}

export class TriageClassifier {
  constructor(private llm: ILLMProvider) {}

  /**
   * Classifica o conteúdo de uma mensagem.
   *
   * @param content - Texto bruto da mensagem (pode incluir transcrição de áudio ou descrição de mídia já concatenados)
   * @param projectContext - Contexto adicional do projeto para guiar a classificação
   */
  async classify(content: string, projectContext?: string): Promise<TriageClassification> {
    if (!this.llm.chat) {
      logger.warn('LLM provider does not support chat(); returning fallback classification');
      return buildFallback(content);
    }

    const systemPrompt = projectContext
      ? `${CLASSIFICATION_SYSTEM_PROMPT}\n\n## Contexto do projeto:\n${projectContext}`
      : CLASSIFICATION_SYSTEM_PROMPT;

    const userMessage = `Classifique a seguinte mensagem:\n\n${content}`;

    try {
      const response = await this.llm.chat({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.3,
        maxTokens: 512,
      });

      const raw = response.content.trim();

      let parsed: RawClassification;
      try {
        // Strip markdown code fences if the LLM wrapped the JSON
        const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
        parsed = JSON.parse(jsonText) as RawClassification;
      } catch (parseErr) {
        logger.warn({ parseErr, raw }, 'Failed to parse LLM classification JSON; using fallback');
        return buildFallback(content);
      }

      const type: TriageType = VALID_TYPES.has(parsed.type as TriageType)
        ? (parsed.type as TriageType)
        : 'support';

      const priority: TriagePriority = VALID_PRIORITIES.has(parsed.priority as TriagePriority)
        ? (parsed.priority as TriagePriority)
        : 'p2';

      const title =
        typeof parsed.title === 'string' && parsed.title.trim().length > 0
          ? parsed.title.trim().substring(0, 200)
          : content.substring(0, 80);

      const description =
        typeof parsed.description === 'string' && parsed.description.trim().length > 0
          ? parsed.description.trim()
          : content;

      const tags: string[] = Array.isArray(parsed.tags)
        ? (parsed.tags as unknown[])
            .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
            .map((t) => t.trim().toLowerCase())
            .slice(0, 5)
        : [];

      const classification: TriageClassification = { type, priority, title, description, tags };

      logger.info(
        { type, priority, tags, titleLength: title.length },
        'Mensagem classificada com sucesso',
      );

      return classification;
    } catch (err) {
      logger.error({ err }, 'Erro ao chamar LLM para classificacao; usando fallback');
      return buildFallback(content);
    }
  }
}
