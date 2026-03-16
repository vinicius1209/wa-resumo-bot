/**
 * Factory para criar o LLM provider correto baseado na config.
 *
 * Para adicionar um novo provider:
 * 1. Crie uma classe que implemente ILLMProvider
 * 2. Registre aqui no switch/case
 * 3. Pronto — plug and play.
 */
import { ILLMProvider } from '../types';
import { config } from '../config';
import { OpenAIProvider } from './openai-provider';
import { AnthropicProvider } from './anthropic-provider';

export function createLLMProvider(providerName?: string): ILLMProvider {
  const name = providerName ?? config.llm.provider;

  switch (name) {
    case 'openai':
      return new OpenAIProvider();
    case 'anthropic':
      return new AnthropicProvider();
    default:
      throw new Error(
        `Provider LLM "${name}" não suportado. Use "openai" ou "anthropic".`
      );
  }
}
