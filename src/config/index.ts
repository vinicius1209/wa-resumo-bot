/**
 * Configuração centralizada — carrega do .env com fallbacks sensatos.
 */
import dotenv from 'dotenv';
import { AppConfig } from '../types';

dotenv.config();

function env(key: string, fallback: string = ''): string {
  return process.env[key] ?? fallback;
}

function envInt(key: string, fallback: number): number {
  const val = process.env[key];
  return val ? parseInt(val, 10) : fallback;
}

export const config: AppConfig = {
  llm: {
    provider: (env('LLM_PROVIDER', 'openai') as 'openai' | 'anthropic'),
    openai: {
      apiKey: env('OPENAI_API_KEY'),
      model: env('OPENAI_MODEL', 'gpt-4o-mini'),
    },
    anthropic: {
      apiKey: env('ANTHROPIC_API_KEY'),
      model: env('ANTHROPIC_MODEL', 'claude-sonnet-4-20250514'),
    },
  },
  summary: {
    maxMessages: envInt('SUMMARY_MAX_MESSAGES', 200),
    language: env('SUMMARY_LANGUAGE', 'pt-BR'),
  },
  bot: {
    name: env('BOT_NAME', 'ResumoBot'),
    commandPrefix: env('COMMAND_PREFIX', '/'),
  },
  rateLimit: {
    maxRequests: envInt('RATE_LIMIT_MAX_REQUESTS', 3),
    windowSeconds: envInt('RATE_LIMIT_WINDOW_SECONDS', 300), // 5 min
  },
  media: {
    enabled: env('MEDIA_PROCESSING_ENABLED', 'true') === 'true',
    maxSizeMB: envInt('MEDIA_MAX_SIZE_MB', 20),
  },
  dashboard: {
    enabled: env('DASHBOARD_ENABLED', 'false') === 'true',
    port: envInt('DASHBOARD_PORT', 3000),
    token: env('DASHBOARD_TOKEN', 'change-me'),
  },
  wordOfDay: {
    autoSend: env('WORD_OF_DAY_AUTO', 'false') === 'true',
  },
  conversation: {
    enabled: env('CONVERSATION_ENABLED', 'false') === 'true',
    maxTurns: envInt('CONVERSATION_MAX_TURNS', 20),
    sessionTtlMinutes: envInt('CONVERSATION_SESSION_TTL_MINUTES', 30),
    dmEnabled: env('CONVERSATION_DM_ENABLED', 'false') === 'true',
    temperature: parseFloat(env('CONVERSATION_TEMPERATURE', '0.7')),
    maxTokens: envInt('CONVERSATION_MAX_TOKENS', 1000),
  },
  sentiment: {
    autoReact: env('SENTIMENT_AUTO_REACT', 'false') === 'true',
  },
  podcast: {
    enabled: env('PODCAST_ENABLED', 'false') === 'true',
    ttsProvider: env('TTS_PROVIDER', 'gemini') as 'gemini' | 'openai',
    googleApiKey: env('GOOGLE_TTS_API_KEY'),
    geminiModel: env('GEMINI_TTS_MODEL', 'gemini-2.5-flash-preview-tts'),
    host1Voice: env('PODCAST_HOST1_VOICE', 'Kore'),
    host2Voice: env('PODCAST_HOST2_VOICE', 'Puck'),
    maxDurationMinutes: envInt('PODCAST_MAX_DURATION_MINUTES', 5),
  },
  logLevel: env('LOG_LEVEL', 'info'),
};
