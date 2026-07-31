import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { diffDocuments, lintSpec, operationToAiText, type DocumentModel, type Endpoint } from 'docfy-core';
import { z } from 'zod';
import { runContractTests } from './contract-test.js';
import { loadSpec, parseHeaders } from './load-spec.js';

function allEndpoints(document: DocumentModel): Endpoint[] {
  return document.tagGroups.flatMap((group) => group.endpoints);
}

function matchesFilter(endpoint: Endpoint, filter: string): boolean {
  const needle = filter.toLowerCase();
  return (
    endpoint.path.toLowerCase().includes(needle) ||
    (endpoint.summary?.toLowerCase().includes(needle) ?? false) ||
    endpoint.tags.some((tag) => tag.toLowerCase().includes(needle))
  );
}

export function createServer(document: DocumentModel): McpServer {
  const server = new McpServer({ name: 'docfy-mcp', version: '0.1.0' });

  server.registerTool(
    'list_endpoints',
    {
      title: 'List endpoints',
      description:
        'Lists every endpoint in the OpenAPI catalog (method, path, summary, tags), without ' +
        'request/response detail. Use this to discover what exists before calling get_endpoint.',
      inputSchema: {
        filter: z
          .string()
          .optional()
          .describe('Optional case-insensitive substring match against path, summary or tags.'),
      },
    },
    async ({ filter }) => {
      const endpoints = allEndpoints(document).filter((e) => !filter || matchesFilter(e, filter));
      const lines = endpoints.map((e) => `${e.method} ${e.path}${e.summary ? ` — ${e.summary}` : ''}`);
      return {
        content: [
          {
            type: 'text',
            text: lines.length > 0 ? lines.join('\n') : 'No endpoints matched.',
          },
        ],
      };
    },
  );

  server.registerTool(
    'get_endpoint',
    {
      title: 'Get endpoint detail',
      description:
        'Returns the full "Copy for AI" text for one endpoint — Purpose, Request, Parameters, ' +
        'Validation, Success Response and Error Responses — given its method and path.',
      inputSchema: {
        method: z.string().describe('HTTP method, case-insensitive (e.g. "GET", "post").'),
        path: z.string().describe('Endpoint path exactly as it appears in the spec, e.g. "/users/{id}".'),
      },
    },
    async ({ method, path }) => {
      const endpoint = allEndpoints(document).find(
        (e) => e.method.toLowerCase() === method.toLowerCase() && e.path === path,
      );
      if (!endpoint) {
        return {
          isError: true,
          content: [{ type: 'text', text: `No endpoint found for ${method.toUpperCase()} ${path}.` }],
        };
      }
      return { content: [{ type: 'text', text: operationToAiText(endpoint) }] };
    },
  );

  server.registerTool(
    'lint_spec',
    {
      title: 'Lint spec quality',
      description:
        'Checks the loaded OpenAPI catalog for spec-quality issues: missing summary/description, ' +
        'missing tags, missing 4xx/5xx responses, undocumented response codes, and duplicate ' +
        'operation IDs. Use this before writing a client against the spec, to know upfront which ' +
        'endpoints are under-documented.',
      inputSchema: {},
    },
    async () => {
      const issues = lintSpec(document);
      if (issues.length === 0) return { content: [{ type: 'text', text: 'No spec quality issues found.' }] };
      const lines = issues.map((i) => {
        const where = i.method && i.path ? `${i.method} ${i.path}: ` : '';
        return `✖ ${where}[${i.rule}] ${i.message}`;
      });
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  server.registerTool(
    'diff_specs',
    {
      title: 'Diff against another spec version',
      description:
        'Compares the loaded OpenAPI catalog against another spec (a previous version, e.g. from ' +
        'production or a git tag) and reports added/removed endpoints and breaking vs. informational ' +
        'field changes (new required params, requestBody turned required, removed response codes). ' +
        'Give either `path` (local file) or `url` (fetched live) for the other spec.',
      inputSchema: {
        path: z.string().optional().describe('Local filesystem path to the other OpenAPI spec.'),
        url: z.string().optional().describe('URL to fetch the other OpenAPI spec from.'),
        headers: z.array(z.string()).optional().describe('Extra headers for `url`, each formatted as "Name: value".'),
      },
    },
    async ({ path: specPath, url: specUrl, headers }) => {
      if (!specPath && !specUrl) {
        return { isError: true, content: [{ type: 'text', text: 'Either `path` or `url` is required.' }] };
      }
      let otherDocument: DocumentModel;
      try {
        otherDocument = await loadSpec({ specPath, specUrl, headers });
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }] };
      }

      const diff = diffDocuments(otherDocument, document);
      const lines: string[] = [];
      for (const endpoint of diff.added) lines.push(`+ ${endpoint.method} ${endpoint.path}`);
      for (const endpoint of diff.removed) lines.push(`- ${endpoint.method} ${endpoint.path}`);
      for (const changed of diff.changed) {
        for (const change of changed.changes) {
          const marker = change.severity === 'breaking' ? '!' : '~';
          lines.push(`${marker} ${changed.method} ${changed.path}: ${change.description}`);
        }
      }
      return {
        content: [{ type: 'text', text: lines.length > 0 ? lines.join('\n') : 'No differences found.' }],
      };
    },
  );

  server.registerTool(
    'contract_test',
    {
      title: 'Contract test against a live server',
      description:
        'Fires a real request at every endpoint (or a filtered subset) of an already-running server ' +
        'built from the loaded spec, and validates each live response against its declared schema — ' +
        'a Postman-collection-runner-equivalent with zero setup. A response with an undeclared status ' +
        'or no schema is reported but never counted as a mismatch (e.g. a fabricated ID legitimately ' +
        '404ing is not a contract break).',
      inputSchema: {
        baseUrl: z.string().describe('Base URL of the running server, e.g. "http://localhost:3000".'),
        headers: z
          .array(z.string())
          .optional()
          .describe('Extra headers sent with every request, each formatted as "Name: value" (e.g. auth).'),
        filter: z
          .string()
          .optional()
          .describe('Optional case-insensitive substring match against path or tags, to test a subset.'),
      },
    },
    async ({ baseUrl, headers, filter }) => {
      const results = await runContractTests(document, { baseUrl, headers: parseHeaders(headers), filter });
      if (results.length === 0) return { content: [{ type: 'text', text: 'No endpoints matched.' }] };

      const lines = results.map((r) => {
        const label = `${r.method} ${r.path} (${r.requestUrl})`;
        switch (r.outcome.kind) {
          case 'matched':
            return r.outcome.mismatches.length === 0
              ? `✓ ${label} — ${r.outcome.httpStatus}, matches schema`
              : `✖ ${label} — ${r.outcome.httpStatus}, ${r.outcome.mismatches.length} mismatch(es): ` +
                  r.outcome.mismatches.map((m) => `${m.path} (${m.message})`).join('; ');
          case 'undeclared-status':
            return `~ ${label} — ${r.outcome.httpStatus} (not declared in spec, not a failure)`;
          case 'no-schema':
            return `~ ${label} — ${r.outcome.httpStatus} (no schema declared for this status)`;
          case 'unparseable-body':
            return `✖ ${label} — ${r.outcome.httpStatus}, body isn't valid JSON`;
          case 'request-failed':
            return `✖ ${label} — request failed: ${r.outcome.message}`;
        }
      });
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  return server;
}
