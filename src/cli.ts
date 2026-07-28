#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadSpec } from './load-spec.js';
import { createServer } from './server.js';

function parseArgs(argv: string[]): { specPath?: string; specUrl?: string } {
  const result: { specPath?: string; specUrl?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--spec') result.specPath = argv[++i];
    else if (argv[i] === '--url') result.specUrl = argv[++i];
  }
  return result;
}

async function main(): Promise<void> {
  const { specPath, specUrl } = parseArgs(process.argv.slice(2));
  const document = await loadSpec({ specPath, specUrl });
  const server = createServer(document);
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
