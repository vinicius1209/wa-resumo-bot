# WA-RESUMO-BOT — Roadmap de Evolução

Documento de planejamento para evolução do bot. Cada feature é um módulo independente que pode ser desenvolvido por um agent especialista. Todas seguem o padrão existente: implementar `ICommand`, registrar no `CommandHandler`, e reutilizar `IMessageStorage` + `ILLMProvider`.

---

## Arquitetura atual (base para todas as features)

```
WhatsApp → Connection → Storage (SQLite) → CommandHandler → Services → LLM → Reply
```

**Contratos reutilizáveis:**
- `ICommand` — qualquer feature que responde a um comando
- `IMessageStorage` — acesso ao histórico de mensagens
- `ILLMProvider` — chamadas ao LLM (resumo, análise, geração)
- `IMediaProcessor` — processamento de mídia (visão, transcrição)

**Padrão para adicionar feature:**
1. Criar service em `src/services/`
2. Criar command em `src/commands/`
3. Registrar no `src/index.ts`
4. Se precisar de dados persistentes, adicionar tabela/coluna no SQLite

---

## Feature 1: Retrospectiva semanal automática

**Comando:** `/retro` (manual) + envio automático domingo à noite

**O que faz:**
- Analisa todas as mensagens da semana no grupo
- Gera estatísticas: total de mensagens, mídias, mensagens por pessoa, horários de pico
- Usa LLM para gerar um "Wrapped" narrativo e divertido do grupo
- Rankings: quem mais falou, rei do áudio, rei do meme, coruja (quem manda msg de madrugada)

**Schema novo:**
```sql
CREATE TABLE group_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  stats_json TEXT NOT NULL,  -- JSON com todas as métricas
  narrative TEXT,            -- texto gerado pelo LLM
  created_at INTEGER DEFAULT (unixepoch())
);
```

**Arquivos:**
- `src/services/stats-service.ts` — coleta e calcula métricas do grupo
- `src/services/retro-service.ts` — gera narrativa com LLM a partir das métricas
- `src/commands/retro-command.ts` — `/retro` e `/retro semana`
- `src/schedulers/weekly-retro.ts` — cron job para envio automático

**Agent especialista:** Analista de dados + copywriter. Foco em queries SQL eficientes e prompts que gerem texto divertido.

**Dependências:** Nenhuma feature anterior necessária.

**Complexidade:** Média

---

## Feature 2: Detector de treta (análise de sentimento)

**Comando:** `/temperatura` (manual) + detecção automática

**O que faz:**
- Monitora sentimento das últimas N mensagens em tempo real
- Quando detecta escalada de tensão (muitas msgs rápidas + palavras fortes), envia alerta
- `/temperatura` mostra o humor atual do grupo com emoji termômetro
- Pode gerar resumo imparcial dos dois lados quando há discussão

**Lógica de detecção (sem LLM, para ser barato):**
- Velocidade de mensagens (>10 msgs/min entre 2 pessoas = possível treta)
- Palavras em CAPS LOCK
- Excesso de pontuação (!!!, ???)
- Palavras-chave negativas (lista configurável)
- Score composto → se passar threshold → chama LLM para análise mais fina

**Arquivos:**
- `src/services/sentiment-service.ts` — scoring de sentimento baseado em heurísticas
- `src/services/debate-service.ts` — resumo imparcial via LLM quando há conflito
- `src/commands/temperatura-command.ts` — `/temperatura`

**Agent especialista:** NLP/sentiment analysis. Foco em heurísticas eficientes (sem chamar LLM a cada mensagem) e prompts neutros para mediação.

**Dependências:** Nenhuma feature anterior necessária.

**Complexidade:** Média-Alta (a detecção automática precisa ser calibrada para evitar falsos positivos)

---

## Feature 3: "Quem disse isso?" (quiz game)

**Comando:** `/quiz`

**O que faz:**
- Pega uma mensagem engraçada/marcante do histórico do grupo
- Anonimiza o remetente e apresenta como quiz
- Membros respondem com número (1, 2, 3, 4) correspondente ao nome
- Bot revela resposta após 30s ou quando alguém acertar
- Mantém placar por grupo

**Schema novo:**
```sql
CREATE TABLE quiz_scores (
  group_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  points INTEGER DEFAULT 0,
  games_played INTEGER DEFAULT 0,
  PRIMARY KEY (group_id, sender_id)
);
```

**Fluxo:**
1. `/quiz` → bot seleciona mensagem interessante (LLM filtra as mais engraçadas/marcantes)
2. Bot envia: "Quem disse: '_mensagem aqui_'?\n1. João\n2. Maria\n3. Pedro\n4. Ana"
3. Bot escuta respostas por 30s
4. Revela resposta + atualiza placar
5. `/ranking` mostra placar geral

**Arquivos:**
- `src/services/quiz-service.ts` — seleção de mensagens, gerenciamento de rodada, placar
- `src/commands/quiz-command.ts` — `/quiz`, `/ranking`

