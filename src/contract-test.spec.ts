import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { normalizeDocument, type DocumentModel } from 'docfy-core';
import { runContractTests } from './contract-test';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '__tests__', 'fixtures');
const fixture = path.join(fixturesDir, 'spec-3.0.json');

async function withServer(handler: http.RequestListener, run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
}

describe('runContractTests()', () => {
  let document: DocumentModel;

  beforeAll(async () => {
    document = await normalizeDocument(fixture);
  });

  it('reports request-failed when the server never responds within the timeout', async () => {
    await withServer(
      (req, res) => {
        if (req.url !== '/users' || req.method !== 'GET') {
          res.statusCode = 404;
          res.end();
          return;
        }
        // Never call res.end() — simulates a hung server.
      },
      async (baseUrl) => {
        const results = await runContractTests(document, { baseUrl, filter: 'users' });
        const getUsers = results.find((r) => r.method === 'GET' && r.path === '/users');
        expect(getUsers?.outcome.kind).toBe('request-failed');
      },
    );
  }, 15_000);

  it('reports response-too-large instead of buffering an oversized body', async () => {
    const oversized = 'x'.repeat(11 * 1024 * 1024); // > MAX_BODY_BYTES (10MB)
    await withServer(
      (req, res) => {
        if (req.url === '/users' && req.method === 'GET') {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify([{ padding: oversized }]));
          return;
        }
        res.statusCode = 404;
        res.end();
      },
      async (baseUrl) => {
        const results = await runContractTests(document, { baseUrl, filter: 'users' });
        const getUsers = results.find((r) => r.method === 'GET' && r.path === '/users');
        expect(getUsers?.outcome.kind).toBe('response-too-large');
      },
    );
  });

  it("restrictToServers rejects a baseUrl outside the spec's declared servers before any request", async () => {
    // The fixture declares no `servers` at all, so any baseUrl is outside the (empty) allowlist.
    await expect(
      runContractTests(document, { baseUrl: 'http://127.0.0.1:1', restrictToServers: true }),
    ).rejects.toThrow("is not one of the spec's declared servers");
  });

  it('restrictToServers does not restrict anything when omitted', async () => {
    await withServer(
      (_req, res) => {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify([]));
      },
      async (baseUrl) => {
        const results = await runContractTests(document, { baseUrl, filter: 'users' });
        const getUsers = results.find((r) => r.method === 'GET' && r.path === '/users');
        expect(getUsers?.outcome.kind).not.toBe('request-failed');
      },
    );
  });
});
