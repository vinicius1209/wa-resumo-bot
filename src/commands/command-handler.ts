/**
 * Command Handler — roteador de comandos.
 *
 * Detecta:
 * 1. Comandos com prefixo: /resumo, /ajuda
 * 2. Menções ao bot: @ResumoBot resumo 2h
 *
 * Plug and play: para adicionar um comando novo,
 * crie uma classe ICommand e registre via .register()
 */
import { ICommand, CommandContext, StoredMessage, IRateLimiter } from '../types';
import { config } from '../config';
import { AnalyticsService } from '../services/analytics-service';
import { eventBus } from '../services/event-bus';
import pino from 'pino';

const logger = pino({ level: config.logLevel });

/** Comandos que fazem chamadas LLM e devem ser rate-limited */
const RATE_LIMITED_COMMANDS = new Set([
  'resumo', 'summary', 'retro', 'retrospectiva',
  'persona', 'perfil', 'meperdi', 'catchup',
]);

export interface HandleResult {
  handled: boolean;
  /** True quando o bot foi mencionado mas nenhum comando válido foi encontrado */
  isBotMention: boolean;
  /** Texto completo após a @menção (para roteamento conversacional) */
  mentionText?: string;
}

export class CommandHandler {
  private commands: Map<string, ICommand> = new Map();
  private analytics: AnalyticsService | null = null;
  private rateLimiter: IRateLimiter | null = null;

  /**
   * Configura o serviço de analytics para tracking de comandos.
   */
  setAnalytics(analytics: AnalyticsService): void {
    this.analytics = analytics;
  }

  /**
   * Configura o rate limiter centralizado para comandos LLM.
   */
  setRateLimiter(rateLimiter: IRateLimiter): void {
    this.rateLimiter = rateLimiter;
  }

  /**
   * Registra um comando. Mapeia nome + aliases.
   */
  register(command: ICommand): void {
    this.commands.set(command.name.toLowerCase(), command);
    for (const alias of command.aliases) {
      this.commands.set(alias.toLowerCase(), command);
    }
    logger.debug({ command: command.name, aliases: command.aliases }, 'Comando registrado');
  }

  /**
   * Busca um comando por nome ou alias.
   */
  getCommand(name: string): ICommand | undefined {
    return this.commands.get(name.toLowerCase());
  }

  /**
   * Retorna todos os comandos únicos (sem duplicatas de alias).
   */
  getUniqueCommands(): ICommand[] {
    const seen = new Set<string>();
    const result: ICommand[] = [];
    for (const cmd of this.commands.values()) {
      if (!seen.has(cmd.name)) {
        seen.add(cmd.name);
        result.push(cmd);
      }
    }
    return result;
  }

  /**
   * Tenta processar uma mensagem como comando.
   * Retorna resultado detalhado para roteamento conversacional.
   */
  async handleMessage(
    message: StoredMessage,
    reply: (text: string) => Promise<void>
  ): Promise<HandleResult> {
    const content = message.content.trim();

    // Tentar detectar comando por prefixo
    const prefixResult = this.parsePrefix(content);
    if (prefixResult) {
      const handled = await this.executeCommand(prefixResult.command, prefixResult.args, message, reply);
      return { handled, isBotMention: false };
    }

    // Tentar detectar menção ao bot
    const mentionResult = this.parseMention(content);
    if (mentionResult) {
      // Verificar se o "comando" extraído é realmente um comando registrado
      const command = this.commands.get(mentionResult.command);
      if (command) {
        const handled = await this.executeCommand(mentionResult.command, mentionResult.args, message, reply);
        return { handled, isBotMention: true };
      }

      // Menção ao bot mas sem comando válido → candidato a conversa
      // Reconstruir o texto completo após a menção
      const fullMentionText = mentionResult.args
        ? `${mentionResult.command} ${mentionResult.args}`
        : mentionResult.command;

      return { handled: false, isBotMention: true, mentionText: fullMentionText };
    }

    return { handled: false, isBotMention: false };
  }