**Desafios:**
- Gerenciar estado de uma rodada ativa (timeout, respostas)
- Selecionar mensagens que façam sentido como quiz (não muito óbvias, não muito genéricas)
- Evitar repetir mensagens já usadas

**Agent especialista:** Game designer. Foco em experiência de jogo fluida e seleção inteligente de mensagens.

**Dependências:** Nenhuma feature anterior necessária.

**Complexidade:** Média-Alta (gerenciamento de estado da rodada)

---

## Feature 4: Extrator de compromissos e lembretes

**Comando:** `/compromissos` + detecção automática

**O que faz:**
- Detecta automaticamente quando alguém menciona data/hora/evento na conversa
- Exemplos: "vamos sexta às 20h", "prazo até terça", "reunião amanhã 10h"
- Salva como compromisso do grupo
- Envia lembrete automático X horas antes
- `/compromissos` lista os próximos eventos

**Schema novo:**
```sql
CREATE TABLE commitments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  description TEXT NOT NULL,
  event_date INTEGER,           -- timestamp do evento
  reminder_sent INTEGER DEFAULT 0,
  created_by TEXT NOT NULL,     -- sender_id de quem mencionou
  source_message_id TEXT,       -- mensagem original
  created_at INTEGER DEFAULT (unixepoch())
);
```

**Lógica de detecção:**
- Regex para padrões de data/hora em pt-BR (amanhã, sexta, dia 15, às 20h)
- LLM para extrair evento + data estruturada quando regex dá match
- Confirmação: bot pergunta "Detectei um compromisso: X no dia Y. Salvo? (sim/não)"

**Arquivos:**
- `src/services/commitment-service.ts` — detecção, parse de datas, CRUD
- `src/commands/compromissos-command.ts` — `/compromissos`, `/compromissos limpar`
- `src/schedulers/reminder-scheduler.ts` — verifica e envia lembretes

**Agent especialista:** Parser de linguagem natural para datas em pt-BR. Foco em extrair datas de texto informal ("semana que vem", "depois do carnaval").

**Dependências:** Nenhuma feature anterior necessária.

**Complexidade:** Alta (parsing de datas em linguagem natural é notoriamente difícil)

---

## Feature 5: "Tá devendo" (controle de dívidas)

**Comando:** `/divida`, `/dividas`

**O que faz:**
- Registra dívidas entre membros do grupo
- Detecção automática: "te pago amanhã", "racha o Uber", "me deve 50"
- Registro manual: `/divida @João 50 pizza`
- `/dividas` mostra saldo de cada pessoa
- `/divida pagar @João 50` quita parcial/total

**Schema novo:**
```sql
CREATE TABLE debts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  debtor_id TEXT NOT NULL,     -- quem deve
  debtor_name TEXT NOT NULL,
  creditor_id TEXT NOT NULL,   -- quem emprestou
  creditor_name TEXT NOT NULL,
  amount REAL NOT NULL,
  description TEXT,
  settled INTEGER DEFAULT 0,   -- 0=pendente, 1=pago
  source_message_id TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);
```

**Arquivos:**
- `src/services/debt-service.ts` — CRUD de dívidas, cálculo de saldo líquido, simplificação (A deve B, B deve C → A deve C)
- `src/commands/divida-command.ts` — `/divida`, `/dividas`, `/divida pagar`

**Agent especialista:** Fintech/contabilidade. Foco em simplificação de dívidas circulares e UX clara para exibir saldos.

**Dependências:** Nenhuma feature anterior necessária.

**Complexidade:** Média

---

## Feature 6: Curador de links

**Comando:** `/links`

**O que faz:**
- Detecta automaticamente URLs compartilhadas no grupo
- Categoriza (vídeo, notícia, receita, ferramenta, etc.) via LLM
- `/links` mostra os últimos links organizados por categoria
- `/links semana` filtra por período
- Opcionalmente gera preview (título da página)

**Schema novo:**
```sql
CREATE TABLE links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,                -- título da página (fetch)
  category TEXT,             -- categoria (LLM)
  shared_by_id TEXT NOT NULL,
  shared_by_name TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  source_message_id TEXT
);
```

**Arquivos:**
- `src/services/link-service.ts` — detecção de URLs, fetch de título, categorização via LLM
- `src/commands/links-command.ts` — `/links`, `/links semana`, `/links videos`

**Agent especialista:** Web scraping + categorização. Foco em extração de título de páginas e categorização eficiente.

**Dependências:** Nenhuma feature anterior necessária.

**Complexidade:** Baixa-Média

---

## Feature 7: Palavra do dia

**Envio automático** todo dia às 23h

**O que faz:**
- Analisa todas as mensagens do dia
- Identifica a palavra/expressão mais usada (excluindo stop words)
- Gera um post divertido: "🏆 Palavra do dia: *churrasco* (mencionada 23 vezes por 5 pessoas)"
- Histórico: `/palavras` mostra as últimas 7 palavras do dia

