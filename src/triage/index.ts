/**
 * Triage Module — barrel de exportações.
 */

export * from './types';
export { TriageClassifier } from './classifier';
export { ProjectTriageService } from './project-triage-service';
export { CodeAgent } from './code-agent';
export type { CodeAgentConfig, CodeAgentResult, CodeAgentTask } from './code-agent';
export { createProjectBoardAdapter, NotionAdapter } from './adapters';
