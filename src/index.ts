/**
 * WA-RESUMO-BOT — Ponto de entrada principal.
 *
 * Bootstrap:
 * 1. Carrega configuração
 * 2. Inicializa storage (SQLite)
 * 3. Cria LLM provider (OpenAI ou Anthropic)
 * 4. Registra comandos
 * 5. Conecta ao WhatsApp
 * 6. Escuta mensagens → armazena + processa comandos
 */
import { config } from './config';
import { WhatsAppConnection } from './whatsapp';
import { SQLiteStorage } from './storage';
import { createLLMProvider } from './llm';
import { CommandHandler, ResumoCommand, HelpCommand, StatsCommand, PalavrasCommand, LinksCommand, RetroCommand, DividaCommand, QuizCommand, isQuizAnswer, CompromissosCommand, TemperaturaCommand, PersonaCommand, MePerdiCommand } from './commands';
import { RateLimiter, SummaryService, MediaProcessor, AnalyticsService, WordOfDayService, LinkService, StatsService, RetroService, DebtService, QuizService, CommitmentService, SentimentService, PersonaService, CatchupService, DynamicConfigService, eventBus } from './services';
import { startDashboard, stopDashboard } from './dashboard/server';
import { StoredMessage } from './types';
import { proto } from '@whiskeysockets/baileys';
import pino from 'pino';

const logger = pino({ level: config.logLevel });

