import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { operationToAiText, type DocumentModel, type Endpoint } from 'docfy-core';
import { z } from 'zod';

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
      const lines = endpoints.map(
        (e) => `${e.method} ${e.path}${e.summary ? ` — ${e.summary}` : ''}`,
      );
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

  return server;
}
