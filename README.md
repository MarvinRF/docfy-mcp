# docfy-mcp

An MCP (stdio) server that exposes an OpenAPI catalog as tools for coding
agents (Claude Code, Cursor, etc.) to query while implementing a client —
without leaving the editor to open a browser.

Works best with a catalog already documented via [`nestjs-docfy`](../nest-docfy),
but accepts any valid OpenAPI 3.0/3.1 spec.

## Tools

- **`list_endpoints`** — lists all endpoints (method + path + summary).
  Accepts an optional `filter` (case-insensitive substring match on
  path/summary/tags).
- **`get_endpoint`** — takes `method` + `path`, returns the full "Copy for
  AI" text block (Purpose, Request, Parameters, Validation, Success Response,
  Error Responses).
- **`lint_spec`** — checks the loaded catalog for spec-quality issues:
  missing summary/description, missing tags, missing 4xx/5xx responses,
  undocumented response descriptions, duplicate operation IDs.
- **`diff_specs`** — compares the loaded catalog against another spec
  (`path` or `url`, e.g. a previous version from production or a git tag) and
  reports added/removed endpoints and breaking vs. informational field
  changes.
- **`contract_test`** — fires a real request at every endpoint (or a
  filtered subset) of an already-running server built from the loaded spec,
  and validates each live response against its declared schema. Takes
  `baseUrl`, optional `headers` (repeatable `"Name: value"` strings, e.g.
  auth), and an optional `filter`.

## Usage

Published on npm — no need to clone or build:

```bash
# from a static file
npx docfy-mcp --spec ./openapi.json

# from a NestJS server running locally
npx docfy-mcp --url http://localhost:3000/docs-json
```

The JSON path isn't a fixed convention — it depends on what the project
passed to `SwaggerModule.setup()` (`/api-json`, `/docs-json`,
`/swagger-json`, ...). If `--url` returns 404, `docfy-mcp` probes the most
common paths on the same origin and suggests any that looks like a real
OpenAPI document.

For specs behind auth, repeat `--header` as many times as needed:

```bash
npx docfy-mcp --url https://api.example.com/api-json --header "Authorization: Bearer xyz"
```

> **Why `--url` doesn't use swagger-parser's HTTP resolver:** `--url` fetches
> the spec directly instead of delegating to swagger-parser's resolver. By
> default, swagger-parser's `safeUrlResolver` blocks local/private URLs as an
> SSRF protection — which would break the most common use case here:
> pointing at a local NestJS dev server.

### Local development

```bash
npm install && npm run build
node dist/cli.js --spec/--url ...
# or, via tsx:
npm run dev
```

## Registering as a local MCP server (Claude Code / Cursor)

Add a `.mcp.json` at the root of the project where the MCP client will run:

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

Restart the MCP client — the `list_endpoints` and `get_endpoint` tools
should appear in the available tools list.
