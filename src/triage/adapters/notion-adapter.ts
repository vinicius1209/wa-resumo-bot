/**
 * Notion Adapter — implementa IProjectBoard para o Notion.
 *
 * Usa fetch nativo (Node 18+) contra a Notion API REST.
 * Sem dependência @notionhq/client para manter o bundle enxuto.
 */
import pino from 'pino';
import { config } from '../../config';
import { IProjectBoard, TriageItem, BoardItem, TriageType, TriagePriority } from '../types';

const logger = pino({ level: config.logLevel });

const NOTION_BASE_URL = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

// ============================================
// Tipos internos para a API do Notion
// ============================================

interface NotionRichText {
  type: 'text';
  text: { content: string };
}

interface NotionSelectProperty {
  select: { name: string } | null;
}

interface NotionMultiSelectProperty {
  multi_select: Array<{ name: string }>;
}

interface NotionTitleProperty {
  title: Array<NotionRichText>;
}

interface NotionRichTextProperty {
  rich_text: Array<NotionRichText>;
}

interface NotionStatusProperty {
  status: { name: string } | null;
}

interface NotionPageProperties {
  Title?: NotionTitleProperty;
  Type?: NotionSelectProperty;
  Priority?: NotionSelectProperty;
  Status?: NotionStatusProperty;
  Contact?: NotionRichTextProperty;
  Tags?: NotionMultiSelectProperty;
  Source?: NotionRichTextProperty;
  'Message ID'?: NotionRichTextProperty;
}

interface NotionPage {
  id: string;
  url: string;
  created_time: string;
  properties: NotionPageProperties;
}

interface NotionQueryResponse {
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
}

interface NotionErrorResponse {
  object: 'error';
  status: number;
  code: string;
  message: string;
}

// ============================================
// Helpers de mapeamento
// ============================================

function richText(content: string): Array<NotionRichText> {
  return [{ type: 'text', text: { content: content.slice(0, 2000) } }];
}

function extractRichTextContent(prop: NotionRichTextProperty | undefined): string {
  return prop?.rich_text?.[0]?.text?.content ?? '';
}

function extractSelectName(prop: NotionSelectProperty | undefined): string {
  return prop?.select?.name ?? '';
}

function extractTitle(prop: NotionTitleProperty | undefined): string {
  return prop?.title?.[0]?.text?.content ?? '';
}

function extractStatusName(prop: NotionStatusProperty | undefined): string {
  return prop?.status?.name ?? '';
}

function mapPageToBoardItem(page: NotionPage, projectId: string): BoardItem {
  const props = page.properties;

  return {
    id: page.id,
    url: page.url,
    status: extractStatusName(props.Status),
    projectId,
    title: extractTitle(props.Title),
    type: (extractSelectName(props.Type) as TriageType) || 'support',
    priority: (extractSelectName(props.Priority) as TriagePriority) || 'p2',
    createdAt: new Date(page.created_time),
  };
}

// ============================================
// NotionAdapter
// ============================================

export class NotionAdapter implements IProjectBoard {
  readonly name = 'notion';
  private apiKey: string;
  private databaseId: string;

  constructor(config: Record<string, string>) {
    this.databaseId = config.databaseId ?? '';
    this.apiKey = config.apiKey ?? process.env.NOTION_API_KEY ?? '';

    if (!this.apiKey) {
      logger.warn('NotionAdapter: nenhuma apiKey fornecida nem NOTION_API_KEY no env');
    }
    if (!this.databaseId) {
      logger.warn('NotionAdapter: nenhum databaseId fornecido na config');
    }
  }

  // ============================================
  // createItem
  // ============================================

