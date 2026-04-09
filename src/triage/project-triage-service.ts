/**
 * ProjectTriageService — orquestra o fluxo de triagem de mensagens DM.
 *
 * Responsabilidades:
 * - Manter o mapeamento de contatos → projetos (SQLite)
 * - Registrar adapters de boards (Notion, Jira, Linear, etc.)
 * - Receber mensagens, classificar via LLM e criar itens nos boards configurados
 * - Persistir os itens criados em triage_items para histórico e deduplicação
 * - Emitir eventos para o dashboard via EventBus
 */
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import pino from 'pino';
import { ILLMProvider, StoredMessage } from '../types';
import { eventBus } from '../services/event-bus';
import {
  BoardItem,
  IProjectBoard,
  ProjectBoardConfig,
  ProjectConfig,
  TriageItem,
} from './types';
import { TriageClassifier } from './classifier';
import { CodeAgent } from './code-agent';

const logger = pino({ name: 'project-triage-service' });

// ============================================
// SQLite row shapes
// ============================================

interface ProjectRow {
  id: string;
  name: string;
  contacts_json: string;
  boards_json: string;
  repo_url: string | null;
  context: string | null;
  created_at: number;
  updated_at: number;
}

// ============================================
// Service
// ============================================

export class ProjectTriageService {
  private db!: Database.Database;
  private classifier: TriageClassifier;
  private adapters = new Map<string, IProjectBoard>();
  private codeAgent: CodeAgent | null = null;

  constructor(
    private llmProvider: ILLMProvider,
    // Adapters can be pre-registered at construction or added later via registerAdapter()
    initialAdapters: IProjectBoard[] = [],
  ) {
    this.classifier = new TriageClassifier(llmProvider);
    for (const adapter of initialAdapters) {
      this.adapters.set(adapter.name, adapter);
    }
  }

  // ============================================
  // Table initialisation
  // ============================================

  /** Inicializa as tabelas de triage no banco compartilhado. */
  initTable(db: Database.Database): void {
    this.db = db;

    db.exec(`
      CREATE TABLE IF NOT EXISTS triage_projects (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        contacts_json TEXT NOT NULL DEFAULT '[]',
        boards_json   TEXT NOT NULL DEFAULT '[]',
        repo_url    TEXT,
        context     TEXT,
        created_at  INTEGER DEFAULT (unixepoch()),
        updated_at  INTEGER DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_triage_projects_name
        ON triage_projects(name);

      CREATE TABLE IF NOT EXISTS triage_items (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id       TEXT NOT NULL,
        board_adapter    TEXT NOT NULL,
        board_item_id    TEXT NOT NULL,
        board_item_url   TEXT,
        title            TEXT NOT NULL,
        type             TEXT NOT NULL,
        priority         TEXT NOT NULL,
        tags_json        TEXT NOT NULL DEFAULT '[]',
        source_contact   TEXT NOT NULL,
        source_message_id TEXT NOT NULL,
        raw_content      TEXT NOT NULL,
        created_at       INTEGER DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_triage_items_project
        ON triage_items(project_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_triage_items_source
        ON triage_items(source_contact, source_message_id);
    `);

    logger.info('Tabelas triage_projects e triage_items inicializadas');
  }

  // ============================================
  // Adapter registry
  // ============================================

  /** Verifica se um adapter já está registrado. */
  hasAdapter(name: string): boolean {
    return this.adapters.has(name);
  }

  /** Registra um adapter de board pelo nome. */
  registerAdapter(name: string, adapter: IProjectBoard): void {
    this.adapters.set(name, adapter);
    logger.info({ adapterName: name }, 'Adapter de board registrado');
  }

  /** Registra o CodeAgent para análise automática de repos locais. */
  setCodeAgent(agent: CodeAgent): void {
    this.codeAgent = agent;
    logger.info('CodeAgent registrado no ProjectTriageService');
  }

  // ============================================
  // Project CRUD
  // ============================================

