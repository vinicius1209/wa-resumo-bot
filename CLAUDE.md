# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WhatsApp group chat bot with LLMs (OpenAI or Anthropic Claude) via the Baileys library (direct WhatsApp Web connection, no paid API). Written in TypeScript with SQLite for persistence. Features: summarization, podcast-style audio summaries (Gemini TTS), weekly retro, quiz game, debt tracker, link curation, word of day, sentiment detection, group persona, commitment reminders, catch-up DM, conversational mode (multi-turn chat via @mention), and analytics.

## Commands

```bash
npm install          # Install dependencies
npm run dev:watch    # Development with file-watching (nodemon + ts-node)
npm run dev          # Run once via ts-node
npm run build        # Build dashboard + compile backend to dist/
npm start            # Run compiled output (requires build first)
npx tsc --noEmit     # Type-check backend without emitting
npm run setup        # Interactive setup wizard for first-time config
npm run dashboard:dev   # Vite dev server for dashboard (port 5173, proxies API to 3000)
npm run dashboard:build # Build React dashboard to src/dashboard/public/
```

There are no tests or linting configured.

## Architecture

### Interface-Driven Design

All modules depend on interfaces in `src/types/index.ts`:
- **IMessageStorage** — message persistence (implemented by SQLiteStorage)
- **ILLMProvider** — LLM summarization + chat (OpenAI and Anthropic implementations)
- **IRateLimiter** — rate limiting (sliding window, per-group, in-memory)
- **IMediaProcessor** — media processing (vision + audio transcription)
- **ICommand** — bot commands
- **ITTSProvider** — text-to-speech synthesis (Gemini and OpenAI implementations)

### Message Flow

WhatsApp message → `WhatsAppConnection` (parse) → `SQLiteStorage` (persist) → `CatchupService` (track activity) → `CommitmentService` (auto-detect dates) → `SentimentService` (feed heuristics) → `LinkService` (detect URLs) → `MediaProcessor` (if media) → `QuizService` (check answer) → `CommandHandler` (detect `/cmd` or `@mention`) → if command: Service → reply | if @mention without command + conversation enabled: `ConversationService` → multi-turn reply

### Bot Commands

| Command | Service | Description |
|---------|---------|-------------|
| `/resumo` | SummaryService | Group chat summary (time/count-based) |
| `/stats` | AnalyticsService | Usage metrics and cost tracking |
| `/palavras` | WordOfDayService | Word of day history |
| `/links` | LinkService | Curated group links by category |
| `/retro` | RetroService + StatsService | Fun weekly retrospective via LLM |
| `/divida` | DebtService | Debt tracking between members |
| `/quiz` | QuizService | "Who said this?" quiz game |
| `/compromissos` | CommitmentService | Group commitments and reminders (+ auto-detection) |
| `/temperatura` | SentimentService | Group sentiment/conflict gauge |
| `/persona` | PersonaService | Group personality profile via LLM |
| `/meperdi` | CatchupService | Catch-up summary since last activity |
| `/podcast` | PodcastService | Podcast-style audio summary (two AI hosts) |
| `/ajuda` | — | Lists all available commands |

### Key Modules

- **`src/index.ts`** — Bootstrap: init all services, register commands, connect WhatsApp, schedulers (rate limiter cleanup 10min, message purge 24h, word of day 23h, reminders 30min)
- **`src/whatsapp/connection.ts`** — Baileys socket, QR auth, auto-reconnect, message parsing. Group messages + optional DMs. Credentials in `auth_info/`
- **`src/storage/sqlite-storage.ts`** — SQLite WAL mode. Exposes `getDatabase()` for other services to share the connection. Auto-migrations via `ALTER TABLE`
- **`src/llm/`** — System prompt + message formatting in `base-prompt.ts`. Conversation prompt in `conversation-prompt.ts`. Podcast dialogue prompt in `podcast-prompt.ts`. OpenAI/Anthropic providers with `summarize()` (temp 0.3, 2000 tokens) and `chat()` (temp 0.7, 1000 tokens)
- **`src/tts/`** — TTS provider abstraction. Gemini TTS (multi-speaker, PCM→OGG Opus via ffmpeg) and OpenAI TTS (per-line synthesis + concat). Factory in `tts-factory.ts`
- **`src/services/podcast-service.ts`** — Orchestrates summary → podcast script → TTS audio. SHA-256 cache by message hash in SQLite (`podcast_cache` table, 15min TTL). Cleanup runs with other schedulers
- **`src/commands/command-handler.ts`** — Routes prefix commands and @mention commands. Returns `HandleResult` with `isBotMention` flag for conversational routing. Tracks command execution via AnalyticsService
- **`src/services/conversation-service.ts`** — Multi-turn conversation sessions keyed by (groupId, senderId). Context injection from recent messages + sentiment. SQLite persistence + in-memory cache. TTL-based session expiry
- **`src/services/analytics-service.ts`** — Fire-and-forget event tracking. Aggregation queries for daily/weekly usage, cost by model, performance metrics. Shared SQLite connection via `initTable(db)`

