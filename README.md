# WA-Resumo-Bot

Bot de WhatsApp que monitora conversas de grupo e gera resumos fiéis usando LLMs (OpenAI / Anthropic). Inclui quiz, retro semanal, tracker de dívidas, detector de sentimento, curador de links e mais.

## Como funciona

1. O bot conecta ao WhatsApp Web via **Baileys** (sem custo, sem navegador)
2. Mensagens de grupo são armazenadas em **SQLite**
3. Quando alguém pede um resumo (`/resumo` ou `@ResumoBot`), o bot envia para a **LLM**
4. A LLM gera um resumo fiel — sem inventar, mantendo o tom da conversa
5. Mídias (imagens, áudios, vídeos) são descritas/transcritas e incluídas no resumo

## Quick Start

```bash
# 1. Clonar e instalar
git clone https://github.com/vinicius1209/wa-resumo-bot.git
cd wa-resumo-bot
npm install

# 2. Configurar (wizard interativo)
npm run setup

# 3. Rodar
npm run dev

# 4. Escaneie o QR Code no terminal com seu WhatsApp
```

> O wizard `npm run setup` verifica pré-requisitos, configura o LLM provider, gera o token do dashboard e cria o `.env` automaticamente. Para configuração manual, copie `.env.example` para `.env`.

> **Pré-requisitos**: Node.js 18+, `ffmpeg` instalado (para processamento de vídeos)

## Comandos

| Comando | Descrição | Exemplos |
|---------|-----------|----------|
| `/resumo` | Resumo de mensagens | `/resumo 2h`, `/resumo hoje`, `/resumo 50` |
| `/stats` | Métricas de uso e custo | `/stats`, `/stats custo` |
| `/retro` | Retrospectiva semanal com LLM | `/retro` |
| `/quiz` | Quiz "quem disse isso?" | `/quiz`, `/quiz ranking` |
| `/divida` | Tracker de dívidas entre membros | `/divida @pessoa 50` |
| `/links` | Links compartilhados no grupo | `/links`, `/links semana` |
| `/palavras` | Palavra do dia (últimos 7 dias) | `/palavras` |
| `/temperatura` | Termômetro de sentimento do grupo | `/temperatura` |
| `/persona` | Perfil de personalidade do grupo | `/persona` |
| `/compromissos` | Compromissos e lembretes | `/compromissos add reunião amanhã 15h` |
| `/meperdi` | Resumo desde sua última mensagem | `/meperdi` |
| `/ajuda` | Lista todos os comandos | `/ajuda` |

Todos os comandos também funcionam via menção: `@ResumoBot resumo 3h`

## Modo Conversacional

O bot suporta conversas multi-turn via @menção. Diferente dos comandos, o modo conversacional permite perguntas livres sobre o contexto do grupo.

```env
CONVERSATION_ENABLED=true
CONVERSATION_DM_ENABLED=false  # DMs opcionais
```

**Como funciona:**
1. Usuário menciona o bot sem comando: `@ResumoBot o que tão falando hoje?`
2. Bot injeta contexto do grupo (mensagens recentes + sentimento) como grounding
3. LLM responde com base apenas no contexto real
4. Sessões multi-turn duram 30min (configurável) — o bot lembra o que já foi conversado

**Controles:**
- Toggle `conversa` por grupo no dashboard
- Rate limiting separado (10 turns / 5min)
- Sessões persistem no SQLite (sobrevivem restart)

## Dashboard Admin

O bot inclui um dashboard web (React + Tailwind + shadcn/ui) para monitoramento e gestão em tempo real.

```env
DASHBOARD_ENABLED=true
DASHBOARD_PORT=3000
DASHBOARD_TOKEN=seu-token-aqui
```

**Páginas**:
- **Overview** — Status, gráficos de uso por hora, tabela de grupos, live feed
- **Chat** — Interface para executar comandos sem enviar ao WhatsApp
- **Conversas** — Viewer de sessões conversacionais (turns, contexto injetado, status)
- **Grupos** — Allow/block, feature toggles por grupo (incluindo `conversa`), notas
- **Config** — Editor de configurações dinâmicas

### Desenvolvimento do Dashboard

```bash
# Backend (terminal 1)
npm run dev

# Frontend com hot-reload (terminal 2)
npm run dashboard:dev

# Build para produção
npm run dashboard:build
```

## Configuração

