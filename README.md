# docfy-mcp

Servidor MCP (stdio) que expõe um catálogo OpenAPI — de preferência um já
documentado com [`nestjs-docfy`](../nest-docfy), mas funciona com qualquer
spec OpenAPI 3.0/3.1 válida — como tools pra agentes de código (Claude Code,
Cursor etc.) consultarem durante a implementação de um client, sem abrir o
navegador.

## Tools

- **`list_endpoints`** — lista todos os endpoints (method + path + summary).
  Aceita `filter` opcional (substring case-insensitive em path/summary/tags).
- **`get_endpoint`** — recebe `method` + `path`, devolve o texto completo no
  formato "Copy for AI" (Purpose, Request, Parameters, Validation, Success
  Response, Error Responses).

## Uso

Publicado no npm — não precisa clonar nem buildar:

```bash
# a partir de um arquivo estático
npx docfy-mcp --spec ./openapi.json

# a partir de um servidor NestJS rodando localmente
npx docfy-mcp --url http://localhost:3000/docs-json
```

> `--url` faz o fetch da spec diretamente (não delega ao resolver HTTP do
> swagger-parser), justamente para funcionar contra `localhost` — o
> `safeUrlResolver` do swagger-parser bloqueia URLs locais/privadas por
> padrão (proteção SSRF), o que quebraria o caso de uso mais comum daqui:
> apontar pro dev server NestJS local.

O path do JSON não é convenção fixa — depende do que o projeto passou pra
`SwaggerModule.setup()` (`/api-json`, `/docs-json`, `/swagger-json`...). Se
`--url` der 404, o `docfy-mcp` sonda os paths mais comuns na mesma origem e
sugere qualquer um que pareça um documento OpenAPI de verdade.

Pra specs atrás de auth, repita `--header` quantas vezes precisar:

```bash
npx docfy-mcp --url https://api.exemplo.com/api-json --header "Authorization: Bearer xyz"
```

Pra desenvolver neste repo: `npm install && npm run build`, depois
`node dist/cli.js --spec/--url ...` (ou `npm run dev` via `tsx`).

## Registrar como MCP server local (Claude Code / Cursor)

Adicione um `.mcp.json` na raiz do projeto onde o client MCP vai rodar:

```json
{
  "mcpServers": {
    "docfy": {
      "command": "npx",
      "args": ["-y", "docfy-mcp", "--url", "http://localhost:3000/docs-json"]
    }
  }
}
```

Reinicie o client MCP; as tools `list_endpoints` e `get_endpoint` devem
aparecer na lista de tools disponíveis.

## Escopo do fim de semana

Fora do escopo por ora (ver `docfy-mcp-planejamento.md` na raiz do
container): CI/lint completo, transporte HTTP/SSE, `search_endpoints`
(busca semântica), autenticação/spec atrás de login.
