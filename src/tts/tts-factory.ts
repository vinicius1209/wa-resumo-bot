/**
 * Factory para criar o TTS provider baseado na config.
 *
 * Para adicionar um novo provider:
 * 1. Crie uma classe que implemente ITTSProvider
 * 2. Registre aqui no switch/case
 */
import { ITTSProvider } from '../types';
import { config } from '../config';
import { GeminiTTSProvider } from './gemini-tts-provider';
import { OpenAITTSProvider } from './openai-tts-provider';

export function createTTSProvider(providerName?: string): ITTSProvider {
  const name = providerName ?? config.podcast.ttsProvider;

  switch (name) {
    case 'gemini':
      return new GeminiTTSProvider();
    case 'openai':
      return new OpenAITTSProvider();
    default:
      throw new Error(
        `TTS provider "${name}" não suportado. Use "gemini" ou "openai".`
      );
  }
}