**Arquivos:**
- `src/services/word-of-day-service.ts` — contagem de palavras, stop words pt-BR, seleção
- `src/schedulers/word-of-day-scheduler.ts` — cron diário

**Agent especialista:** Processamento de texto. Foco em stop words pt-BR e tokenização de gírias/expressões compostas.

**Dependências:** Nenhuma feature anterior necessária.

**Complexidade:** Baixa

---

## Feature 8: Persona do grupo

**Comando:** `/persona` ou menção direta ao bot com pergunta

**O que faz:**
- Analisa o histórico do grupo para aprender gírias, piadas internas, tom, assuntos recorrentes
- Quando alguém pergunta algo ao bot, ele responde no "jeito" do grupo
- Exemplo: em vez de "O tempo está ensolarado", responde "parça, tá um solzão da peste 🔥"
- `/persona` mostra o perfil do grupo (gírias mais usadas, tom, assuntos favoritos)

**Implementação em 3 camadas:**

### Camada 1: Análise estatística (sem LLM, barato)

Roda periodicamente sobre o histórico do grupo:
- **Gírias e expressões** — palavras/bigramas mais frequentes que NÃO estão num dicionário padrão pt-BR (ex: "parça", "bora", "tmj")
- **Emojis favoritos** — top 5 emojis do grupo
- **Tom** — tamanho médio de mensagem (curtas=casual, longas=reflexivo), proporção de CAPS, pontuação
- **Horários** — quando o grupo é mais ativo
- **Assuntos recorrentes** — palavras-chave temáticas (futebol, trabalho, games, comida)

### Camada 2: Destilação via LLM (roda 1x por dia)

Pega ~100 mensagens representativas e pede ao LLM:
```
Analise estas mensagens e extraia:
1. Gírias e expressões próprias do grupo
2. Tom predominante (formal, informal, sarcástico, zoeiro...)
3. Piadas internas ou referências recorrentes
4. Assuntos que o grupo mais discute
5. Como eles se cumprimentam e se despedem
6. Nível de uso de emojis e figurinhas
Retorne como JSON estruturado.
```

Resultado exemplo:
```json
{
  "tom": "zoeiro e informal, muito sarcasmo",
  "girias": ["parça", "bora", "tá suave", "cria", "dale"],
  "piadas_internas": ["o Bruno sempre atrasa", "pizza de calabresa do Rafa"],
  "assuntos": ["futebol", "churrasco", "trabalho", "memes"],
  "cumprimento": "geralmente 'e aí' ou 'fala rapaziada'",
  "emojis_favoritos": ["🔥", "💀", "😂"],
  "estilo_resposta": "frases curtas, muitos kkkkk, respostas rápidas"
}
```

### Camada 3: System prompt dinâmico

Quando alguém interage com o bot, o persona JSON vira contexto:
```
Você é um membro do grupo. Responda como se fosse parte dele.

Estilo: zoeiro e informal, muito sarcasmo
Gírias que você usa: parça, bora, tá suave, cria, dale
Cumprimento típico: "e aí" ou "fala rapaziada"
Emojis que você usa: 🔥 💀 😂
Tom: frases curtas, muitos kkkkk

IMPORTANTE: não force as gírias. Use naturalmente, como alguém
do grupo faria. Não exagere.
```

**O truque é o cache:** o perfil roda 1x/dia (ou via `/persona atualizar`) e fica no SQLite. Só uma chamada LLM por dia por grupo.

**Schema novo:**
```sql
CREATE TABLE group_persona (
  group_id TEXT PRIMARY KEY,
  stats_json TEXT,              -- métricas da camada 1 (estatística)
  persona_json TEXT NOT NULL,   -- perfil da camada 2 (LLM)
  sample_messages TEXT,         -- amostra de mensagens usadas na análise
  updated_at INTEGER DEFAULT (unixepoch())
);
```

**Arquivos:**
- `src/services/persona-stats.ts` — camada 1: análise estatística (frequência de palavras, emojis, horários)
- `src/services/persona-service.ts` — camada 2+3: destilação via LLM, cache, construção de system prompt dinâmico
- `src/commands/persona-command.ts` — `/persona`, `/persona atualizar`

**Agent especialista:** Prompt engineer + analista de texto. Foco em: stop words pt-BR, tokenização de gírias, construção de system prompts que soem naturais sem forçar.

**Dependências:** Nenhuma, mas se beneficia de bastante histórico no storage.

**Complexidade:** Alta (qualidade depende do prompt engineering e da análise estatística)

---

## Feature 9: Resumo para quem chegou tarde (DM)

**Detecção automática** + comando `/meperdi`

