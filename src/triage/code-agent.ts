/**
 * CodeAgent — spawna sessões do Claude CLI para analisar código em repos locais.
 *
 * Usado pelo ProjectTriageService para enriquecer itens de triage com análise
 * automatizada do codebase quando um item é criado e o projeto tem um repo local.
 */
import { spawn } from 'child_process';
import pino from 'pino';
import { ProjectConfig, TriageItem, TriageType } from './types';

const logger = pino({ name: 'code-agent' });

// ============================================
// Tipos públicos
// ============================================

export interface CodeAgentConfig {
  /** Caminho para o binário claude CLI (default: 'claude') */
  cliBinary?: string;
  /** Modelo a usar (default: 'sonnet') */
  model?: string;
  /** Budget máximo em USD por execução (default: 0.50) */
  maxBudgetUsd?: number;
}

export interface CodeAgentResult {
  success: boolean;
  output: string;
  durationMs: number;
  error?: string;
}

export interface CodeAgentTask {
  /** Diretório do repo do projeto */
  repoDir: string;
  /** Prompt a enviar ao Claude */
  prompt: string;
  /** Ferramentas permitidas (default: Read,Grep,Glob,Bash) */
  allowedTools?: string[];
}

// Formato de saída JSON do claude CLI com --output-format json
interface ClaudeJsonOutput {
  type: string;
  subtype?: string;
  cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  is_error?: boolean;
  num_turns?: number;
  result?: string;
  session_id?: string;
  total_cost_usd?: number;
}

// ============================================
// Constantes
// ============================================

const DEFAULT_CLI_BINARY = 'claude';
const DEFAULT_MODEL = 'sonnet';
const DEFAULT_MAX_BUDGET_USD = 0.5;
const DEFAULT_ALLOWED_TOOLS = ['Read', 'Grep', 'Glob', 'Bash'];
const TIMEOUT_MS = 300_000; // 5 minutos
const SIGKILL_DELAY_MS = 5_000;

// ============================================
// CodeAgent
// ============================================

export class CodeAgent {
  private cliBinary: string;
  private model: string;
  private maxBudgetUsd: number;

  constructor(config: CodeAgentConfig = {}) {
    this.cliBinary = config.cliBinary ?? DEFAULT_CLI_BINARY;
    this.model = config.model ?? DEFAULT_MODEL;
    this.maxBudgetUsd = config.maxBudgetUsd ?? DEFAULT_MAX_BUDGET_USD;
  }