  async createItem(item: TriageItem): Promise<BoardItem> {
    logger.info(
      { projectId: item.projectId, type: item.type, priority: item.priority },
      'NotionAdapter: criando item'
    );

    const body = {
      parent: { database_id: this.databaseId },
      properties: this.buildProperties(item),
      children: [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: richText(item.description),
          },
        },
      ],
    };

    const page = await this.request<NotionPage>('POST', '/pages', body);
    return mapPageToBoardItem(page, item.projectId);
  }

  // ============================================
  // updateItem
  // ============================================

  async updateItem(itemId: string, updates: Partial<TriageItem>): Promise<BoardItem> {
    logger.info({ itemId }, 'NotionAdapter: atualizando item');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic property building
    const properties: Record<string, any> = {};

    if (updates.title !== undefined) {
      properties.Title = { title: richText(updates.title) };
    }
    if (updates.type !== undefined) {
      properties.Type = { select: { name: updates.type } };
    }
    if (updates.priority !== undefined) {
      properties.Priority = { select: { name: updates.priority } };
    }
    if (updates.tags !== undefined) {
      properties.Tags = { multi_select: updates.tags.map((t: string) => ({ name: t })) };
    }
    if (updates.source !== undefined) {
      properties.Contact = { rich_text: richText(updates.source.contactName) };
      properties['Message ID'] = { rich_text: richText(updates.source.messageId) };
    }

    const page = await this.request<NotionPage>('PATCH', `/pages/${itemId}`, { properties });
    return mapPageToBoardItem(page, updates.projectId ?? '');
  }

  // ============================================
  // findByReference
  // ============================================

  async findByReference(projectId: string, reference: string): Promise<BoardItem | null> {
    logger.debug({ projectId, reference }, 'NotionAdapter: buscando por referencia');

    const body = {
      filter: {
        property: 'Message ID',
        rich_text: { equals: reference },
      },
      page_size: 1,
    };

    try {
      const result = await this.request<NotionQueryResponse>(
        'POST',
        `/databases/${this.databaseId}/query`,
        body
      );

      if (result.results.length === 0) {
        return null;
      }

      return mapPageToBoardItem(result.results[0], projectId);
    } catch (err) {
      logger.error({ err, reference }, 'NotionAdapter: erro ao buscar por referencia');
      return null;
    }
  }

  // ============================================
  // listOpen
  // ============================================

  async listOpen(projectId: string, limit: number = 50): Promise<BoardItem[]> {
    logger.debug({ projectId, limit }, 'NotionAdapter: listando itens abertos');

    const body = {
      filter: {
        property: 'Status',
        status: { does_not_equal: 'Done' },
      },
      page_size: Math.min(limit, 100),
    };

    try {
      const result = await this.request<NotionQueryResponse>(
        'POST',
        `/databases/${this.databaseId}/query`,
        body
      );

      return result.results.map((page) => mapPageToBoardItem(page, projectId));
    } catch (err) {
      logger.error({ err, projectId }, 'NotionAdapter: erro ao listar itens abertos');
      return [];
    }
  }

  // ============================================
  // Internals
  // ============================================

  private buildProperties(item: TriageItem): NotionPageProperties {
    return {
      Title: { title: richText(item.title) },
      Type: { select: { name: item.type } },
      Priority: { select: { name: item.priority } },
      Status: { status: { name: 'Not started' } },
      Contact: { rich_text: richText(item.source.contactName) },
      Tags: { multi_select: item.tags.map((t) => ({ name: t })) },
      Source: { rich_text: richText('WhatsApp') },
      'Message ID': { rich_text: richText(item.source.messageId) },
    };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${NOTION_BASE_URL}${path}`;

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      let errorBody: NotionErrorResponse | string;
      try {
        errorBody = (await response.json()) as NotionErrorResponse;
      } catch {
        errorBody = await response.text();
      }

      logger.error(
        { status: response.status, path, errorBody },
        'NotionAdapter: erro na API do Notion'
      );

      const message =
        typeof errorBody === 'object'
          ? `Notion API error ${errorBody.status}: ${errorBody.message} (${errorBody.code})`
          : `Notion API error ${response.status}: ${errorBody}`;

      throw new Error(message);
    }

    return response.json() as Promise<T>;
  }
}
