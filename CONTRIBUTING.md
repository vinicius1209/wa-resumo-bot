# Contribuindo

Obrigado pelo interesse em contribuir com o WA-Resumo-Bot!

## Como contribuir

### Reportando bugs

Abra uma [issue](../../issues) com:
- Descrição do problema
- Passos para reproduzir
- Logs relevantes (remova dados sensíveis)

### Sugerindo features

Abra uma [issue](../../issues) descrevendo a funcionalidade desejada e o caso de uso.

### Enviando código

1. Fork o repositório
2. Crie uma branch: `git checkout -b feat/minha-feature`
3. Faça suas alterações
4. Verifique que compila: `npx tsc --noEmit`
5. Commit com mensagem descritiva
6. Abra um Pull Request

## Arquitetura

O projeto segue **design por interfaces** — todos os módulos dependem de contratos em `src/types/index.ts`.

### Adicionando um novo comando

1. Crie `src/commands/meu-comando.ts` implementando `ICommand`
2. Exporte em `src/commands/index.ts`
3. Registre em `src/index.ts` via `commandHandler.register()`

### Adicionando um novo serviço com SQLite

1. Crie `src/services/meu-servico.ts`
2. Adicione `initTable(db: Database)` para criar tabelas
3. Exporte em `src/services/index.ts`
4. Inicialize em `src/index.ts` com `storage.getDatabase()`

### Adicionando um novo LLM provider

1. Crie `src/llm/meu-provider.ts` implementando `ILLMProvider`
2. Registre em `src/llm/provider-factory.ts`

## Convenções

- TypeScript com `strict: true`
- Logging via `pino` (nunca `console.log`)
- SQL sempre com prepared statements (nunca concatenação)
- Nomes em camelCase (TypeScript) e snake_case (colunas SQL)
- Erros de serviços não devem derrubar o processo — use try/catch
- Analytics tracking é fire-and-forget (nunca bloqueia a resposta)

## Configuração de desenvolvimento

```bash
cp .env.example .env
# Edite o .env com suas chaves de API
npm install
npm run dev:watch
```

Escaneie o QR code que aparece no terminal com seu WhatsApp.