**O que faz:**
- Detecta quando um membro ficou inativo por X horas e depois manda mensagem
- Envia resumo personalizado por mensagem privada (DM)
- `/meperdi` no grupo → bot manda DM com resumo desde a última mensagem da pessoa
- Resumo foca no que é relevante para aquela pessoa (menções ao nome, assuntos que ela participa)

**Lógica:**
- Rastrear `last_seen` por membro por grupo
- Se `now - last_seen > 4h` e pessoa manda msg → oferecer resumo
- Bot: "Oi @fulano! Rolou bastante coisa enquanto você tava fora. Quer um resumo? (sim/não)"

**Schema novo:**
```sql
CREATE TABLE member_activity (
  group_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  last_message_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, sender_id)
);
```

**Arquivos:**
- `src/services/catchup-service.ts` — tracking de atividade, geração de resumo personalizado
- `src/commands/meperdi-command.ts` — `/meperdi`

**Agent especialista:** UX conversacional. Foco em decidir quando oferecer o resumo sem ser intrusivo.

**Dependências:** Feature 1 (resumo) já existe. Esta feature estende.

**Complexidade:** Média (enviar DM + rastrear atividade)

---

## Feature 10: Analytics e métricas de uso

**Comando:** `/stats` (admin) + dashboard opcional

**Contexto:** O projeto usa Pino para logging operacional (erros, conexão), mas não rastreia métricas de uso. Sem analytics, não há como saber o custo real do bot, quais features são mais usadas, ou se a qualidade está caindo.

**O que rastreia:**

### Métricas de uso
- Comandos executados (qual, por quem, em qual grupo, quando)
- Resumos gerados por dia/semana/grupo
- Taxa de sucesso vs. erro por comando
- Mídias processadas por tipo (imagem, áudio, vídeo)

### Métricas de performance
- Tempo de resposta do LLM (latência P50, P95)
- Tempo de processamento de mídia (download + visão/whisper)
- Tempo total de resposta ao usuário (do comando ao reply)

### Métricas de custo
- Tokens consumidos por chamada (input + output)
- Custo estimado por chamada (tokens × preço do modelo)
- Custo acumulado por dia/semana/grupo
- Custo por feature (resumo vs. visão vs. whisper)

### Métricas de engajamento
- Grupos ativos por dia
- Membros únicos que usam comandos
- Horários de pico de uso
- Retenção: grupos que param de usar

**Schema novo:**
```sql
CREATE TABLE analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,       -- 'command', 'llm_call', 'media_process', 'error'
  group_id TEXT,
  sender_id TEXT,
  command_name TEXT,              -- 'resumo', 'ajuda', etc.
  provider TEXT,                  -- 'openai', 'anthropic'
  model TEXT,
  tokens_input INTEGER,
  tokens_output INTEGER,
  estimated_cost_usd REAL,
  duration_ms INTEGER,            -- tempo de execução
  success INTEGER DEFAULT 1,     -- 1=sucesso, 0=erro
  error_message TEXT,
  metadata_json TEXT,             -- dados extras flexíveis
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX idx_analytics_type_date ON analytics_events(event_type, created_at);
CREATE INDEX idx_analytics_group ON analytics_events(group_id, created_at);
```

**Implementação:**

### Camada 1: Collector (tracking passivo)
Serviço leve que registra eventos no SQLite. Todas as features chamam o collector:
```typescript
analytics.track({
  eventType: 'command',
  groupId, senderId,
  commandName: 'resumo',
  provider: 'openai', model: 'gpt-4o-mini',
  tokensInput: 450, tokensOutput: 127,
  estimatedCostUsd: 0.0023,
  durationMs: 3200,
  success: true,
});
```

### Camada 2: Aggregator (relatórios)
Queries SQL pré-definidas para gerar relatórios:
- `getDailyUsage(groupId)` — resumo do dia
- `getWeeklyCost()` — custo total da semana por provider
- `getTopCommands(period)` — ranking de comandos
- `getPerformanceMetrics(period)` — latência média/P95
- `getGroupActivity(period)` — grupos mais ativos

### Camada 3: Comando `/stats`
```
📊 *Estatísticas do bot*

Hoje:
  Comandos: 23 (18 resumos, 3 quiz, 2 ajuda)
  Mídias processadas: 7 (4 img, 2 áudio, 1 vídeo)
  Tokens: 12.450 (custo: ~$0.08)
  Tempo médio: 2.3s

Semana:
  Grupos ativos: 5
  Total de comandos: 142
  Custo total: ~$0.52
```

### Tabela de preços (configurável)
```typescript
const PRICING = {
  'gpt-4o-mini': { input: 0.15 / 1_000_000, output: 0.60 / 1_000_000 },
  'gpt-4o': { input: 2.50 / 1_000_000, output: 10.00 / 1_000_000 },
  'claude-sonnet-4-20250514': { input: 3.00 / 1_000_000, output: 15.00 / 1_000_000 },
  'whisper-1': { perMinute: 0.006 },
};
```