Todas as variáveis via `.env` (veja `.env.example`):

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `LLM_PROVIDER` | `openai` | `openai` ou `anthropic` |
| `OPENAI_API_KEY` | — | Chave da API OpenAI |
| `OPENAI_MODEL` | `gpt-4o-mini` | Modelo OpenAI |
| `ANTHROPIC_API_KEY` | — | Chave da API Anthropic |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-20250514` | Modelo Anthropic |
| `SUMMARY_MAX_MESSAGES` | `200` | Mensagens padrão para resumo |
| `SUMMARY_LANGUAGE` | `pt-BR` | Idioma do resumo |
| `BOT_NAME` | `ResumoBot` | Nome para detecção de @menção |
| `COMMAND_PREFIX` | `/` | Prefixo de comandos |
| `RATE_LIMIT_MAX_REQUESTS` | `3` | Máx. requisições por janela |
| `RATE_LIMIT_WINDOW_SECONDS` | `300` | Janela de rate limit (segundos) |
| `MEDIA_PROCESSING_ENABLED` | `true` | Processar imagens/áudios/vídeos |
| `MEDIA_MAX_SIZE_MB` | `20` | Tamanho máximo de mídia |
| `DASHBOARD_ENABLED` | `false` | Habilitar dashboard admin |
| `DASHBOARD_PORT` | `3000` | Porta do dashboard |
| `DASHBOARD_TOKEN` | — | Token de autenticação do dashboard |
| `CONVERSATION_ENABLED` | `false` | Habilitar modo conversacional |
| `CONVERSATION_MAX_TURNS` | `20` | Máx. turns por sessão |
| `CONVERSATION_SESSION_TTL_MINUTES` | `30` | Expiração da sessão (min) |
| `CONVERSATION_DM_ENABLED` | `false` | Conversas via DM |
| `CONVERSATION_TEMPERATURE` | `0.7` | Temperatura LLM para conversas |
| `CONVERSATION_MAX_TOKENS` | `1000` | Máx. tokens por resposta |

## Arquitetura

```
src/
├── index.ts                  # Bootstrap e orquestração
├── types/                    # Interfaces e contratos
├── config/                   # Configuração centralizada (.env)
├── whatsapp/                 # Conexão Baileys + QR + reconexão
├── storage/                  # SQLite (WAL mode, auto-migrations)
├── llm/                      # OpenAI + Anthropic providers
├── commands/                 # 12 comandos (ICommand)
├── services/                 # 18 serviços (analytics, sentiment, quiz, etc.)
├── dashboard/                # Fastify server + WebSocket
│   ├── server.ts             # HTTP server com auth Bearer
│   ├── api.ts                # REST API (13 rotas)
│   ├── websocket.ts          # Real-time events
│   └── public/               # Build output (gerado pelo dashboard-ui)
dashboard-ui/                     # Frontend React (separado)
├── src/pages/                # 4 páginas (Overview, Chat, Groups, Settings)
├── src/components/           # shadcn/ui + componentes custom
└── vite.config.ts            # Build → src/dashboard/public/
```

### Design por interfaces

Todos os módulos dependem de contratos em `src/types/index.ts`:
- **IMessageStorage** — persistência de mensagens
- **ILLMProvider** — sumarização via LLM
- **IRateLimiter** — rate limiting por grupo
- **IMediaProcessor** — processamento de mídia (visão + transcrição)
- **ICommand** — comandos do bot

### Fluxo de mensagens

```
WhatsApp → Baileys → connection.ts (parse)
  → SQLiteStorage (persist)
  → DynamicConfig (allowlist check)
  → MediaProcessor (se mídia: describe/transcribe)
  → LinkService (detectar URLs)
  → SentimentService (alimentar heurísticas)
  → CatchupService (track atividade)
  → QuizService (verificar resposta)
  → CommandHandler (detectar /cmd ou @mention)
  → Service correspondente → reply
```

## Extensibilidade

### Novo comando

1. Crie `src/commands/meu-comando.ts` implementando `ICommand`
2. Exporte em `src/commands/index.ts`
3. Registre em `src/index.ts`

### Novo LLM provider

1. Implemente `ILLMProvider` em `src/llm/`
2. Registre em `provider-factory.ts`

### Novo storage

1. Implemente `IMessageStorage`
2. Substitua `SQLiteStorage` no `src/index.ts`

## Stack

- **Runtime**: Node.js + TypeScript (strict mode)
- **WhatsApp**: [Baileys](https://github.com/WhiskeySockets/Baileys) (conexão direta, zero custo)
- **Storage**: SQLite via better-sqlite3 (WAL mode)
- **LLMs**: OpenAI SDK + Anthropic SDK
- **Dashboard**: Fastify + WebSocket + React + Tailwind + shadcn/ui + Recharts
- **Logging**: Pino (structured logging)

## Proteções

- **Rate limit**: configurável por grupo (padrão: 3 requisições / 5 minutos)
- **Purge automático**: mensagens com +7 dias removidas diariamente
- **Reconexão**: automática se a conexão cair
- **Allowlist**: controle de grupos via dashboard
- **Feature toggles**: habilitar/desabilitar comandos por grupo
- **Mídia**: limite de tamanho configurável, processamento em memória

## Licença

[MIT](LICENSE)