  /**
   * Detecta comando com prefixo: /resumo 2h
   */
  private parsePrefix(content: string): { command: string; args: string } | null {
    const prefix = config.bot.commandPrefix;
    if (!content.startsWith(prefix)) return null;

    const withoutPrefix = content.slice(prefix.length).trim();
    const spaceIndex = withoutPrefix.indexOf(' ');

    if (spaceIndex === -1) {
      return { command: withoutPrefix.toLowerCase(), args: '' };
    }

    return {
      command: withoutPrefix.slice(0, spaceIndex).toLowerCase(),
      args: withoutPrefix.slice(spaceIndex + 1).trim(),
    };
  }

  /**
   * Detecta menção ao bot: @ResumoBot resumo 2h
   */
  private parseMention(content: string): { command: string; args: string } | null {
    const botName = config.bot.name.toLowerCase();
    const lower = content.toLowerCase();

    // Aceita: "@ResumoBot resumo 2h" ou "ResumoBot, resumo 2h"
    const patterns = [
      `@${botName}`,
      botName,
    ];

    for (const pattern of patterns) {
      const idx = lower.indexOf(pattern);
      if (idx !== -1) {
        const afterMention = content.slice(idx + pattern.length).trim();
        // Remover vírgula ou dois-pontos iniciais
        const cleaned = afterMention.replace(/^[,:\s]+/, '').trim();

        if (!cleaned) {
          // Só mencionou o bot sem comando → assume "resumo"
          return { command: 'resumo', args: '' };
        }

        const spaceIndex = cleaned.indexOf(' ');
        if (spaceIndex === -1) {
          return { command: cleaned.toLowerCase(), args: '' };
        }

        return {
          command: cleaned.slice(0, spaceIndex).toLowerCase(),
          args: cleaned.slice(spaceIndex + 1).trim(),
        };
      }
    }

    return null;
  }

  /**
   * Executa o comando encontrado.
   */
  private async executeCommand(
    commandName: string,
    args: string,
    message: StoredMessage,
    reply: (text: string) => Promise<void>
  ): Promise<boolean> {
    const command = this.commands.get(commandName);
    if (!command) {
      logger.debug({ commandName }, 'Comando não encontrado');
      return false;
    }

    // Rate limit centralizado para comandos LLM
    if (this.rateLimiter && RATE_LIMITED_COMMANDS.has(commandName)) {
      const rateCheck = this.rateLimiter.consume(message.groupId);
      if (!rateCheck.allowed) {
        await reply(`⏳ Calma! Aguarde ${rateCheck.retryAfterSeconds}s antes de usar outro comando.`);
        return true;
      }
    }

    const ctx: CommandContext = {
      groupId: message.groupId,
      senderId: message.senderId,
      senderName: message.senderName,
      args,
      reply,
    };

    const startMs = Date.now();
    try {
      logger.info(
        { command: command.name, args, sender: message.senderName, group: message.groupId },
        'Executando comando'
      );
      await command.execute(ctx);

      this.analytics?.track({
        eventType: 'command',
        groupId: message.groupId,
        senderId: message.senderId,
        commandName: command.name,
        durationMs: Date.now() - startMs,
        success: true,
      });

      eventBus.emitCommand(message.groupId, message.senderName, command.name, Date.now() - startMs, true);

      return true;
    } catch (error) {
      logger.error({ error, command: command.name }, 'Erro ao executar comando');

      this.analytics?.track({
        eventType: 'command',
        groupId: message.groupId,
        senderId: message.senderId,
        commandName: command.name,
        durationMs: Date.now() - startMs,
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });

      eventBus.emitCommand(message.groupId, message.senderName, command.name, Date.now() - startMs, false);

      await reply('❌ Ocorreu um erro ao processar o comando.');
      return true;
    }
  }
}