**Arquivos:**
- `src/services/analytics-service.ts` — collector + aggregator, tracking de eventos, queries de relatório
- `src/commands/stats-command.ts` — `/stats`, `/stats semana`, `/stats custo`

**Integração com features existentes:**
- `summary-service.ts` → track após cada resumo (tokens, duração, sucesso)
- `media-processor.ts` → track após cada mídia (tipo, duração, sucesso)
- `command-handler.ts` → track cada comando executado
- Todas as features futuras chamam `analytics.track()` no mesmo padrão

**Agent especialista:** Data engineering. Foco em schema eficiente, queries de agregação SQL, e cálculo de custo por modelo.

**Dependências:** Nenhuma. Deve ser implementada cedo para coletar dados desde o início.

**Complexidade:** Média (collector simples, a complexidade está nas queries de agregação)

---

## Ordem de implementação sugerida

Prioridade baseada em impacto vs. complexidade:

| Fase | Feature | Impacto | Complexidade | Status |
|------|---------|---------|--------------|--------|
| 0 | Analytics e métricas | Alto | Média | ✅ Implementado |
| 1 | Palavra do dia | Alto | Baixa | ✅ Implementado |
| 1 | Curador de links | Médio | Baixa | ✅ Implementado |
| 2 | Retrospectiva semanal | Alto | Média | ✅ Implementado |
| 2 | "Tá devendo" | Alto | Média | ✅ Implementado |
| 3 | Quiz "Quem disse isso?" | Alto | Média-Alta | ✅ Implementado |
| 3 | Compromissos | Alto | Alta | ✅ Implementado |
| 4 | Detector de treta | Médio | Média-Alta | ✅ Implementado |
| 4 | Persona do grupo | Alto | Alta | ✅ Implementado |
| 5 | Resumo para quem chegou tarde | Médio | Média | ✅ Implementado |

> **Todas as 10 features foram implementadas.** Próxima evolução: Dashboard Admin — ver `docs/DASHBOARD.md`.

---

## Agents especialistas

Cada feature é implementada por um agent com escopo e responsabilidades claras. Todos compartilham o mesmo contexto base do projeto.

### Contexto base (todos os agents recebem)

```
Projeto: WA-RESUMO-BOT — bot de WhatsApp em TypeScript + SQLite + Baileys + LLMs.

Contratos obrigatórios:
- Leia src/types/index.ts para interfaces (ICommand, IMessageStorage, ILLMProvider, etc.)
- Leia src/commands/resumo-command.ts como exemplo de comando
- Leia src/services/summary-service.ts como exemplo de service
- Leia src/config/index.ts para padrão de configuração

Padrão de implementação:
1. Service em src/services/ (lógica de negócio)
2. Command em src/commands/ (interface com o usuário via WhatsApp)
3. Se precisar de tabela nova, adicione migration no init() do sqlite-storage.ts
4. Registre o comando no src/index.ts
5. Exporte nos arquivos index.ts de cada pasta
6. Verifique compilação com: npx tsc --noEmit

Regras:
- Não instalar dependências novas sem necessidade
- Reusar OpenAI/Anthropic SDK já instalados
- Logs via Pino (já configurado)
- Todas as features devem chamar analytics.track() para métricas (após Fase 0)
- Tratamento de erro gracioso — nunca crashar o bot
- Mensagens em pt-BR para o usuário
```

---

### Agent 0: Data Engineer — Analytics

**Escopo:** Feature 10 (Analytics e métricas)

**Prompt:**
```
Implemente o sistema de analytics do bot.

Crie:
1. src/services/analytics-service.ts
   - Classe AnalyticsService com método track(event) para registrar eventos no SQLite
   - Tabela analytics_events (ver schema no ROADMAP.md Feature 10)
   - Métodos de agregação: getDailyUsage(), getWeeklyCost(), getTopCommands(),
     getPerformanceMetrics(), getGroupActivity()
   - Tabela de preços por modelo para cálculo de custo

2. src/commands/stats-command.ts
   - Comando /stats — mostra métricas do dia e da semana
   - Comando /stats custo — mostra breakdown de custo por provider/modelo

3. Integre o tracking nos services existentes:
   - summary-service.ts → track após cada resumo
   - media-processor.ts → track após cada mídia processada
   - command-handler.ts → track cada comando executado

Prioridade: ser leve e não impactar performance. O track() não deve
bloquear a resposta ao usuário (fire and forget).
```

---

### Agent 1a: Text Processor — Palavra do dia

**Escopo:** Feature 7 (Palavra do dia)