  /**
   * Verifica se o CLI do Claude está instalado e acessível.
   */
  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(this.cliBinary, ['--version'], { stdio: 'pipe' });
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }

  /**
   * Executa uma análise de código via Claude CLI.
   * Captura stdout/stderr, respeita timeout de 5 minutos e retorna o resultado.
   */
  async analyze(task: CodeAgentTask): Promise<CodeAgentResult> {
    const startMs = Date.now();
    const allowedTools = (task.allowedTools ?? DEFAULT_ALLOWED_TOOLS).join(',');

    const args = [
      '-p', task.prompt,
      '--dangerously-skip-permissions',
      '--model', this.model,
      '--output-format', 'json',
      '--max-budget-usd', String(this.maxBudgetUsd),
      '--allowedTools', allowedTools,
      '--add-dir', task.repoDir,
    ];

    // Log o comando sem o conteúdo do prompt (pode ser extenso)
    logger.debug(
      {
        binary: this.cliBinary,
        model: this.model,
        maxBudgetUsd: this.maxBudgetUsd,
        allowedTools,
        repoDir: task.repoDir,
        promptLength: task.prompt.length,
      },
      'Iniciando Code Agent',
    );

    return new Promise((resolve) => {
      const proc = spawn(this.cliBinary, args, {
        cwd: task.repoDir,
        stdio: 'pipe',
        env: { ...process.env },
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      proc.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      let timedOut = false;
      let sigkillTimer: ReturnType<typeof setTimeout> | null = null;

      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        logger.warn({ repoDir: task.repoDir }, 'Code Agent timeout — enviando SIGTERM');
        proc.kill('SIGTERM');

        sigkillTimer = setTimeout(() => {
          logger.warn({ repoDir: task.repoDir }, 'Processo nao encerrou após SIGTERM — enviando SIGKILL');
          proc.kill('SIGKILL');
        }, SIGKILL_DELAY_MS);
      }, TIMEOUT_MS);

      proc.on('close', (code) => {
        clearTimeout(timeoutHandle);
        if (sigkillTimer) clearTimeout(sigkillTimer);

        const durationMs = Date.now() - startMs;
        const rawStdout = Buffer.concat(stdoutChunks).toString('utf-8').trim();
        const rawStderr = Buffer.concat(stderrChunks).toString('utf-8').trim();

        if (timedOut) {
          logger.error({ repoDir: task.repoDir, durationMs }, 'Code Agent encerrado por timeout');
          resolve({
            success: false,
            output: '',
            durationMs,
            error: 'Timeout: o processo excedeu 5 minutos e foi encerrado',
          });
          return;
        }

        if (code !== 0) {
          logger.error(
            { code, repoDir: task.repoDir, durationMs, stderr: rawStderr.substring(0, 500) },
            'Code Agent encerrado com erro',
          );
          resolve({
            success: false,
            output: rawStdout,
            durationMs,
            error: rawStderr || `Processo encerrado com código ${code}`,
          });
          return;
        }

        // Tentar parsear o JSON de saída do claude CLI
        let output = rawStdout;
        try {
          const parsed = JSON.parse(rawStdout) as ClaudeJsonOutput;
          if (parsed.is_error) {
            logger.error(
              { repoDir: task.repoDir, durationMs },
              'Claude CLI retornou is_error=true',
            );
            resolve({
              success: false,
              output: parsed.result ?? rawStdout,
              durationMs,
              error: 'Claude CLI sinalizou erro na resposta',
            });
            return;
          }
          output = parsed.result ?? rawStdout;
          logger.info(
            {
              repoDir: task.repoDir,
              durationMs,
              costUsd: parsed.total_cost_usd ?? parsed.cost_usd,
              numTurns: parsed.num_turns,
              outputLength: output.length,
            },
            'Code Agent concluido com sucesso',
          );
        } catch {
          // Saída não é JSON válido — usar texto bruto
          logger.warn(
            { repoDir: task.repoDir, durationMs },
            'Saída do Code Agent nao e JSON valido; usando texto bruto',
          );
        }

        resolve({ success: true, output, durationMs });
      });

      proc.on('error', (err) => {
        clearTimeout(timeoutHandle);
        if (sigkillTimer) clearTimeout(sigkillTimer);

        const durationMs = Date.now() - startMs;
        logger.error({ err, repoDir: task.repoDir, durationMs }, 'Erro ao spawnar Code Agent');
        resolve({
          success: false,
          output: '',
          durationMs,
          error: err.message,
        });
      });
    });
  }

  /**
   * Constrói um prompt contextual em pt-BR para o Claude CLI
   * baseado no tipo e conteúdo do TriageItem.
   */
  buildTriagePrompt(item: TriageItem, projectConfig: ProjectConfig): string {
    const projectContext = projectConfig.context
      ? `\n\nContexto do projeto:\n${projectConfig.context}`
      : '';

    const header = this.buildHeader(item.type);
    const body = [
      `Título: ${item.title}`,
      `Descrição: ${item.description}`,
      `Prioridade: ${item.priority}`,
      `Conteúdo original:\n${item.rawContent}`,
    ].join('\n');

    return `${header}\n\n${body}${projectContext}`;
  }

  // ============================================
  // Helpers privados
  // ============================================

  private buildHeader(type: TriageType): string {
    switch (type) {
      case 'bug':
        return (
          'Investigue este bug reportado via WhatsApp. '
          + 'Analise o codebase, identifique possíveis causas e sugira uma correção.'
        );

      case 'feature':
        return (
          'Analise esta solicitação de feature. '
          + 'Faça um discovery no codebase, identifique onde a mudança seria feita '
          + 'e proponha um plano de implementação.'
        );

      case 'question':
        return 'Responda esta dúvida técnica baseado no codebase atual.';

      case 'support':
        return 'Analise este pedido de suporte e sugira uma solução.';

      case 'update':
        return (
          'Revise esta atualização reportada e verifique se há impacto no codebase '
          + 'que necessite atenção ou documentação.'
        );

      default:
        return 'Analise este item reportado via WhatsApp e forneça uma resposta técnica baseada no codebase.';
    }
  }
}
