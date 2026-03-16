/**
 * PersonaService — gera e gerencia a "persona" de um grupo de WhatsApp.
 *
 * Pipeline: buscar mensagens → análise estatística → LLM distillation → cache em SQLite.
 * Usa OpenAI ou Anthropic conforme config.llm.provider.
 */
import Database from 'better-sqlite3';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import pino from 'pino';
import { IMessageStorage, StoredMessage } from '../types';
import { config } from '../config';
import { PersonaStats, GroupStatsResult } from './persona-stats';

const logger = pino({ level: config.logLevel });

const TWENTY_FOUR_HOURS = 24 * 60 * 60;

export interface PersonaData {
  girias: string[];
  tom: string;
  piadas_internas: string[];
  assuntos: string[];
  cumprimento: string;
  emojis: string[];
  estilo_resposta: string;
}

interface PersonaRow {
  group_id: string;
  stats_json: string | null;
  persona_json: string;
  sample_messages: string | null;
  updated_at: number;
}

const DISTILLATION_PROMPT = `Você é um analista de cultura de grupos de WhatsApp. Analise as mensagens abaixo e extraia a "persona" do grupo.

Retorne APENAS um JSON válido (sem markdown, sem backticks) com esta estrutura:
{
  "girias": ["lista de gírias e expressões típicas do grupo"],
  "tom": "descrição curta do tom geral (ex: zoeiro e informal, sério e técnico)",
  "piadas_internas": ["referências e piadas internas identificadas"],
  "assuntos": ["principais assuntos discutidos"],
  "cumprimento": "como o grupo costuma se cumprimentar",
  "emojis": ["emojis mais usados"],
  "estilo_resposta": "descrição do estilo de escrita (ex: frases curtas com muitos kkkkk)"
}`;

const RESPOND_AS_PERSONA_PROMPT = `Você é a personificação de um grupo de WhatsApp. Responda a pergunta abaixo usando o estilo, gírias e tom do grupo.

Persona do grupo:
{{persona}}

Responda de forma natural, como se fosse o grupo respondendo. Seja breve e autêntico.`;

export class PersonaService {
  private db: Database.Database | null = null;
  private openaiClient: OpenAI | null;
  private anthropicClient: Anthropic | null;
  private provider: string;

  constructor() {
    this.provider = config.llm.provider;

    this.openaiClient = config.llm.openai.apiKey
      ? new OpenAI({ apiKey: config.llm.openai.apiKey })
      : null;

    this.anthropicClient = config.llm.anthropic.apiKey
      ? new Anthropic({ apiKey: config.llm.anthropic.apiKey })
      : null;
  }