  /** Salva um novo projeto de triage. */
  addProject(config: ProjectConfig): void {
    const now = Math.floor(Date.now() / 1000);
    const id = config.id || randomUUID();

    this.db
      .prepare(
        `INSERT INTO triage_projects (id, name, contacts_json, boards_json, repo_url, context, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        config.name,
        JSON.stringify(config.contacts ?? []),
        JSON.stringify(config.boards ?? []),
        config.repoUrl ?? null,
        config.context ?? null,
        now,
        now,
      );

    logger.info({ projectId: id, name: config.name }, 'Projeto de triage adicionado');
  }

  /** Recupera a configuração de um projeto pelo ID. */
  getProject(projectId: string): ProjectConfig | null {
    const row = this.db
      .prepare('SELECT * FROM triage_projects WHERE id = ?')
      .get(projectId) as ProjectRow | undefined;

    if (!row) return null;
    return this.rowToConfig(row);
  }

  /** Lista todos os projetos. */
  getAllProjects(): ProjectConfig[] {
    const rows = this.db
      .prepare('SELECT * FROM triage_projects ORDER BY name ASC')
      .all() as ProjectRow[];

    return rows.map((r) => this.rowToConfig(r));
  }

  /**
   * Encontra o projeto ao qual um contato pertence.
   * Faz um scan de todos os projetos e verifica o contacts_json.
   * Para volumes pequenos (< centenas de projetos) isso é aceitável.
   */
  findProjectByContact(contactJid: string): ProjectConfig | null {
    const rows = this.db
      .prepare('SELECT * FROM triage_projects')
      .all() as ProjectRow[];

    for (const row of rows) {
      let contacts: string[] = [];
      try {
        contacts = JSON.parse(row.contacts_json) as string[];
      } catch {
        continue;
      }
      if (contacts.includes(contactJid)) {
        return this.rowToConfig(row);
      }
    }

    return null;
  }

  /** Atualiza campos de um projeto existente. */
  updateProject(projectId: string, updates: Partial<ProjectConfig>): void {
    const existing = this.getProject(projectId);
    if (!existing) {
      throw new Error(`Projeto nao encontrado: ${projectId}`);
    }

    const merged: ProjectConfig = { ...existing, ...updates, id: projectId };
    const now = Math.floor(Date.now() / 1000);

    this.db
      .prepare(
        `UPDATE triage_projects
         SET name = ?, contacts_json = ?, boards_json = ?, repo_url = ?, context = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        merged.name,
        JSON.stringify(merged.contacts ?? []),
        JSON.stringify(merged.boards ?? []),
        merged.repoUrl ?? null,
        merged.context ?? null,
        now,
        projectId,
      );

    logger.info({ projectId }, 'Projeto de triage atualizado');
  }

  /** Remove um projeto e seus itens de triage. */
  removeProject(projectId: string): void {
    this.db.prepare('DELETE FROM triage_items WHERE project_id = ?').run(projectId);
    this.db.prepare('DELETE FROM triage_projects WHERE id = ?').run(projectId);
    logger.info({ projectId }, 'Projeto de triage removido');
  }

  // ============================================
  // Triage flow
  // ============================================

  /**
   * Tria uma mensagem recebida via DM.
   *
   * Fluxo:
   * 1. Encontra o projeto pelo JID do remetente
   * 2. Monta o conteúdo bruto (texto + mídia)
   * 3. Classifica via LLM
   * 4. Cria o TriageItem
   * 5. Para cada board configurado no projeto, chama createItem()
   * 6. Persiste os resultados no SQLite
   * 7. Emite evento para o dashboard
   *
   * @returns O TriageItem e os BoardItems criados, ou null se nenhum projeto mapeado
   */
  async triageMessage(
    message: StoredMessage,
    mediaDescription?: string,
    audioTranscript?: string,
  ): Promise<{ item: TriageItem; results: BoardItem[] } | null> {
    const contactJid = message.senderId;
    const project = this.findProjectByContact(contactJid);

    if (!project) {
      logger.debug({ contactJid }, 'Nenhum projeto mapeado para este contato; triage ignorada');
      return null;
    }

    // Build raw content string from all available sources
    const parts: string[] = [];

    if (message.content && message.content.trim().length > 0) {
      parts.push(message.content.trim());
    }

    if (message.caption && message.caption.trim().length > 0) {
      parts.push(`Legenda: ${message.caption.trim()}`);
    }

    if (audioTranscript && audioTranscript.trim().length > 0) {
      parts.push(`Transcrição de áudio: ${audioTranscript.trim()}`);
    }

    if (mediaDescription && mediaDescription.trim().length > 0) {
      parts.push(`Descrição da mídia: ${mediaDescription.trim()}`);
    }

    const rawContent = parts.join('\n\n');

    if (rawContent.trim().length === 0) {
      logger.warn({ messageId: message.id, contactJid }, 'Mensagem sem conteúdo textual; triage ignorada');
      return null;
    }

    // Classify
    let classification;
    try {
      classification = await this.classifier.classify(rawContent, project.context);
    } catch (err) {
      logger.error({ err, messageId: message.id }, 'Erro ao classificar mensagem');
      return null;
    }

    // Build TriageItem
    const triageItem: TriageItem = {
      projectId: project.id,
      title: classification.title,
      description: classification.description,
      type: classification.type,
      priority: classification.priority,
      tags: classification.tags,
      source: {
        contact: contactJid,
        contactName: message.senderName,
        channel: 'whatsapp',
        messageId: message.id,
        timestamp: new Date(message.timestamp * 1000),
        audioTranscript: audioTranscript || undefined,
        mediaDescription: mediaDescription || undefined,
      },
      rawContent,
    };

    // Push to all configured boards
    const results: BoardItem[] = [];

    for (const boardConfig of project.boards) {
      const adapter = this.adapters.get(boardConfig.adapter);
      if (!adapter) {
        logger.warn(
          { adapterName: boardConfig.adapter, projectId: project.id },
          'Adapter nao registrado; board ignorado',
        );
        continue;
      }

      let boardItem: BoardItem;
      try {
        boardItem = await adapter.createItem(triageItem);
      } catch (err) {
        logger.error(
          { err, adapterName: boardConfig.adapter, projectId: project.id },
          'Erro ao criar item no board',
        );
        continue;
      }

      // Persist to SQLite
      this.persistTriageItem(triageItem, boardConfig.adapter, boardItem);
      results.push(boardItem);

      logger.info(
        {
          projectId: project.id,
          adapter: boardConfig.adapter,
          boardItemId: boardItem.id,
          type: triageItem.type,
          priority: triageItem.priority,
        },
        'Item de triage criado no board',
      );
    }

    // Fire-and-forget: spawn code agent se o repo for um caminho local
    if (this.codeAgent && project.repoUrl && project.repoUrl.startsWith('/')) {
      const prompt = this.codeAgent.buildTriagePrompt(triageItem, project);
      this.codeAgent
        .analyze({ repoDir: project.repoUrl, prompt })
        .then((result) => {
          eventBus.emitBotEvent('code_agent', {
            projectId: project.id,
            success: result.success,
            durationMs: result.durationMs,
            outputLength: result.output.length,
          });
          // TODO: atualizar o board item com a análise quando suportado
        })
        .catch((err) => {
          logger.error({ err, projectId: project.id }, 'Code agent falhou');
        });
    }

    // Emit event for dashboard (fire-and-forget)
    setImmediate(() => {
      eventBus.emitBotEvent('triage', {
        projectId: project.id,
        projectName: project.name,
        contactJid,
        contactName: message.senderName,
        type: triageItem.type,
        priority: triageItem.priority,
        title: triageItem.title,
        boardsCount: results.length,
        messageId: message.id,
      });
    });

    return { item: triageItem, results };
  }

