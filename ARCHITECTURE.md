# Arquitetura — WA-Resumo-Bot

## Visão Geral

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  WhatsApp   │────▶│   Bot Core   │────▶│  SQLite DB  │
│  (Baileys)  │◀────│  (Node.js)   │◀────│  (Storage)  │
└─────────────┘     └──────┬───────┘     └─────────────┘
                           │
                    ┌──────▼───────┐
                    │   Comando    │
                    │  detectado?  │
                    └──────┬───────┘
                           │ sim
                    ┌──────▼───────┐
                    │ Rate Limiter │
                    └──────┬───────┘
                           │ permitido
                    ┌──────▼───────┐
                    │  LLM Provider│
                    │ (OpenAI ou   │
                    │  Anthropic)  │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │   Resumo     │
                    │  enviado no  │
                    │    grupo     │
                    └──────────────┘
```

## Princípios de Design

### Spec-Driven
Todos os módulos dependem de interfaces definidas em `src/types/index.ts`. Nenhum módulo conhece a implementação concreta de outro. Isso permite trocar qualquer peça sem alterar o resto.

### Plug and Play
- **LLM**: Implementar `ILLMProvider` e registrar na factory
- **Storage**: Implementar `IMessageStorage`
- **Comandos**: Implementar `ICommand` e registrar no handler
- **Rate Limiter**: Implementar `IRateLimiter`

### Zero Custo com Terceiros
- Baileys conecta direto ao WhatsApp Web (sem API paga)
- SQLite é um arquivo local (sem banco externo)
- Único custo: tokens da LLM (OpenAI/Anthropic)

## Fluxo de Dados

1. **Mensagem chega** → Baileys emite evento `messages.upsert`
2. **Parse** → `WhatsAppConnection.parseMessage()` converte para `StoredMessage`
3. **Armazena** → `SQLiteStorage.save()` persiste no banco
4. **Detecta comando** → `CommandHandler.handleMessage()` verifica prefixo ou menção
5. **Rate check** → `RateLimiter.consume()` protege contra spam
6. **Busca contexto** → `SummaryService.fetchMessages()` coleta mensagens do período
7. **Gera resumo** → `ILLMProvider.summarize()` envia para a LLM
8. **Responde** → `WhatsAppConnection.sendMessage()` envia no grupo

## Decisões Técnicas

| Decisão | Justificativa |
|---------|---------------|
| Baileys sobre Evolution API | Sem camada extra, controle total, zero dependência |
| SQLite sobre PostgreSQL | Zero infra, arquivo local, WAL mode para performance |
| Sliding Window rate limit | Mais justo que fixed window, evita burst na fronteira |
| Temperature 0.3 na LLM | Minimiza criatividade, maximiza fidelidade ao conteúdo |
| Prompt com regras explícitas | Garante que a LLM não invente, não opine, não julgue |