async function main(): Promise<void> {
  logger.info('=== WA-RESUMO-BOT ===');
  logger.info({ provider: config.llm.provider }, 'Configuração carregada');

  // 1. Storage
  const storage = new SQLiteStorage();
  await storage.init();
  logger.info('✓ Storage SQLite inicializado');

  // 2. Analytics
  const analytics = new AnalyticsService();
  analytics.initTable(storage.getDatabase());
  logger.info('✓ Analytics inicializado');

  // 2.5. Dynamic Config
  const dynamicConfig = new DynamicConfigService();
  dynamicConfig.initTable(storage.getDatabase());
  logger.info('✓ Dynamic Config inicializado');

  // 3. LLM Provider
  const llmProvider = createLLMProvider();
  logger.info({ provider: llmProvider.name }, '✓ LLM Provider criado');

  // 4. Rate Limiter
  const rateLimiter = new RateLimiter();

  // 5. Summary Service
  const summaryService = new SummaryService(storage, llmProvider, rateLimiter);
  summaryService.setAnalytics(analytics);

  // 6. Media Processor
  const mediaProcessor = config.media.enabled ? new MediaProcessor() : null;
  if (mediaProcessor) {
    logger.info('✓ Processamento de mídia habilitado');
  }

  // 7. Word of Day + Link Curator
  const wordOfDayService = new WordOfDayService();
  wordOfDayService.initTable(storage.getDatabase());

  const linkService = new LinkService();
  linkService.initTable(storage.getDatabase());
  logger.info('✓ Serviços Fase 1 inicializados (Palavra do dia, Links)');

  // 8. Retro + Dívidas (Fase 2)
  const statsService = new StatsService();
  const retroService = new RetroService();
  retroService.initTable(storage.getDatabase());

  const debtService = new DebtService();
  debtService.initTable(storage.getDatabase());
  logger.info('✓ Serviços Fase 2 inicializados (Retro, Dívidas)');

  // 9. Quiz + Compromissos (Fase 3)
  const quizService = new QuizService();
  quizService.initTable(storage.getDatabase());

  const commitmentService = new CommitmentService();
  commitmentService.initTable(storage.getDatabase());
  logger.info('✓ Serviços Fase 3 inicializados (Quiz, Compromissos)');

  // 10. Sentimento + Persona (Fase 4)
  const sentimentService = new SentimentService();

  const personaService = new PersonaService();
  personaService.initTable(storage.getDatabase());
  logger.info('✓ Serviços Fase 4 inicializados (Sentimento, Persona)');

  // 11. Catchup (Fase 5)
  const catchupService = new CatchupService();
  catchupService.initTable(storage.getDatabase());
  logger.info('✓ Serviço Fase 5 inicializado (Catchup)');

  // 12. Comandos
  const commandHandler = new CommandHandler();
  commandHandler.setAnalytics(analytics);
  commandHandler.register(new ResumoCommand(summaryService));
  commandHandler.register(new StatsCommand(analytics));
  commandHandler.register(new PalavrasCommand(wordOfDayService));
  commandHandler.register(new LinksCommand(linkService));
  commandHandler.register(new RetroCommand(statsService, retroService, storage));
  commandHandler.register(new DividaCommand(debtService));
  commandHandler.register(new QuizCommand(quizService, storage));
  commandHandler.register(new CompromissosCommand(commitmentService));
  commandHandler.register(new TemperaturaCommand(sentimentService));
  commandHandler.register(new PersonaCommand(personaService, storage));
  commandHandler.register(new MePerdiCommand(catchupService, storage, summaryService));
  commandHandler.register(new HelpCommand(commandHandler.getUniqueCommands()));
  logger.info(
    { commands: commandHandler.getUniqueCommands().map((c) => c.name) },
    '✓ Comandos registrados'
  );

  // 11. WhatsApp
  const whatsapp = new WhatsAppConnection();

  // Quiz timeout callback — envia resposta quando ninguém acerta em 30s
  quizService.setOnRoundEnd((groupId, result) => {
    whatsapp.sendMessage(groupId, result.message).catch((error) => {
      logger.warn({ error, groupId }, 'Erro ao enviar resultado do quiz');
    });
  });

  whatsapp.on('connection:open', async () => {
    logger.info('✓ Bot online e escutando mensagens de grupo');

    // Iniciar dashboard se habilitado
    try {
      await startDashboard({
        analyticsService: analytics,
        dynamicConfigService: dynamicConfig,
      });
    } catch (error) {
      logger.error({ error }, 'Erro ao iniciar dashboard');
    }
  });

  whatsapp.on('connection:close', (reason: string) => {
    logger.warn({ reason }, 'Conexão com WhatsApp fechada');
  });

  // 9. Escutar mensagens de grupo
  whatsapp.on('message:group', async (message: StoredMessage, rawMessage: proto.IWebMessageInfo) => {
    // Verificar se o grupo está permitido
    if (!dynamicConfig.isGroupAllowed(message.groupId)) {
      return; // Grupo bloqueado — ignorar silenciosamente
    }

    // Auto-registrar grupo no dashboard (com nome)
    whatsapp.getGroupName(message.groupId).then((groupName) => {
      dynamicConfig.ensureGroupExists(message.groupId, groupName ?? undefined);
    }).catch(() => {
      dynamicConfig.ensureGroupExists(message.groupId);
    });

    // Armazenar toda mensagem
    try {
      await storage.save(message);
      eventBus.emitMessage(message.groupId, message.senderName, message.content, message.messageType);
    } catch (error) {
      logger.error({ error, messageId: message.id }, 'Erro ao salvar mensagem');
    }

    // Processar mídia em background (não bloqueia comando)
    if (mediaProcessor && message.messageType !== 'text' && message.messageType !== 'unknown') {
      processMedia(whatsapp, mediaProcessor, storage, analytics, message, rawMessage).catch((error) => {
        logger.error({ error, messageId: message.id }, 'Erro ao processar mídia');
      });
    }

    // Detectar e processar links em background
    const urls = linkService.extractUrls(message.content);
    if (urls.length > 0) {
      for (const url of urls) {
        linkService.processLink(
          message.groupId, url, message.senderId,
          message.senderName, message.timestamp, message.id
        ).catch((error) => {
          logger.warn({ error, url }, 'Erro ao processar link');
        });
      }
    }

    // Atualizar atividade do membro (para catchup)
    catchupService.updateActivity(message.groupId, message.senderId, message.timestamp);

    // Alimentar detector de sentimento
    sentimentService.feedMessage(message);
    const temp = sentimentService.getTemperature(message.groupId);
    eventBus.emitSentiment(message.groupId, temp.score, temp.label);
    if (sentimentService.shouldAlert(message.groupId)) {
      sentimentService.markAlerted(message.groupId);
      await whatsapp.sendMessage(
        message.groupId,
        `🌡️ *Alerta:* O grupo está ${temp.label}! (score: ${temp.score})\nCalma, galera! 😅`
      );
    }

    // Verificar resposta ao quiz (antes de processar como comando)
    const quizAnswer = isQuizAnswer(message.content.trim());
    if (quizAnswer !== null && quizService.isActiveRound(message.groupId)) {
      const result = quizService.checkAnswer(
        message.groupId, message.senderId, message.senderName, quizAnswer
      );
      if (result && result.correct) {
        await whatsapp.sendMessage(
          message.groupId,
          `✅ @${message.senderName} acertou! Foi *${result.correctName}* que disse isso! (+1 ponto)`
        );
      }
    }

    // Tentar processar como comando
    const reply = async (text: string) => {
      await whatsapp.sendMessage(message.groupId, text);
    };

    await commandHandler.handleMessage(message, reply);
  });

  // 10. Conectar
  await whatsapp.connect();

  // 11. Limpeza periódica de rate limit (a cada 10 min)
  setInterval(() => {
    rateLimiter.cleanup();
  }, 10 * 60 * 1000);

  // 12. Limpeza de mensagens antigas (a cada 24h, remove msgs > 7 dias)
  setInterval(async () => {
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
    const purged = await storage.purgeOlderThan(sevenDaysAgo);
    if (purged > 0) {
      logger.info({ purged }, 'Mensagens antigas removidas');
    }
  }, 24 * 60 * 60 * 1000);

  // Lembretes de compromissos (a cada 30min)
  setInterval(async () => {
    try {
      const pending = commitmentService.getPendingReminders();
      for (const commitment of pending) {
        if (!commitment.event_date) continue;
        const eventDate = new Date(commitment.event_date * 1000);
        const timeStr = eventDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const dateStr = eventDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        const text = `⏰ *Lembrete:* ${commitment.description} — ${dateStr} às ${timeStr}`;
        await whatsapp.sendMessage(commitment.group_id, text);
        commitmentService.markReminderSent(commitment.id);
      }
    } catch (error) {
      logger.error({ error }, 'Erro no scheduler de lembretes');
    }
  }, 30 * 60 * 1000);

  // Palavra do dia — scheduler diário às 23h
  const scheduleWordOfDay = () => {
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 0, 0);
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }
    const msUntil = target.getTime() - now.getTime();

    setTimeout(async () => {
      try {
        // Buscar grupos ativos (que têm mensagens hoje)
        const startOfDay = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000);
        const endOfDay = Math.floor(Date.now() / 1000);
        const db = storage.getDatabase();
        const groups = db.prepare(
          'SELECT DISTINCT group_id FROM messages WHERE timestamp >= ? AND timestamp <= ?'
        ).all(startOfDay, endOfDay) as Array<{ group_id: string }>;

        for (const { group_id } of groups) {
          const result = await wordOfDayService.generateWordOfDay(group_id, storage);
          if (result) {
            const text = `🏆 *Palavra do dia:* _${result.word}_ (mencionada ${result.count}x por ${result.uniqueSenders} pessoas)`;
            await whatsapp.sendMessage(group_id, text);
          }
        }
      } catch (error) {
        logger.error({ error }, 'Erro no scheduler palavra do dia');
      }
      // Re-agendar para amanhã
      scheduleWordOfDay();
    }, msUntil);

    logger.info({ nextRunIn: `${Math.round(msUntil / 60000)}min` }, '✓ Palavra do dia agendada');
  };
  scheduleWordOfDay();

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Desligando bot...');
    await stopDashboard();
    await whatsapp.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/**
 * Baixa e processa mídia de uma mensagem, salvando a descrição no storage.
 */
