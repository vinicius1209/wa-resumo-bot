#!/usr/bin/env node
/**
 * WA-Resumo-Bot — Setup Wizard
 *
 * Guia interativo para configuração inicial do projeto.
 * Executa via: npm run setup
 */
import { createInterface } from 'readline';
import { existsSync, writeFileSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { randomBytes } from 'crypto';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

const green = (t) => `\x1b[32m${t}\x1b[0m`;
const red = (t) => `\x1b[31m${t}\x1b[0m`;
const yellow = (t) => `\x1b[33m${t}\x1b[0m`;
const bold = (t) => `\x1b[1m${t}\x1b[0m`;
const dim = (t) => `\x1b[2m${t}\x1b[0m`;

console.log('');
console.log(bold('🤖 WA-Resumo-Bot — Setup'));
console.log('');

// ============================================
// 1. Pré-requisitos
// ============================================

let hasErrors = false;

// Node.js version
const nodeVersion = process.version;
const nodeMajor = parseInt(nodeVersion.slice(1));
if (nodeMajor >= 18) {
  console.log(green('✓') + ` Node.js ${nodeVersion}`);
} else {
  console.log(red('✗') + ` Node.js ${nodeVersion} — requer 18+`);
  hasErrors = true;
}

// ffmpeg
let hasFFmpeg = false;
try {
  execSync('ffmpeg -version', { stdio: 'pipe' });
  hasFFmpeg = true;
  console.log(green('✓') + ' ffmpeg encontrado');
} catch {
  console.log(yellow('⚠') + ' ffmpeg não encontrado ' + dim('(necessário para vídeos, opcional)'));
}

if (hasErrors) {
  console.log('');
  console.log(red('Corrija os erros acima e tente novamente.'));
  rl.close();
  process.exit(1);
}

console.log('');

// ============================================
// 2. Verificar .env existente
// ============================================

const envPath = '.env';
if (existsSync(envPath)) {
  const overwrite = await ask(yellow('⚠') + ' Arquivo .env já existe. Sobrescrever? [s/N]: ');
  if (overwrite.toLowerCase() !== 's') {
    console.log('');
    console.log('Setup cancelado. Seu .env foi mantido.');
    rl.close();
    process.exit(0);
  }
  console.log('');
}

// ============================================
// 3. LLM Provider
// ============================================

console.log(bold('--- LLM Provider ---'));
console.log('');

let provider = '';
while (!provider) {
  const choice = await ask('Provider: (1) OpenAI  (2) Anthropic  [1]: ');
  const val = choice.trim() || '1';
  if (val === '1') provider = 'openai';
  else if (val === '2') provider = 'anthropic';
  else console.log(red('  Opção inválida. Digite 1 ou 2.'));
}

let apiKey = '';
const keyPrefix = provider === 'openai' ? 'sk-' : 'sk-ant-';
while (!apiKey) {
  const key = await ask(`${provider === 'openai' ? 'OpenAI' : 'Anthropic'} API Key: `);
  const trimmed = key.trim();
  if (!trimmed) {
    console.log(red('  Chave não pode ser vazia.'));
    continue;
  }
  if (!trimmed.startsWith(keyPrefix)) {
    const proceed = await ask(yellow(`  Chave não começa com "${keyPrefix}". Continuar mesmo assim? [s/N]: `));
    if (proceed.toLowerCase() !== 's') continue;
  }
  apiKey = trimmed;
}

// Modelo
const defaultModels = {
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4.1-nano'],
  anthropic: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-4-5-20251001'],
};

const models = defaultModels[provider];
console.log('');
console.log('  Modelos disponíveis:');
models.forEach((m, i) => console.log(`  (${i + 1}) ${m}${i === 0 ? dim(' [padrão]') : ''}`));

let model = models[0];
const modelChoice = await ask(`  Modelo [1]: `);
const modelIdx = parseInt(modelChoice.trim()) - 1;
if (modelIdx >= 0 && modelIdx < models.length) {
  model = models[modelIdx];
}
console.log(green('  ✓') + ` Provider: ${provider} / ${model}`);

console.log('');

// ============================================
// 4. Bot
// ============================================

console.log(bold('--- Bot ---'));
console.log('');

const botName = (await ask(`Nome do bot [ResumoBot]: `)).trim() || 'ResumoBot';
const language = (await ask(`Idioma dos resumos [pt-BR]: `)).trim() || 'pt-BR';

console.log('');

// ============================================
// 5. Mídia
// ============================================

console.log(bold('--- Mídia ---'));
console.log('');

let mediaEnabled = true;
if (!hasFFmpeg) {
  const enableMedia = await ask('Habilitar processamento de mídia? (sem ffmpeg, vídeos não funcionam) [S/n]: ');
  mediaEnabled = enableMedia.trim().toLowerCase() !== 'n';
} else {
  const enableMedia = await ask('Habilitar processamento de mídia? [S/n]: ');
  mediaEnabled = enableMedia.trim().toLowerCase() !== 'n';
}

console.log('');

// ============================================
// 6. Dashboard
// ============================================

console.log(bold('--- Dashboard Admin ---'));
console.log('');

const enableDashboard = await ask('Habilitar dashboard admin? [S/n]: ');
const dashboardEnabled = enableDashboard.trim().toLowerCase() !== 'n';

let dashboardPort = '3000';
let dashboardToken = '';

if (dashboardEnabled) {
  dashboardPort = (await ask('  Porta do dashboard [3000]: ')).trim() || '3000';
  dashboardToken = randomBytes(24).toString('hex');
  console.log(green('  ✓') + ` Token gerado: ${dashboardToken}`);
}

console.log('');

// ============================================
// 6.5. Modo Conversacional
// ============================================

console.log(bold('--- Modo Conversacional ---'));
console.log('');
console.log(dim('  Permite que o bot responda perguntas livres via @menção no grupo.'));

const enableConversation = await ask('Habilitar modo conversacional? [s/N]: ');
const conversationEnabled = enableConversation.trim().toLowerCase() === 's';

let dmEnabled = false;
if (conversationEnabled) {
  const enableDm = await ask('  Habilitar conversas via DM (mensagem direta)? [s/N]: ');
  dmEnabled = enableDm.trim().toLowerCase() === 's';
}

console.log('');

// ============================================
// 7. Gerar .env
// ============================================

const envContent = `# ============================================
# WA-RESUMO-BOT — Configuração
# ============================================
# Gerado pelo setup wizard em ${new Date().toISOString()}

# --- LLM Provider ---
LLM_PROVIDER=${provider}

# --- OpenAI ---
${provider === 'openai' ? `OPENAI_API_KEY=${apiKey}` : 'OPENAI_API_KEY='}
OPENAI_MODEL=${provider === 'openai' ? model : 'gpt-4o-mini'}

# --- Anthropic (Claude) ---
${provider === 'anthropic' ? `ANTHROPIC_API_KEY=${apiKey}` : 'ANTHROPIC_API_KEY='}
ANTHROPIC_MODEL=${provider === 'anthropic' ? model : 'claude-sonnet-4-20250514'}

# --- Resumo ---
SUMMARY_MAX_MESSAGES=200
SUMMARY_LANGUAGE=${language}

# --- Bot ---
BOT_NAME=${botName}
COMMAND_PREFIX=/

# --- Mídia ---
MEDIA_PROCESSING_ENABLED=${mediaEnabled}
MEDIA_MAX_SIZE_MB=20

# --- Dashboard ---
DASHBOARD_ENABLED=${dashboardEnabled}
DASHBOARD_PORT=${dashboardPort}
DASHBOARD_TOKEN=${dashboardToken || 'change-me'}

# --- Modo Conversacional ---
CONVERSATION_ENABLED=${conversationEnabled}
CONVERSATION_DM_ENABLED=${dmEnabled}
CONVERSATION_MAX_TURNS=20
CONVERSATION_SESSION_TTL_MINUTES=30
CONVERSATION_TEMPERATURE=0.7
CONVERSATION_MAX_TOKENS=1000

# --- Logging ---
LOG_LEVEL=info
`;

writeFileSync(envPath, envContent);
console.log(green('✓') + ' Arquivo .env criado');

// ============================================
// 8. npm install (backend + dashboard)
// ============================================

if (!existsSync('node_modules')) {
  console.log('');
  console.log('Instalando dependências do backend...');
  try {
    execSync('npm install', { stdio: 'inherit' });
    console.log(green('✓') + ' Dependências do backend instaladas');
  } catch {
    console.log(red('✗') + ' Erro ao instalar dependências. Execute manualmente: npm install');
  }
}

if (dashboardEnabled && existsSync('dashboard-ui/package.json')) {
  console.log('');
  console.log('Instalando e compilando dashboard...');
  try {
    execSync('cd dashboard-ui && npm install', { stdio: 'inherit' });
    execSync('cd dashboard-ui && npm run build', { stdio: 'inherit' });
    console.log(green('✓') + ' Dashboard compilado');
  } catch {
    console.log(yellow('⚠') + ' Erro ao compilar dashboard. Execute manualmente: npm run dashboard:build');
  }
}

// ============================================
// 9. Resumo final
// ============================================

console.log('');
console.log(bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
console.log(green('✓ Setup completo!'));
console.log('');
console.log('  Próximos passos:');
console.log(`  1. ${bold('npm run dev')}       — Iniciar o bot`);
console.log('  2. Escaneie o QR Code com seu WhatsApp');
if (dashboardEnabled) {
  console.log(`  3. Dashboard: ${bold(`http://localhost:${dashboardPort}`)}`);
  console.log(`     Token: ${dim(dashboardToken)}`);
}
console.log('');
console.log(dim('  Documentação: https://github.com/vinicius1209/wa-resumo-bot'));
console.log(bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

rl.close();
