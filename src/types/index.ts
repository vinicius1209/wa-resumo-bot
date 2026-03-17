/**
 * WA-RESUMO-BOT — Tipos e Contratos
 *
 * Spec-driven: todos os módulos dependem apenas destas interfaces.
 * Para criar um novo LLM provider, implemente ILLMProvider.
 * Para trocar o storage, implemente IMessageStorage.
 */

// ============================================
// Mensagem armazenada
// ============================================
export interface StoredMessage {
  id: string;
  groupId: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: number;
  /** Tipo original da mensagem (text, image, video, audio, sticker, document) */
  messageType: string;
  /** Texto da legenda caso seja mídia */
  caption?: string;
  /** Mensagem citada, se houver */
  quotedMessage?: string;
  /** Descrição gerada por visão ou transcrição de áudio */
  mediaDescription?: string;
}

// ============================================
// Storage — contrato plug and play
// ============================================
export interface IMessageStorage {
  /** Inicializa o storage (cria tabelas, etc) */
  init(): Promise<void>;

  /** Salva uma mensagem */
  save(message: StoredMessage): Promise<void>;

  /** Busca as últimas N mensagens de um grupo */
  getMessages(groupId: string, limit: number): Promise<StoredMessage[]>;

  /** Busca mensagens de um grupo num intervalo de tempo */
  getMessagesByTimeRange(
    groupId: string,
    fromTimestamp: number,
    toTimestamp: number
  ): Promise<StoredMessage[]>;

  /** Conta mensagens de um grupo */
  countMessages(groupId: string): Promise<number>;

  /** Limpa mensagens antigas (manutenção) */
  purgeOlderThan(timestamp: number): Promise<number>;

  /** Atualiza a descrição de mídia de uma mensagem */
  updateMediaDescription(messageId: string, description: string): Promise<void>;
}

// ============================================
// LLM Provider — contrato plug and play
// ============================================
export interface LLMSummaryRequest {
  messages: StoredMessage[];
  language: string;
  /** Instrução extra do usuário (ex: "resumo das últimas 2h") */
  userInstruction?: string;
}

export interface LLMSummaryResponse {
  summary: string;
  /** Tokens usados (input + output) */
  tokensUsed: {
    input: number;
    output: number;
  };
  /** Provider que gerou o resumo */
  provider: string;
  /** Modelo utilizado */
  model: string;
}

export interface ILLMProvider {
  /** Nome do provider (ex: "openai", "anthropic") */
  readonly name: string;

  /** Gera um resumo a partir das mensagens */
  summarize(request: LLMSummaryRequest): Promise<LLMSummaryResponse>;

  /** Chat multi-turn (opcional — necessário para modo conversacional) */
  chat?(request: LLMChatRequest): Promise<LLMChatResponse>;

  /** Verifica se o provider está configurado e funcional */
  healthCheck(): Promise<boolean>;
}

// ============================================
// LLM Chat — modo conversacional
// ============================================
export interface LLMChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMChatRequest {
  messages: LLMChatMessage[];
  /** Override de temperatura (default 0.7 para conversa) */
  temperature?: number;
  /** Override de max tokens (default 1000 para turns) */
  maxTokens?: number;
}

export interface LLMChatResponse {
  content: string;
  tokensUsed: {
    input: number;
    output: number;
  };
  provider: string;
  model: string;
}

// ============================================
// Rate Limiter — contrato
// ============================================
export interface RateLimitResult {
  allowed: boolean;
  /** Segundos restantes até poder usar novamente */
  retryAfterSeconds: number;
}

export interface IRateLimiter {
  /** Verifica e consome um uso. Retorna se foi permitido. */
  consume(key: string): RateLimitResult;

  /** Reseta o limite para uma chave */
  reset(key: string): void;
}

// ============================================
// Comando — contrato plug and play
// ============================================
export interface CommandContext {
  /** ID do grupo onde o comando foi chamado */
  groupId: string;
  /** ID de quem chamou */
  senderId: string;
  /** Nome de quem chamou */
  senderName: string;
  /** Argumentos do comando (ex: "2h", "hoje", "50 mensagens") */
  args: string;
  /** Função para responder no grupo */
  reply: (text: string) => Promise<void>;
  /** Função para responder com áudio (voice note OGG Opus) */
  replyAudio?: (audio: Buffer, durationSeconds: number) => Promise<void>;
}

export interface ICommand {
  /** Nome do comando (ex: "resumo") */
  readonly name: string;
  /** Aliases (ex: ["summary", "resume"]) */
  readonly aliases: string[];
  /** Descrição do comando */
  readonly description: string;
  /** Exemplo de uso exibido no /ajuda (opcional) */
  readonly usage?: string;

  /** Executa o comando */
  execute(ctx: CommandContext): Promise<void>;
}

// ============================================
// Media Processor — contrato
// ============================================
export interface IMediaProcessor {
  /** Descreve uma imagem via API de visão */
  processImage(buffer: Buffer, mimeType: string): Promise<string>;

  /** Transcreve um áudio via Whisper */
  processAudio(buffer: Buffer, mimeType: string): Promise<string>;

  /** Extrai frame de vídeo e descreve via visão */
  processVideo(buffer: Buffer, mimeType: string): Promise<string>;
}

// ============================================
// TTS Provider — contrato plug and play
// ============================================
export interface PodcastLine {
  speaker: 'host1' | 'host2';
  text: string;
}

export interface TTSRequest {
  script: PodcastLine[];
}

export interface TTSResponse {
  /** OGG Opus audio buffer, pronto para WhatsApp */
  audioBuffer: Buffer;
  /** Duração em segundos */
  durationSeconds: number;
  /** Nome do provider */
  provider: string;
  /** Custo estimado em USD */
  estimatedCostUsd: number;
}

export interface ITTSProvider {
  /** Nome do provider (ex: "gemini", "openai") */
  readonly name: string;

  /** Sintetiza áudio a partir de um script de podcast */
  synthesize(request: TTSRequest): Promise<TTSResponse>;

  /** Verifica se o provider está configurado e funcional */
  healthCheck(): Promise<boolean>;
}

// ============================================
// Config
// ============================================
export interface AppConfig {
  llm: {
    provider: 'openai' | 'anthropic';
    openai: {
      apiKey: string;
      model: string;
    };
    anthropic: {
      apiKey: string;
      model: string;
    };
  };
  summary: {
    maxMessages: number;
    language: string;
  };
  bot: {
    name: string;
    commandPrefix: string;
  };
  rateLimit: {
    /** Máximo de chamadas por janela */
    maxRequests: number;
    /** Janela de tempo em segundos */
    windowSeconds: number;
  };
  media: {
    enabled: boolean;
    maxSizeMB: number;
  };
  dashboard: {
    enabled: boolean;
    port: number;
    token: string;
  };
  wordOfDay: {
    autoSend: boolean;
  };
  conversation: {
    enabled: boolean;
    maxTurns: number;
    sessionTtlMinutes: number;
    dmEnabled: boolean;
    temperature: number;
    maxTokens: number;
  };
  sentiment: {
    autoReact: boolean;
  };
  podcast: {
    enabled: boolean;
    ttsProvider: 'gemini' | 'openai';
    googleApiKey: string;
    geminiModel: string;
    host1Voice: string;
    host2Voice: string;
    maxDurationMinutes: number;
  };
  logLevel: string;
}