**Prompt:**
```
Implemente a feature "Palavra do dia".

Crie:
1. src/services/word-of-day-service.ts
   - Buscar todas as mensagens do dia via storage.getMessagesByTimeRange()
   - Tokenizar: split por espaço, lowercase, remover pontuação
   - Filtrar stop words pt-BR (lista inline, ~200 palavras: de, a, o, que, é, etc.)
   - Filtrar palavras com < 3 caracteres
   - Contar frequência por palavra
   - Retornar top 1 com contagem e número de pessoas que usaram

2. src/schedulers/word-of-day-scheduler.ts
   - Função que roda via setInterval no index.ts
   - Calcular próximo 23h, agendar execução
   - Para cada grupo ativo, gerar e enviar a palavra do dia
   - Formato: "🏆 *Palavra do dia:* _churrasco_ (mencionada 23 vezes por 5 pessoas)"

3. src/commands/palavras-command.ts
   - /palavras — mostra últimas 7 palavras do dia (precisa de tabela para histórico)

Schema para histórico:
CREATE TABLE word_of_day (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  word TEXT NOT NULL,
  count INTEGER NOT NULL,
  unique_senders INTEGER NOT NULL,
  date TEXT NOT NULL,  -- YYYY-MM-DD
  created_at INTEGER DEFAULT (unixepoch())
);

Não usar LLM — esta feature é 100% estatística.
```

---

### Agent 1b: Web Scraper — Curador de links

**Escopo:** Feature 6 (Curador de links)

**Prompt:**
```
Implemente a feature "Curador de links".

Crie:
1. src/services/link-service.ts
   - Detectar URLs em mensagens via regex (http/https)
   - Extrair título da página via fetch + parse de <title> (sem dependência nova,
     usar Node fetch nativo)
   - Salvar na tabela links (ver schema no ROADMAP.md Feature 6)
   - Categorização simples por domínio: youtube/vimeo=vídeo, instagram/twitter=social,
     github=dev, etc. Se não bater, chamar LLM com prompt curto para categorizar
   - Métodos: getLinks(groupId, limit), getLinksByCategory(groupId, category),
     getLinksByPeriod(groupId, from, to)

2. src/commands/links-command.ts
   - /links — últimos 10 links com título e categoria
   - /links semana — links da semana
   - /links videos — filtrar por categoria

3. Integrar detecção no index.ts:
   - Após salvar mensagem, verificar se contém URL
   - Se sim, processar em background (não bloquear)

Formato de saída:
🔗 *Links do grupo*

📺 Vídeos:
  • Título do vídeo — youtube.com (João, 14:30)

📰 Notícias:
  • Título da notícia — g1.com.br (Maria, 09:15)
```

---

### Agent 2a: Copywriter — Retrospectiva semanal

**Escopo:** Feature 1 (Retrospectiva semanal)

**Prompt:**
```
Implemente a feature "Retrospectiva semanal".

Crie:
1. src/services/stats-service.ts (métricas brutas do grupo)
   - Buscar todas as mensagens da semana
   - Calcular: total msgs, msgs por pessoa, mídias por tipo, horário de pico,
     dia mais ativo, mensagem mais longa, quem mais mandou áudio, quem mais
     mandou sticker, quem manda msg de madrugada (00h-06h)
   - Retornar como objeto estruturado

2. src/services/retro-service.ts (narrativa via LLM)
   - Receber métricas brutas do stats-service
   - Montar prompt pedindo ao LLM para gerar uma retrospectiva divertida e curta
   - Prompt deve pedir tom zoeiro, usar rankings, dar "prêmios" divertidos
   - Exemplo: "🏆 Coruja da semana: Bruno (15 msgs entre 2h-5h da manhã)"

3. src/commands/retro-command.ts
   - /retro — gera retrospectiva da semana atual
   - /retro semana — mesma coisa

4. src/schedulers/weekly-retro.ts
   - Envio automático domingo 21h para todos os grupos ativos

Schema: ver ROADMAP.md Feature 1 (group_stats).

O tom da retrospectiva é o diferencial. O prompt pro LLM deve gerar algo
que as pessoas queiram compartilhar.
```

---

### Agent 2b: Fintech — "Tá devendo"

**Escopo:** Feature 5 ("Tá devendo")

**Prompt:**
```
Implemente a feature "Tá devendo" (controle de dívidas do grupo).

Crie:
1. src/services/debt-service.ts
   - CRUD de dívidas (criar, listar, quitar)
   - Cálculo de saldo líquido entre membros (A deve 50 pra B, B deve 30 pra A = A deve 20 pra B)
   - Simplificação de dívidas circulares (A→B 50, B→C 30, C→A 10 → simplificar)
   - Detecção automática: regex para "te pago", "me deve", "racha", "pix",
     seguido de valor (R$50, 50 reais, 50)
   - Quando detectar, chamar LLM com prompt curto para extrair: devedor, credor, valor, motivo
   - Confirmar com o grupo antes de registrar: "💰 Detectei: João deve R$50 pra Maria (pizza).
     Confirmo? (sim/não)"

2. src/commands/divida-command.ts
   - /divida @João 50 pizza — registra dívida manual
   - /divida pagar @João 50 — quita parcial ou total
   - /dividas — mostra saldo de todos no grupo

Schema: ver ROADMAP.md Feature 5 (debts).

Formato de saída do /dividas:
💰 *Dívidas do grupo*

João deve:
  • R$50 para Maria (pizza) — 12/03
  • R$15 para Pedro (Uber) — 14/03

Maria deve:
  • R$30 para Pedro (almoço) — 13/03

✅ Pedro e Bruno estão quites!
```

