import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { normalizeDocument, type DocumentModel } from 'docfy-core';
import { createServer } from './server';

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'docfy-core',
  'src',
  '__tests__',
  'fixtures',
  'spec-3.0.json',
);

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
    expect(tools.map((t) => t.name).sort()).toEqual(['get_endpoint', 'list_endpoints']);
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
});