  /**
   * Cria a tabela de persona no banco. Deve ser chamado após storage.init().
   */
  initTable(db: Database.Database): void {
    this.db = db;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS group_persona (
        group_id TEXT PRIMARY KEY,
        stats_json TEXT,
        persona_json TEXT NOT NULL,
        sample_messages TEXT,
        updated_at INTEGER DEFAULT (unixepoch())
      );
    `);

    logger.info('PersonaService: tabela group_persona pronta');
  }

  /**
   * Retorna a persona em cache se atualizada nas últimas 24h, null caso contrário.
   */
  getPersona(groupId: string): PersonaData | null {
    if (!this.db) return null;

    const row = this.db
      .prepare('SELECT * FROM group_persona WHERE group_id = ?')
      .get(groupId) as PersonaRow | undefined;

    if (!row) return null;

    const now = Math.floor(Date.now() / 1000);
    if (now - row.updated_at > TWENTY_FOUR_HOURS) return null;

    try {
      return JSON.parse(row.persona_json) as PersonaData;
    } catch {
      return null;
    }
  }

  /**
   * Pipeline completo: busca mensagens → stats → LLM → salva no banco.
   */
  async generatePersona(
    groupId: string,
    storage: IMessageStorage
  ): Promise<PersonaData> {
    // 1. Buscar últimas 500 mensagens
    const messages = await storage.getMessages(groupId, 500);

    if (messages.length < 10) {
      throw new Error('Poucas mensagens no grupo para gerar persona (mínimo 10).');
    }

    // 2. Análise estatística
    const stats = PersonaStats.analyzeGroup(messages);

    // 3. Selecionar ~100 mensagens representativas (amostrar uniformemente)
    const sample = this.selectSample(messages, 100);

    // 4. Chamar LLM para distilação
    const sampleText = sample
      .map((m) => `[${m.senderName}]: ${m.content}`)
      .join('\n');

    const statsContext = `\nEstatísticas prévias:\n- Gírias frequentes: ${stats.topSlang.join(', ') || 'nenhuma identificada'}\n- Emojis mais usados: ${stats.topEmojis.join(' ') || 'nenhum'}\n- Estilo: mensagens ${stats.messageStyle}s (média ${stats.avgMessageLength} chars)\n- Horários de pico: ${stats.peakHours.map((h) => `${h}h`).join(', ')}`;

    const userMessage = `${statsContext}\n\nMensagens do grupo:\n${sampleText}`;

    const personaJson = await this.callLLM(DISTILLATION_PROMPT, userMessage);

    // 5. Parse do resultado
    let persona: PersonaData;
    try {
      persona = JSON.parse(personaJson) as PersonaData;
    } catch {
      logger.error({ raw: personaJson }, 'Erro ao parsear JSON da persona');
      throw new Error('LLM retornou JSON inválido para a persona.');
    }

    // 6. Salvar no banco
    if (this.db) {
      this.db
        .prepare(
          `INSERT INTO group_persona (group_id, stats_json, persona_json, sample_messages, updated_at)
           VALUES (?, ?, ?, ?, unixepoch())
           ON CONFLICT(group_id) DO UPDATE SET
             stats_json = excluded.stats_json,
             persona_json = excluded.persona_json,
             sample_messages = excluded.sample_messages,
             updated_at = unixepoch()`
        )
        .run(
          groupId,
          JSON.stringify(stats),
          JSON.stringify(persona),
          sampleText.slice(0, 10000) // limitar tamanho
        );
    }

    return persona;
  }

  /**
   * Gera uma resposta usando a persona do grupo.
   */
  async respondAsPersona(groupId: string, question: string): Promise<string> {
    if (!this.db) throw new Error('PersonaService não inicializado.');

    const row = this.db
      .prepare('SELECT persona_json FROM group_persona WHERE group_id = ?')
      .get(groupId) as { persona_json: string } | undefined;

    if (!row) {
      throw new Error('Persona não encontrada. Use "atualizar" primeiro.');
    }

    const systemPrompt = RESPOND_AS_PERSONA_PROMPT.replace(
      '{{persona}}',
      row.persona_json
    );

    return this.callLLM(systemPrompt, question);
  }

  /**
   * Seleciona mensagens representativas uniformemente distribuídas.
   */
  private selectSample(messages: StoredMessage[], count: number): StoredMessage[] {
    if (messages.length <= count) return messages;

    const step = messages.length / count;
    const sample: StoredMessage[] = [];
    for (let i = 0; i < count; i++) {
      sample.push(messages[Math.floor(i * step)]);
    }
    return sample;
  }

  /**
   * Chama o LLM configurado (OpenAI ou Anthropic).
   */
  private async callLLM(systemPrompt: string, userMessage: string): Promise<string> {
    if (this.provider === 'anthropic' && this.anthropicClient) {
      const response = await this.anthropicClient.messages.create({
        model: config.llm.anthropic.model,
        max_tokens: 2000,
        temperature: 0.3,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      return textBlock && 'text' in textBlock ? textBlock.text : '';
    }

    if (this.openaiClient) {
      const response = await this.openaiClient.chat.completions.create({
        model: config.llm.openai.model,
        temperature: 0.3,
        max_tokens: 2000,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      });

      return response.choices[0]?.message?.content || '';
    }

    throw new Error('Nenhum provider LLM configurado.');
  }
}
