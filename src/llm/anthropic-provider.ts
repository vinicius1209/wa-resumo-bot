/**
 * Provider Anthropic (Claude) — implementa ILLMProvider.
 *
 * Plug and play: basta ter ANTHROPIC_API_KEY no .env.
 */
import Anthropic from '@anthropic-ai/sdk';
import { ILLMProvider, LLMSummaryRequest, LLMSummaryResponse, LLMChatRequest, LLMChatResponse } from '../types';
import { config } from '../config';
import { SYSTEM_PROMPT, formatMessagesForLLM } from './base-prompt';

export class AnthropicProvider implements ILLMProvider {
  readonly name = 'anthropic';
  private client: Anthropic;
  private model: string;

  constructor() {
    this.client = new Anthropic({ apiKey: config.llm.anthropic.apiKey });
    this.model = config.llm.anthropic.model;
  }

  async summarize(request: LLMSummaryRequest): Promise<LLMSummaryResponse> {
    const formattedMessages = formatMessagesForLLM(request.messages);

    const userPrompt = this.buildUserPrompt(
      formattedMessages,
      request.messages.length,
      request.language,
      request.userInstruction
    );

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    const summary = textBlock && 'text' in textBlock
      ? textBlock.text
      : 'Não foi possível gerar o resumo.';

    return {
      summary,
      tokensUsed: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      },
      provider: this.name,
      model: this.model,
    };
  }

  async chat(request: LLMChatRequest): Promise<LLMChatResponse> {
    // Anthropic requer system como parâmetro separado
    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const chatMessages = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const systemPrompt = systemMessages.map((m) => m.content).join('\n\n');

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: request.maxTokens ?? config.conversation.maxTokens,
      system: systemPrompt || undefined,
      messages: chatMessages,
      temperature: request.temperature ?? config.conversation.temperature,
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    const content = textBlock && 'text' in textBlock
      ? textBlock.text
      : 'Não consegui gerar uma resposta.';

    return {
      content,
      tokensUsed: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      },
      provider: this.name,
      model: this.model,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Faz uma chamada mínima para verificar credenciais
      await this.client.messages.create({
        model: this.model,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return true;
    } catch {
      return false;
    }
  }

  private buildUserPrompt(
    formattedMessages: string,
    messageCount: number,
    language: string,
    userInstruction?: string
  ): string {
    let prompt = `Aqui está a conversa do grupo de WhatsApp (${messageCount} mensagens).\n`;
    if (userInstruction) {
      prompt += `Instrução do usuário: "${userInstruction}"\n`;
    }
    prompt += `Idioma do resumo: ${language}\n\n`;
    prompt += `--- CONVERSA ---\n${formattedMessages}\n--- FIM ---\n\n`;
    prompt += `Gere o resumo fiel desta conversa seguindo todas as regras.`;
    return prompt;
  }
}
