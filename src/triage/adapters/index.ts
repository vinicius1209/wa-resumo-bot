/**
 * Adapter factory — instancia o IProjectBoard correto pelo nome.
 */
import pino from 'pino';
import { config } from '../../config';
import { IProjectBoard } from '../types';
import { NotionAdapter } from './notion-adapter';

const logger = pino({ level: config.logLevel });

export function createProjectBoardAdapter(
  adapterName: string,
  adapterConfig: Record<string, string>
): IProjectBoard | null {
  switch (adapterName) {
    case 'notion':
      return new NotionAdapter(adapterConfig);

    default:
      logger.warn({ adapterName }, 'createProjectBoardAdapter: adapter desconhecido, retornando null');
      return null;
  }
}

export { NotionAdapter };