  // ============================================
  // Triage items query
  // ============================================

  /** Lista itens de triage de um projeto com paginação. */
  getTriageItems(
    projectId: string,
    limit = 50,
    offset = 0,
  ): {
    id: number;
    project_id: string;
    board_adapter: string;
    board_item_id: string;
    board_item_url: string | null;
    title: string;
    type: string;
    priority: string;
    tags: string[];
    source_contact: string;
    source_message_id: string;
    raw_content: string;
    created_at: number;
  }[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM triage_items
         WHERE project_id = ?
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(projectId, limit, offset) as {
        id: number;
        project_id: string;
        board_adapter: string;
        board_item_id: string;
        board_item_url: string | null;
        title: string;
        type: string;
        priority: string;
        tags_json: string;
        source_contact: string;
        source_message_id: string;
        raw_content: string;
        created_at: number;
      }[];

    return rows.map((r) => {
      let tags: string[] = [];
      try {
        tags = JSON.parse(r.tags_json) as string[];
      } catch {
        // ignore malformed JSON
      }
      return {
        id: r.id,
        project_id: r.project_id,
        board_adapter: r.board_adapter,
        board_item_id: r.board_item_id,
        board_item_url: r.board_item_url,
        title: r.title,
        type: r.type,
        priority: r.priority,
        tags,
        source_contact: r.source_contact,
        source_message_id: r.source_message_id,
        raw_content: r.raw_content,
        created_at: r.created_at,
      };
    });
  }

  // ============================================
  // Private helpers
  // ============================================

  private persistTriageItem(
    item: TriageItem,
    adapterName: string,
    boardItem: BoardItem,
  ): void {
    try {
      this.db
        .prepare(
          `INSERT INTO triage_items
            (project_id, board_adapter, board_item_id, board_item_url, title, type, priority,
             tags_json, source_contact, source_message_id, raw_content)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          item.projectId,
          adapterName,
          boardItem.id,
          boardItem.url ?? null,
          item.title,
          item.type,
          item.priority,
          JSON.stringify(item.tags),
          item.source.contact,
          item.source.messageId,
          item.rawContent,
        );
    } catch (err) {
      // Non-critical — log and continue
      logger.error({ err, boardItemId: boardItem.id }, 'Erro ao persistir triage_item no SQLite');
    }
  }

  private rowToConfig(row: ProjectRow): ProjectConfig {
    let contacts: string[] = [];
    let boards: ProjectBoardConfig[] = [];

    try {
      contacts = JSON.parse(row.contacts_json) as string[];
    } catch {
      logger.warn({ projectId: row.id }, 'contacts_json invalido; usando array vazio');
    }

    try {
      boards = JSON.parse(row.boards_json) as ProjectBoardConfig[];
    } catch {
      logger.warn({ projectId: row.id }, 'boards_json invalido; usando array vazio');
    }

    return {
      id: row.id,
      name: row.name,
      contacts,
      boards,
      repoUrl: row.repo_url ?? undefined,
      context: row.context ?? undefined,
    };
  }
}