---

### Agent 3a: Game Designer — Quiz "Quem disse isso?"

**Escopo:** Feature 3 (Quiz)

**Prompt:**
```
Implemente a feature "Quem disse isso?" (quiz game).

Crie:
1. src/services/quiz-service.ts
   - Seleção de mensagem: buscar últimas 500 msgs, filtrar textos interessantes
     (> 10 chars, < 200 chars, não é mídia, não é comando)
   - Usar LLM com prompt curto para escolher a mensagem mais engraçada/marcante
     de uma amostra de ~20 candidatas
   - Gerenciar estado da rodada: groupId → { message, options, correctAnswer,
     startedAt, answeredBy }
   - Placar: tabela quiz_scores (ver ROADMAP.md Feature 3)
   - Timeout: 30 segundos por rodada
   - Evitar repetir mensagens (guardar IDs já usados)

2. src/commands/quiz-command.ts
   - /quiz — inicia uma rodada
   - /ranking — mostra placar do grupo

3. Integrar escuta de respostas no index.ts:
   - Se há rodada ativa no grupo e alguém manda "1", "2", "3" ou "4",
     verificar se é resposta ao quiz

Fluxo:
Bot: "🎯 *Quem disse isso?*
_'mensagem aqui'_

1. João
2. Maria
3. Pedro
4. Ana

Respondam com o número! (30s)"

[alguém responde "2"]

Bot: "✅ @fulano acertou! Foi a Maria que disse isso! (+1 ponto)
🏆 Placar: fulano: 5 | ciclano: 3"

Desafio principal: gerenciar o estado da rodada e o timeout de forma
limpa, sem memory leaks (usar Map com cleanup).
```

---

### Agent 3b: NLP Engineer — Compromissos

**Escopo:** Feature 4 (Extrator de compromissos)

**Prompt:**
```
Implemente a feature "Extrator de compromissos e lembretes".

Crie:
1. src/services/commitment-service.ts
   - Detecção via regex de padrões de data/hora pt-BR:
     "amanhã", "sexta", "dia 15", "às 20h", "semana que vem",
     "depois de amanhã", "próxima segunda"
   - Quando regex dá match, chamar LLM com prompt curto para extrair:
     { description, date (ISO), time, confidence }
   - Só registrar se confidence > 0.7
   - Confirmar com o grupo: "📅 Detectei: Churrasco — sábado 15/03 às 14h. Salvo? (sim/não)"
   - CRUD: criar, listar, deletar compromissos
   - Lembrete: verificar a cada 30min se algum compromisso está a < 2h de acontecer

2. src/commands/compromissos-command.ts
   - /compromissos — lista próximos compromissos
   - /compromissos limpar — remove compromissos passados

3. src/schedulers/reminder-scheduler.ts
   - setInterval a cada 30min
   - Buscar compromissos onde event_date - now < 2h e reminder_sent = 0
   - Enviar: "⏰ Lembrete: Churrasco em 2 horas! (sábado 15/03 às 14h)"
   - Marcar reminder_sent = 1

Schema: ver ROADMAP.md Feature 4 (commitments).

O parse de datas em pt-BR é o maior desafio. Usar o LLM como fallback
quando regex não resolve. Converter datas relativas ("amanhã", "sexta")
para absolutas usando Date do JS.
```

---

### Agent 4a: Sentiment Analyst — Detector de treta

**Escopo:** Feature 2 (Detector de treta)

**Prompt:**
```
Implemente a feature "Detector de treta" (análise de sentimento).

Crie:
1. src/services/sentiment-service.ts
   - Score de tensão baseado em heurísticas (SEM LLM por mensagem):
     • Velocidade: > 8 msgs/min entre 2 pessoas = +3 pontos
     • CAPS LOCK: > 50% da msg em maiúscula = +2 pontos
     • Pontuação: "!!!" ou "???" = +1 ponto
     • Palavras negativas: lista de ~50 termos (absurdo, ridículo, mentira,
       não acredito, etc.) = +2 pontos cada
     • Mensagens longas em sequência da mesma pessoa = +1 ponto
   - Janela deslizante de 5 minutos, score acumulado
   - Threshold configurável (default: 15 pontos = alerta)
   - Quando threshold atingido: chamar LLM para gerar resumo imparcial
     dos dois lados da discussão
   - Cooldown: não alertar de novo por 30min no mesmo grupo

2. src/commands/temperatura-command.ts
   - /temperatura — mostra humor atual do grupo
   - Formato: "🌡️ Temperatura do grupo: 😎 Tranquilo (score: 3/15)"
   - Escala: 😎 Tranquilo | 😐 Normal | 😤 Esquentando | 🔥 Pegando fogo

3. Integrar monitoramento no index.ts:
   - A cada mensagem, alimentar o sentiment-service
   - Se threshold atingido, enviar alerta automático

Calibração é crítica. Começar conservador (threshold alto) para evitar
falsos positivos. Melhor perder uma treta do que alertar sem necessidade.
```

