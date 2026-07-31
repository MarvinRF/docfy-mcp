import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { normalizeDocument, type DocumentModel } from 'docfy-core';
import { createServer } from './server';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '__tests__', 'fixtures');
const fixture = path.join(fixturesDir, 'spec-3.0.json');

async function connectedClient(document: DocumentModel): Promise<Client> {
  const server = createServer(document);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe('docfy-mcp server', () => {
  let document: DocumentModel;

  beforeAll(async () => {
    document = await normalizeDocument(fixture);
  });

  it('lists tools', async () => {
    const client = await connectedClient(document);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'contract_test',
      'diff_specs',
      'get_endpoint',
      'lint_spec',
      'list_endpoints',
    ]);
  });

  it('list_endpoints returns every endpoint', async () => {
    const client = await connectedClient(document);
    const result = await client.callTool({ name: 'list_endpoints', arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const expectedCount = document.tagGroups.flatMap((g) => g.endpoints).length;
    expect(text.split('\n')).toHaveLength(expectedCount);
  });

  it('list_endpoints filters by substring', async () => {
    const client = await connectedClient(document);
    const endpoint = document.tagGroups[0].endpoints[0];
    const needle = endpoint.path.slice(1, 4);
    const result = await client.callTool({
      name: 'list_endpoints',
      arguments: { filter: needle },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain(endpoint.path);
  });

  it('get_endpoint returns the Copy-for-AI text for a known endpoint', async () => {
    const client = await connectedClient(document);
    const endpoint = document.tagGroups[0].endpoints[0];
    const result = await client.callTool({
      name: 'get_endpoint',
      arguments: { method: endpoint.method, path: endpoint.path },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain(endpoint.path);
  });

  it('get_endpoint reports an error for an unknown endpoint', async () => {
    const client = await connectedClient(document);
    const result = await client.callTool({
      name: 'get_endpoint',
      arguments: { method: 'GET', path: '/does-not-exist' },
    });
    expect(result.isError).toBe(true);
  });

  it('lint_spec reports the known quality issues in the fixture', async () => {
    const client = await connectedClient(document);
    const result = await client.callTool({ name: 'lint_spec', arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('[missing-description]');
    expect(text).toContain('[no-error-response]');
  });

  it('diff_specs reports added and removed endpoints vs. a previous spec file', async () => {
    const client = await connectedClient(document);
    const previous = path.join(fixturesDir, 'spec-3.0-previous.json');
    const result = await client.callTool({ name: 'diff_specs', arguments: { path: previous } });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('+ POST /users');
    expect(text).toContain('- DELETE /users/{id}');
  });

  it('diff_specs requires either path or url', async () => {
    const client = await connectedClient(document);
    const result = await client.callTool({ name: 'diff_specs', arguments: {} });
    expect(result.isError).toBe(true);
  });

  it('contract_test runs every endpoint against a live server and reports the outcome', async () => {
    const server = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/users') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify([{ id: 'test', email: 'test@example.com' }]));
        return;
      }
      if (req.method === 'POST' && req.url === '/users') {
        res.statusCode = 201;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ id: 'test', email: 'test@example.com' }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const client = await connectedClient(document);
      const result = await client.callTool({
        name: 'contract_test',
        arguments: { baseUrl: `http://127.0.0.1:${port}` },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('✓ GET /users');
      expect(text).toContain('✓ POST /users');
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    }
  });
});
