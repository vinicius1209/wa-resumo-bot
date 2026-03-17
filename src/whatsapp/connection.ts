/**
 * Módulo de conexão WhatsApp via Baileys.
 *
 * Responsabilidades:
 * - Conectar ao WhatsApp Web via QR Code
 * - Gerenciar reconexão automática
 * - Emitir eventos de mensagem recebida
 * - Persistir credenciais localmente (auth_info/)
 */
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  Browsers,
  WASocket,
  proto,
  WAMessageContent,
  isJidGroup,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import path from 'path';
import { EventEmitter } from 'events';
import { StoredMessage } from '../types';
import { config } from '../config';

const AUTH_DIR = path.resolve(process.cwd(), 'auth_info');

export interface WhatsAppEvents {
  'message:group': (message: StoredMessage, rawMessage: proto.IWebMessageInfo) => void;
  'connection:open': () => void;
  'connection:close': (reason: string) => void;
  'qr': (qr: string) => void;
}

export class WhatsAppConnection extends EventEmitter {
  private socket: WASocket | null = null;
  private logger = pino({ level: config.logLevel });
  private botJid: string = '';
  private groupNameCache: Map<string, string> = new Map();

  /**
   * Retorna o JID do bot (após conexão)
   */
  getBotJid(): string {
    return this.botJid;
  }

  /**
   * Busca o nome de um grupo via Baileys (com cache em memória).
   */
  async getGroupName(groupId: string): Promise<string | null> {
    if (this.groupNameCache.has(groupId)) {
      return this.groupNameCache.get(groupId)!;
    }
    if (!this.socket) return null;
    try {
      const metadata = await this.socket.groupMetadata(groupId);
      this.groupNameCache.set(groupId, metadata.subject);
      return metadata.subject;
    } catch {
      return null;
    }
  }

  /**
   * Busca todos os grupos dos quais o bot participa.
   * Retorna lista de { id, name } para registro no dashboard.
   */
  async fetchAllGroups(): Promise<{ id: string; name: string }[]> {
    if (!this.socket) return [];
    try {
      const groups = await this.socket.groupFetchAllParticipating();
      return Object.values(groups).map((g) => {
        this.groupNameCache.set(g.id, g.subject);
        return { id: g.id, name: g.subject };
      });
    } catch {
      return [];
    }
  }

  /**
   * Inicia a conexão com WhatsApp Web.
   * Exibe QR code no terminal para autenticação.
   */
  async connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    // Buscar versão atualizada do protocolo WhatsApp (evita erro 405)
    const { version } = await fetchLatestBaileysVersion();
    this.logger.info({ version }, 'Versão WA');

    this.socket = makeWASocket({
      auth: state,
      logger: this.logger,
      version,
      browser: Browsers.macOS('Chrome'),
      getMessage: async () => undefined,
    });

    // Salvar credenciais quando atualizadas
    this.socket.ev.on('creds.update', saveCreds);

