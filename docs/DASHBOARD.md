# WA-RESUMO-BOT — Dashboard Admin

Plano para dashboard de monitoramento e gerenciamento em tempo real do bot.

**Motivação:** O bot roda headless sem visibilidade além de logs no terminal. Não há como alterar configurações sem reiniciar, nem como monitorar custo, uso e saúde em tempo real.

---

## Arquitetura

O dashboard roda **no mesmo processo** do bot — sem infra adicional. Um servidor HTTP leve serve a API REST, WebSocket e o frontend estático.

```
Bot Process
├── WhatsApp Connection (Baileys)
├── Services (SQLite, LLM, etc.)
├── Dashboard Server (Fastify)
│   ├── REST API (/api/*)
│   ├── WebSocket (/ws)
│   └── Static Frontend (/)
└── Auth (Bearer token)
```

**Stack:** Fastify + fastify-websocket + HTML/CSS/JS vanilla (zero framework frontend)

**Auth:** Token simples via `DASHBOARD_TOKEN` no `.env`. Sem login complexo — é um admin panel pessoal.

---

## Fase 1: Config dinâmica + API REST

### Schema SQLite

```sql
CREATE TABLE IF NOT EXISTS bot_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS group_settings (
  group_id TEXT PRIMARY KEY,
  group_name TEXT,
  allowed INTEGER DEFAULT 1,         -- 0=bloqueado, 1=permitido
  features_json TEXT,                 -- {"resumo":true,"quiz":false,...}
  custom_rate_limit INTEGER,          -- override do rate limit global
  notes TEXT,                         -- anotações do admin
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);
```

### Serviço de Config Dinâmica

**Arquivo:** `src/services/dynamic-config-service.ts`

```typescript
class DynamicConfigService {
  initTable(db): void;

  // Bot config (key-value global)
  get(key: string): string | null;
  set(key: string, value: string): void;
  getAll(): Record<string, string>;

  // Group settings
  isGroupAllowed(groupId: string): boolean;
  setGroupAllowed(groupId: string, allowed: boolean): void;
  getGroupSettings(groupId: string): GroupSettings | null;
  updateGroupSettings(groupId: string, settings: Partial<GroupSettings>): void;
  getAllGroups(): GroupSettings[];
  isFeatureEnabled(groupId: string, feature: string): boolean;
}
```

### Integração no bot

O `connection.ts` consulta `dynamicConfig.isGroupAllowed(groupId)` antes de processar mensagens. Se `allowed=0`, ignora silenciosamente.

O `command-handler.ts` consulta `dynamicConfig.isFeatureEnabled(groupId, commandName)` antes de executar. Se desabilitado, responde "Este comando está desativado neste grupo."

### API REST

**Arquivo:** `src/dashboard/api.ts`

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/status` | Bot online, uptime, grupos conectados, versão |
| `GET` | `/api/analytics/daily` | Métricas do dia (reusa AnalyticsService) |
| `GET` | `/api/analytics/weekly` | Métricas da semana |
| `GET` | `/api/analytics/cost` | Breakdown de custo por modelo |
| `GET` | `/api/groups` | Lista todos os grupos com settings |
| `GET` | `/api/groups/:id` | Detalhes de um grupo (msgs, stats, config) |
| `PUT` | `/api/groups/:id` | Atualizar settings de um grupo |
| `PUT` | `/api/groups/:id/allow` | Permitir grupo |
| `PUT` | `/api/groups/:id/block` | Bloquear grupo |
| `PUT` | `/api/groups/:id/features` | Toggle features por grupo |
| `GET` | `/api/config` | Config dinâmica global |
| `PUT` | `/api/config` | Atualizar config sem reiniciar |

Auth: header `Authorization: Bearer <DASHBOARD_TOKEN>` em todas as rotas.

**Arquivos:**
- `src/dashboard/server.ts` — Fastify setup, auth middleware, static files
- `src/dashboard/api.ts` — Rotas REST
- `src/services/dynamic-config-service.ts` — Config dinâmica no SQLite

---

## Fase 2: WebSocket (real-time)

**Arquivo:** `src/dashboard/websocket.ts`

### Event Bus

Um EventEmitter central (`src/services/event-bus.ts`) que todos os serviços emitem para:

```typescript
class EventBus extends EventEmitter {
  emitMessage(groupId, senderName, content, type);
  emitCommand(groupId, senderName, command, durationMs, success);
  emitMedia(groupId, type, durationMs);
  emitSentiment(groupId, score, label);
  emitError(service, message);
  emitLLMCall(provider, model, tokens, cost, durationMs);
}
```

### WebSocket protocol

Client conecta em `ws://host:port/ws?token=DASHBOARD_TOKEN`

Mensagens do servidor (JSON):
```json
{"type": "message",  "data": {"group": "Familia", "sender": "João", "content": "bom dia", "time": "14:30"}}
{"type": "command",  "data": {"group": "Familia", "sender": "João", "command": "resumo", "duration": 2300, "success": true}}
{"type": "media",    "data": {"group": "Amigos", "mediaType": "image", "duration": 1200}}
{"type": "sentiment","data": {"group": "Trabalho", "score": 12, "label": "😤 Esquentando"}}
{"type": "cost",     "data": {"today": 0.08, "week": 0.52}}
{"type": "error",    "data": {"service": "llm", "message": "timeout"}}
```

