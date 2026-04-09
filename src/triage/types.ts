/**
 * Triage Module — Tipos e Contratos
 *
 * Interface-driven: adapters (Notion, Jira, Linear, etc.)
 * implementam IProjectBoard. O ProjectTriageService orquestra.
 */

// ============================================
// Classificação de mensagem
// ============================================

export type TriageType = 'bug' | 'feature' | 'question' | 'support' | 'update';
export type TriagePriority = 'p0' | 'p1' | 'p2' | 'p3';

export interface TriageClassification {
  type: TriageType;
  priority: TriagePriority;
  title: string;
  description: string;
  /** Tags extraídas do contexto (ex: "login", "payment", "mobile") */
  tags: string[];
}

// ============================================
// Item de triage (input para o board)
// ============================================

export interface TriageItem {
  projectId: string;
  title: string;
  description: string;
  type: TriageType;
  priority: TriagePriority;
  tags: string[];
  source: TriageSource;
  rawContent: string;
}

export interface TriageSource {
  contact: string;
  contactName: string;
  channel: 'whatsapp';
  messageId: string;
  timestamp: Date;
  /** Transcrição de áudio, se aplicável */
  audioTranscript?: string;
  /** Descrição de imagem/vídeo, se aplicável */
  mediaDescription?: string;
}

// ============================================
// Item no board externo (output do adapter)
// ============================================

export interface BoardItem {
  id: string;
  url: string;
  status: string;
  projectId: string;
  title: string;
  type: TriageType;
  priority: TriagePriority;
  createdAt: Date;
}

// ============================================
// IProjectBoard — contrato dos adapters
// ============================================

export interface IProjectBoard {
  /** Nome do adapter ("notion", "jira", "linear") */
  readonly name: string;

  /** Cria um novo item no board do projeto */
  createItem(item: TriageItem): Promise<BoardItem>;

  /** Atualiza um item existente */
  updateItem(itemId: string, updates: Partial<TriageItem>): Promise<BoardItem>;

  /** Busca item por referência (evitar duplicatas) */
  findByReference(projectId: string, reference: string): Promise<BoardItem | null>;

  /** Lista itens abertos de um projeto */
  listOpen(projectId: string, limit?: number): Promise<BoardItem[]>;
}

// ============================================
// Configuração de projeto
// ============================================

export interface ProjectBoardConfig {
  adapter: string;
  config: Record<string, string>;
}

export interface ProjectConfig {
  id: string;
  name: string;
  /** JIDs dos contatos mapeados a este projeto */
  contacts: string[];
  /** Boards onde os itens serão criados (suporta múltiplos) */
  boards: ProjectBoardConfig[];
  /** Repo Git (para futuros agentes de código) */
  repoUrl?: string;
  /** Contexto adicional para o LLM classificador */
  context?: string;
}

// ============================================
// Adapter Factory
// ============================================

export type ProjectBoardFactory = (
  adapterName: string,
  config: Record<string, string>
) => IProjectBoard | null;