    // Gerenciar estado da conexão
    this.socket.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.logger.info('Escaneie o QR Code abaixo para conectar:');
        qrcode.generate(qr, { small: true });
        this.emit('qr', qr);
      }

      if (connection === 'close') {
        const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = reason !== DisconnectReason.loggedOut;

        this.logger.info(
          { reason, shouldReconnect },
          'Conexão fechada'
        );
        this.emit('connection:close', String(reason));

        if (shouldReconnect) {
          this.logger.info('Reconectando em 3s...');
          setTimeout(() => this.connect(), 3000);
        } else {
          this.logger.warn('Deslogado do WhatsApp. Escaneie o QR novamente.');
        }
      }

      if (connection === 'open') {
        this.botJid = this.socket?.user?.id ?? '';
        this.logger.info({ botJid: this.botJid }, '✓ Conectado ao WhatsApp');
        this.emit('connection:open');
      }
    });

    // Escutar mensagens recebidas
    this.socket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        // Ignorar mensagens do próprio bot
        if (msg.key.fromMe) continue;

        // Processar apenas mensagens de grupo
        const remoteJid = msg.key.remoteJid;
        if (!remoteJid || !isJidGroup(remoteJid)) continue;

        const stored = this.parseMessage(msg, remoteJid);
        if (stored) {
          this.emit('message:group', stored, msg);
        }
      }
    });
  }

  /**
   * Converte uma mensagem do Baileys para o formato StoredMessage.
   */
  private parseMessage(
    msg: proto.IWebMessageInfo,
    groupId: string
  ): StoredMessage | null {
    const content = this.extractTextContent(msg.message);
    if (!content) return null;

    const senderId = msg.key.participant || msg.key.remoteJid || '';
    const senderName = msg.pushName || senderId.split('@')[0];
    const timestamp = typeof msg.messageTimestamp === 'number'
      ? msg.messageTimestamp
      : Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000);

    // Extrair mensagem citada se houver
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const quotedText = quoted ? this.extractTextContent(quoted) : undefined;

    return {
      id: msg.key.id || `${Date.now()}-${Math.random()}`,
      groupId,
      senderId,
      senderName,
      content,
      timestamp,
      messageType: this.getMessageType(msg.message),
      caption: msg.message?.imageMessage?.caption
        || msg.message?.videoMessage?.caption
        || undefined,
      quotedMessage: quotedText || undefined,
    };
  }

  /**
   * Extrai texto de qualquer tipo de mensagem.
   */
  private extractTextContent(
    message: WAMessageContent | null | undefined
  ): string | null {
    if (!message) return null;

    // Texto simples
    if (message.conversation) return message.conversation;

    // Texto estendido (com menções, links, etc)
    if (message.extendedTextMessage?.text) {
      return message.extendedTextMessage.text;
    }

    // Legenda de imagem/vídeo/documento
    if (message.imageMessage?.caption) return `[Imagem] ${message.imageMessage.caption}`;
    if (message.videoMessage?.caption) return `[Vídeo] ${message.videoMessage.caption}`;
    if (message.documentMessage?.caption) return `[Documento] ${message.documentMessage.caption}`;

    // Mídia sem legenda
    if (message.imageMessage) return '[Imagem enviada]';
    if (message.videoMessage) return '[Vídeo enviado]';
    if (message.audioMessage) return '[Áudio enviado]';
    if (message.stickerMessage) return '[Sticker]';
    if (message.documentMessage) {
      return `[Documento: ${message.documentMessage.fileName || 'arquivo'}]`;
    }

    return null;
  }

  /**
   * Identifica o tipo de mensagem.
   */
  private getMessageType(message: WAMessageContent | null | undefined): string {
    if (!message) return 'unknown';
    if (message.conversation || message.extendedTextMessage) return 'text';
    if (message.imageMessage) return 'image';
    if (message.videoMessage) return 'video';
    if (message.audioMessage) return 'audio';
    if (message.stickerMessage) return 'sticker';
    if (message.documentMessage) return 'document';
    return 'unknown';
  }

  /**
   * Envia uma mensagem de texto para um chat.
   */
  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.socket) {
      throw new Error('WhatsApp não conectado');
    }
    await this.socket.sendMessage(jid, { text });
  }

  /**
   * Baixa a mídia de uma mensagem como Buffer.
   */
  async downloadMedia(rawMessage: proto.IWebMessageInfo): Promise<Buffer | null> {
    try {
      const buffer = await downloadMediaMessage(
        rawMessage,
        'buffer',
        {},
        { logger: this.logger, reuploadRequest: this.socket!.updateMediaMessage }
      );
      return buffer as Buffer;
    } catch (error) {
      this.logger.warn({ error, messageId: rawMessage.key.id }, 'Erro ao baixar mídia');
      return null;
    }
  }

  /**
   * Retorna o MIME type da mídia de uma mensagem.
   */
  getMediaMimeType(rawMessage: proto.IWebMessageInfo): string {
    const msg = rawMessage.message;
    return msg?.imageMessage?.mimetype
      || msg?.videoMessage?.mimetype
      || msg?.audioMessage?.mimetype
      || msg?.stickerMessage?.mimetype
      || msg?.documentMessage?.mimetype
      || 'application/octet-stream';
  }

  /**
   * Desconecta do WhatsApp.
   */
  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.end(undefined);
      this.socket = null;
    }
  }
}