**Arquivos:**
- `src/dashboard/websocket.ts` — WebSocket handler
- `src/services/event-bus.ts` — EventEmitter centralizado

---

## Fase 3: Frontend (SPA leve)

**Diretório:** `src/dashboard/public/`

### Páginas

1. **Overview** (`/`)
   - Status do bot (online/offline, uptime)
   - Métricas do dia: comandos, mídias, tokens, custo
   - Gráfico de uso por hora (últimas 24h)
   - Grupos ativos com temperatura em tempo real

2. **Grupos** (`/groups`)
   - Lista de grupos com toggle allow/block
   - Feature toggles por grupo (checkboxes)
   - Stats por grupo: msgs/dia, comandos, custo
   - Campo de notas/nickname

3. **Live Feed** (`/live`)
   - Stream em tempo real de eventos (WebSocket)
   - Filtro por grupo, tipo de evento
   - Busca

4. **Custo** (`/cost`)
   - Gráfico de custo diário (últimos 30 dias)
   - Breakdown por modelo/provider
   - Projeção de custo mensal

5. **Config** (`/config`)
   - Edição de configs dinâmicas (rate limit, max messages, etc.)
   - Sem necessidade de reiniciar o bot

### Stack frontend

- HTML + CSS (sem framework — vanilla)
- Chart.js para gráficos
- WebSocket nativo para real-time
- Fetch API para REST calls
- CSS Grid/Flexbox para layout responsivo

### Segurança

- Token via cookie httpOnly após login simples
- CORS restrito a localhost
- Rate limit na API (evitar brute force no token)

---

## Configuração (.env)

```env
# --- Dashboard ---
DASHBOARD_ENABLED=true
DASHBOARD_PORT=3000
DASHBOARD_TOKEN=seu-token-secreto-aqui
```

---

## Dependências novas

```bash
npm install fastify @fastify/websocket @fastify/static @fastify/cors
```

---

## Arquivos a criar

| Arquivo | Descrição |
|---------|-----------|
| `src/dashboard/server.ts` | Fastify setup, auth, static files |
| `src/dashboard/api.ts` | Rotas REST |
| `src/dashboard/websocket.ts` | WebSocket handler |
| `src/dashboard/public/index.html` | Frontend — overview |
| `src/dashboard/public/groups.html` | Frontend — gestão de grupos |
| `src/dashboard/public/live.html` | Frontend — live feed |
| `src/dashboard/public/cost.html` | Frontend — custo |
| `src/dashboard/public/config.html` | Frontend — config dinâmica |
| `src/dashboard/public/app.js` | JS compartilhado (auth, websocket, charts) |
| `src/dashboard/public/style.css` | CSS compartilhado |
| `src/services/dynamic-config-service.ts` | Config dinâmica no SQLite |
| `src/services/event-bus.ts` | EventEmitter centralizado |

---

## Ordem de implementação

| Fase | O que | Impacto |
|------|-------|---------|
| 1 | Config dinâmica + API REST + allowlist | Alto — resolve o problema de gestão |
| 2 | WebSocket + Event Bus | Médio — habilita real-time |
| 3 | Frontend visual | Alto — dá visibilidade total |

Fases são incrementais: cada uma funciona independente. A Fase 1 sozinha já resolve o allowlist via `curl` ou Postman.

---

## Agents especialistas

### Agent Dashboard-1: Backend Engineer

```
Implemente a Fase 1 do dashboard admin.

Crie:
1. src/services/dynamic-config-service.ts — Config dinâmica no SQLite
2. src/dashboard/server.ts — Fastify server com auth middleware
3. src/dashboard/api.ts — Rotas REST (status, analytics, groups, config)

Integre:
- No index.ts: iniciar o dashboard server após conectar ao WhatsApp
- No connection.ts: verificar isGroupAllowed antes de processar mensagens
- No command-handler.ts: verificar isFeatureEnabled antes de executar

Leia os services existentes (analytics-service, sentiment-service) para
reusar dados. Não duplique lógica — chame os services.

Config via .env: DASHBOARD_ENABLED, DASHBOARD_PORT, DASHBOARD_TOKEN
```

### Agent Dashboard-2: Real-time Engineer

```
Implemente a Fase 2 do dashboard (WebSocket + Event Bus).

Crie:
1. src/services/event-bus.ts — EventEmitter centralizado
2. src/dashboard/websocket.ts — WebSocket handler com auth

Integre o event-bus nos services existentes:
- command-handler.ts: emit após cada comando
- summary-service.ts: emit após cada resumo
- media-processor.ts: emit após cada mídia
- sentiment-service.ts: emit a cada análise

Protocolo: JSON com type + data. Ver DASHBOARD.md Fase 2.
```

### Agent Dashboard-3: Frontend Developer

```
Implemente a Fase 3 do dashboard (frontend visual).

Crie os arquivos em src/dashboard/public/:
- index.html, groups.html, live.html, cost.html, config.html
- app.js (auth, websocket, fetch helpers, chart setup)
- style.css (dark theme, responsivo, CSS Grid)

Use Chart.js via CDN. WebSocket nativo. Fetch API.
Visual: dark theme, cards com métricas, gráficos limpos.
Sem framework — vanilla HTML/CSS/JS.
```