### SQLite Tables

| Table | Purpose |
|-------|---------|
| `messages` | Core message storage (with media_description) |
| `analytics_events` | Usage/cost/performance tracking |
| `word_of_day` | Daily word history per group |
| `links` | Curated URLs with title/category |
| `group_stats` | Weekly retro stats + narrative |
| `debts` | Debt records between members |
| `quiz_scores` | Quiz game leaderboard |
| `commitments` | Group commitments with reminders |
| `group_persona` | Cached group personality profile |
| `member_activity` | Last message timestamp per member |
| `conversation_sessions` | Multi-turn conversation sessions with turns + context |
| `bot_config` | Global key-value config (runtime, no restart) |
| `group_settings` | Per-group allowlist, feature toggles (`features_json`), notes |
| `podcast_cache` | Cached podcast audio blobs (OGG Opus) with message hash + TTL |

### Adding New Components

**New command**: implement `ICommand` in `src/commands/`, export in `commands/index.ts`, register in `src/index.ts` via `commandHandler.register()`

**New service with SQLite**: create in `src/services/`, add `initTable(db)` method, call it in `src/index.ts` with `storage.getDatabase()`

**New LLM provider**: implement `ILLMProvider` in `src/llm/`, register in `provider-factory.ts`

**New TTS provider**: implement `ITTSProvider` in `src/tts/`, register in `tts-factory.ts`

## Configuration

All config via `.env` (see `.env.example`). Key variables:
- `LLM_PROVIDER` — `"openai"` or `"anthropic"`
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` — LLM credentials
- `OPENAI_MODEL` / `ANTHROPIC_MODEL` — model selection
- `SUMMARY_MAX_MESSAGES` — default message count for summaries (200)
- `SUMMARY_LANGUAGE` — output language (default: `pt-BR`)
- `COMMAND_PREFIX` — command trigger (default: `/`)
- `BOT_NAME` — used for @mention detection
- `RATE_LIMIT_MAX_REQUESTS` / `RATE_LIMIT_WINDOW_SECONDS` — per-group rate limiting
- `MEDIA_PROCESSING_ENABLED` — enable media analysis (default: `true`)
- `MEDIA_MAX_SIZE_MB` — max file size for media processing (default: `20`)
- `DASHBOARD_ENABLED` — enable admin dashboard (default: `false`)
- `DASHBOARD_PORT` — dashboard HTTP port (default: `3000`)
- `DASHBOARD_TOKEN` — Bearer token for dashboard auth
- `CONVERSATION_ENABLED` — enable conversational mode via @mention (default: `false`)
- `CONVERSATION_MAX_TURNS` — max turns per session (default: `20`)
- `CONVERSATION_SESSION_TTL_MINUTES` — session expiry (default: `30`)
- `CONVERSATION_DM_ENABLED` — enable DM conversations (default: `false`)
- `SENTIMENT_AUTO_REACT` — enable auto-provocation when group heats up (default: `false`)
- `PODCAST_ENABLED` — enable podcast audio summaries via `/podcast` (default: `false`)
- `TTS_PROVIDER` — `"gemini"` or `"openai"` (default: `gemini`)
- `GOOGLE_TTS_API_KEY` — API key for Gemini TTS
- `PODCAST_HOST1_VOICE` / `PODCAST_HOST2_VOICE` — Gemini voice names (default: `Kore`/`Puck`)

## Feature Toggles

Two-layer system for controlling bot features: **global** (`.env`) and **per-group** (SQLite via dashboard).

### How it works

1. **Global toggles** (`.env`) — gate features at process level. If disabled globally, the feature is off for all groups regardless of per-group settings.
2. **Per-group toggles** (SQLite `group_settings.features_json`) — fine-grained control per group via the dashboard Groups page or API.

A feature is active only when **both layers allow it**. Runtime check pattern in `src/index.ts`:

```typescript
if (config.someFeature.enabled && dynamicConfig.isFeatureEnabled(groupId, 'featureName')) { ... }
```

### Default behavior

Per-group toggles default to **enabled** (`true`). A feature is only disabled when explicitly set to `false` in `features_json`. This means new features work immediately on all allowed groups without manual activation.

### Available features

| Feature | Per-group toggle | Global gate (`.env`) | Description |
|---------|-----------------|---------------------|-------------|
| `resumo` | Yes | — | Chat summary via `/resumo` |
| `quiz` | Yes | — | "Who said this?" quiz game |
| `retro` | Yes | — | Weekly retrospective |
| `links` | Yes | — | Link curation and `/links` command |
| `temperatura` | Yes | — | Sentiment gauge via `/temperatura` |
| `persona` | Yes | — | Group personality profile |
| `meperdi` | Yes | — | Catch-up summary |
| `compromissos` | Yes | — | Commitment reminders |
| `conversa` | Yes | `CONVERSATION_ENABLED` | Multi-turn chat via @mention |
| `palavras` | Yes | `WORD_OF_DAY_AUTO` | Automatic word of day at 23h |
| `treta` | Yes | `SENTIMENT_AUTO_REACT` | Auto-provocation via LLM when group heats up |
| `podcast` | Yes | `PODCAST_ENABLED` | Podcast-style audio summary via Gemini/OpenAI TTS |

### Storage

Per-group features are stored as JSON in `group_settings.features_json`:

```json
{"resumo": true, "treta": false, "conversa": true}
```

### Managing via Dashboard

**UI:** Groups page → expand group row → "Funcionalidades" section → toggle badges → "Salvar funcionalidades"

**API:**
```bash
# Enable/disable features for a group
PUT /api/groups/:id/features
Authorization: Bearer <DASHBOARD_TOKEN>
Content-Type: application/json