---

### Agent 4b: Prompt Engineer — Persona do grupo

**Escopo:** Feature 8 (Persona do grupo)

**Prompt:**
```
Implemente a feature "Persona do grupo".

Crie:
1. src/services/persona-stats.ts (camada 1: análise estatística)
   - Buscar últimas 500 mensagens do grupo
   - Contar frequência de palavras (excluindo stop words pt-BR)
   - Identificar gírias: palavras frequentes que NÃO estão num set de
     palavras comuns do português (~5000 palavras)
   - Top 5 emojis
   - Tamanho médio de mensagem
   - Horários de pico

2. src/services/persona-service.ts (camada 2+3: LLM + prompt dinâmico)
   - Pegar stats + amostra de ~100 mensagens representativas
   - Chamar LLM para destilação (ver prompt no ROADMAP.md Feature 8 Camada 2)
   - Salvar resultado como JSON na tabela group_persona
   - Cache: só reanalisar se updated_at > 24h ou via /persona atualizar
   - Construir system prompt dinâmico a partir do persona_json
   - Método respondAsPersona(groupId, question) para gerar respostas no "jeito" do grupo

3. src/commands/persona-command.ts
   - /persona — mostra perfil do grupo (gírias, tom, assuntos)
   - /persona atualizar — força reanálise
   - Menção ao bot com pergunta → responde com persona

Schema: ver ROADMAP.md Feature 8 (group_persona).

O prompt de destilação é o coração da feature. Deve extrair padrões
reais sem inventar. O prompt de resposta deve soar natural sem forçar
gírias em cada frase.
```

---

### Agent 5: UX Conversacional — Resumo para quem chegou tarde

**Escopo:** Feature 9 (Catch-up DM)

**Prompt:**
```
Implemente a feature "Resumo para quem chegou tarde".

Crie:
1. src/services/catchup-service.ts
   - Rastrear última mensagem de cada membro por grupo (tabela member_activity)
   - Detectar "retorno": membro que não mandava msg há > 4h manda uma mensagem
   - Gerar resumo personalizado: buscar msgs entre last_seen e now,
     filtrar menções ao nome da pessoa, usar LLM para resumo focado
   - Enviar por DM (mensagem privada) via whatsapp.sendMessage(senderId, text)
   - Formato amigável: "👋 Enquanto você tava fora do grupo X, rolou:
     [resumo]. Quer mais detalhes? Manda /resumo lá no grupo!"
   - Cooldown: não oferecer de novo se já ofereceu nas últimas 4h

2. src/commands/meperdi-command.ts
   - /meperdi — versão manual: gera resumo desde a última msg da pessoa e
     manda por DM
   - No grupo, responde: "📬 Te mandei um resumo no privado!"

3. Integrar tracking no index.ts:
   - A cada mensagem, atualizar member_activity
   - Verificar se é um "retorno" e oferecer resumo

Schema: ver ROADMAP.md Feature 9 (member_activity).

Cuidado com privacidade: só enviar DM se a pessoa já interagiu com o bot
antes (para evitar parecer spam). Na dúvida, perguntar no grupo:
"@fulano, quer um resumo do que rolou? (sim/não)"
```

---

### Mapa de dependências entre agents

```
Fase 0: Agent 0 (Analytics) ─────────────────────────────┐
                                                          │ todos os agents
Fase 1: Agent 1a (Palavra) ──── independente              │ posteriores usam
        Agent 1b (Links)   ──── independente              │ analytics.track()
                                                          │
Fase 2: Agent 2a (Retro)  ──── usa stats-service.ts ─────┤
        Agent 2b (Dívidas) ──── independente              │
                                                          │
Fase 3: Agent 3a (Quiz)   ──── independente               │
        Agent 3b (Compromissos) ── independente           │
                                                          │
Fase 4: Agent 4a (Treta)  ──── independente               │
        Agent 4b (Persona) ──── pode usar stats do 2a     │
                                                          │
Fase 5: Agent 5 (Catch-up) ── usa summary-service.ts ────┘
```

### Execução paralela

Agents dentro da mesma fase podem rodar em paralelo:
- **Fase 0:** Agent 0 sozinho (fundação)
- **Fase 1:** Agent 1a + 1b em paralelo
- **Fase 2:** Agent 2a + 2b em paralelo
- **Fase 3:** Agent 3a + 3b em paralelo
- **Fase 4:** Agent 4a + 4b em paralelo (4b pode reusar código do 2a se já existir)
- **Fase 5:** Agent 5 sozinho
