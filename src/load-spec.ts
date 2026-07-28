import { normalizeDocument, type DocumentModel } from 'docfy-core';

export interface LoadSpecOptions {
  /** Local filesystem path to a static OpenAPI JSON/YAML file. */
  specPath?: string;
  /** URL to fetch the OpenAPI spec from (e.g. `/docs-json`). */
  specUrl?: string;
}

/**
 * Loads and normalizes an OpenAPI spec.
 *
 * `--spec` is handed to `normalizeDocument` (SwaggerParser) as a path, which
 * reads it off disk directly. `--url` is fetched here instead of letting
 * SwaggerParser's own HTTP resolver touch it: that resolver's SSRF guard
 * (`safeUrlResolver`) refuses localhost/private addresses by default, which
 * is exactly what `--url http://localhost:3000/docs-json` (the primary use
 * case — a local NestJS dev server) is.
 */
export async function loadSpec({ specPath, specUrl }: LoadSpecOptions): Promise<DocumentModel> {
  if (specPath) return normalizeDocument(specPath);
  if (specUrl) {
    const res = await fetch(specUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch spec from ${specUrl}: ${res.status} ${res.statusText}`);
    }
    return normalizeDocument(await res.json());
  }
  throw new Error('Either --spec <path> or --url <url> is required.');
}
