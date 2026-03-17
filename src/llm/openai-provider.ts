/**
 * Provider OpenAI — implementa ILLMProvider.
 *
 * Plug and play: basta ter OPENAI_API_KEY no .env.
 */
import OpenAI from 'openai';
import { ILLMProvider, LLMSummaryRequest, LLMSummaryResponse, LLMChatRequest, LLMChatResponse } from '../types';
import { config } from '../config';
import { SYSTEM_PROMPT, formatMessagesForLLM } from './base-prompt';

export class OpenAIProvider implements ILLMProvider {
  readonly name = 'openai';
  private client: OpenAI;
  private model: string;

  constructor() {
    this.client = new OpenAI({ apiKey: config.llm.openai.apiKey });
    this.model = config.llm.openai.model;
  }

  async summarize(request: LLMSummaryRequest): Promise<LLMSummaryResponse> {
    const formattedMessages = formatMessagesForLLM(request.messages);

    const userPrompt = this.buildUserPrompt(
      formattedMessages,
      request.messages.length,
      request.language,
      request.userInstruction
    );

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3, // Baixa criatividade = mais fidelidade
      max_tokens: 2000,
    });

    const summary = response.choices[0]?.message?.content || 'Não foi possível gerar o resumo.';

    return {
      summary,
      tokensUsed: {
        input: response.usage?.prompt_tokens ?? 0,
        output: response.usage?.completion_tokens ?? 0,
      },
      provider: this.name,
      model: this.model,
    };
  }

  async chat(request: LLMChatRequest): Promise<LLMChatResponse> {
    const messages = request.messages.map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    }));

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: request.temperature ?? config.conversation.temperature,
      max_tokens: request.maxTokens ?? config.conversation.maxTokens,
    });

    return {
      content: response.choices[0]?.message?.content || 'Não consegui gerar uma resposta.',
      tokensUsed: {
        input: response.usage?.prompt_tokens ?? 0,
        output: response.usage?.completion_tokens ?? 0,
      },
      provider: this.name,
      model: this.model,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.models.list();
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