{"treta": true, "conversa": false}
```

### Auto-detection (passive features)

Some features run passively on every message without requiring a command:

| Feature | Trigger | What it does |
|---------|---------|--------------|
| `compromissos` | Message contains date pattern (e.g. "dia 21", "sexta 20h") | Auto-registers commitment and confirms in group. Skips messages starting with command prefix to avoid duplicating explicit `/compromissos add`. |
| `treta` | Sentiment score reaches "Esquentando" (>= 9) | Sends provocative LLM-generated reaction. Requires `SENTIMENT_AUTO_REACT=true`. |
| `palavras` | Daily scheduler at 23h | Sends word of day. Requires `WORD_OF_DAY_AUTO=true`. |

Auto-detection runs fire-and-forget (non-blocking) in the message handler (`src/index.ts`).

### Adding a new feature toggle

1. Add the feature name to `FEATURES` array in `dashboard-ui/src/components/dashboard/GroupsTable.tsx`
2. Check it at runtime with `dynamicConfig.isFeatureEnabled(groupId, 'featureName')`
3. If the feature needs a global gate, add the `.env` variable to `src/config/index.ts` and `src/types/index.ts` (`AppConfig`)
4. Document the feature in the table above

Key files:
- **`src/services/dynamic-config-service.ts`** — `isFeatureEnabled()`, `setFeatureEnabled()`, SQLite persistence
- **`dashboard-ui/src/components/dashboard/GroupsTable.tsx`** — UI feature list (`FEATURES` array)
- **`src/dashboard/api.ts`** — `PUT /api/groups/:id/features` endpoint

## Dashboard

Admin dashboard runs in the same process via Fastify. Serves REST API (`/api/*`), WebSocket (`/ws`), and static frontend (`/`).

- **`src/dashboard/server.ts`** — Fastify setup, Bearer token auth, static file serving
- **`src/dashboard/api.ts`** — 15 REST routes (status, analytics, groups CRUD, config, conversations viewer)
- **`src/dashboard/websocket.ts`** — Real-time event broadcast via EventBus
- **`src/services/event-bus.ts`** — Singleton EventEmitter for message/command/media/sentiment/llm/conversation/error events
- **`src/services/dynamic-config-service.ts`** — Runtime config (SQLite: `bot_config` + `group_settings` tables). Group allowlist, feature toggles, auto-registration on first message
- **`dashboard-ui/`** — React + Tailwind + shadcn/ui frontend. 6 pages: Overview, Chat, Conversations, Groups, Settings. Builds to `src/dashboard/public/`