async function processMedia(
  whatsapp: WhatsAppConnection,
  processor: MediaProcessor,
  storage: SQLiteStorage,
  analytics: AnalyticsService,
  message: StoredMessage,
  rawMessage: proto.IWebMessageInfo
): Promise<void> {
  const mimeType = whatsapp.getMediaMimeType(rawMessage);

  // Verificar tamanho (estimativa via fileLength do Baileys)
  const fileLength = Number(
    rawMessage.message?.imageMessage?.fileLength
    || rawMessage.message?.videoMessage?.fileLength
    || rawMessage.message?.audioMessage?.fileLength
    || 0
  );
  const maxBytes = config.media.maxSizeMB * 1024 * 1024;
  if (fileLength > maxBytes) {
    logger.info({ messageId: message.id, fileLength }, 'Mídia ignorada (muito grande)');
    return;
  }

  const buffer = await whatsapp.downloadMedia(rawMessage);
  if (!buffer) return;

  let description: string | null = null;
  const startMs = Date.now();

  try {
    switch (message.messageType) {
      case 'image':
      case 'sticker':
        description = await processor.processImage(buffer, mimeType);
        break;
      case 'audio':
        description = await processor.processAudio(buffer, mimeType);
        break;
      case 'video':
        description = await processor.processVideo(buffer, mimeType);
        break;
    }

    if (description) {
      await storage.updateMediaDescription(message.id, description);
      logger.info(
        { messageId: message.id, type: message.messageType, descriptionLength: description.length },
        'Mídia processada'
      );
    }

    eventBus.emitMedia(message.groupId, message.messageType, Date.now() - startMs);

    analytics.track({
      eventType: 'media_process',
      groupId: message.groupId,
      senderId: message.senderId,
      durationMs: Date.now() - startMs,
      success: true,
      metadata: { mediaType: message.messageType, mimeType },
    });
  } catch (error) {
    analytics.track({
      eventType: 'media_process',
      groupId: message.groupId,
      senderId: message.senderId,
      durationMs: Date.now() - startMs,
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
      metadata: { mediaType: message.messageType },
    });
    throw error;
  }
}

main().catch((error) => {
  logger.fatal({ error }, 'Erro fatal ao iniciar o bot');
  process.exit(1);
});
