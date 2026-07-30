import { normalizeDocument, type DocumentModel } from 'docfy-core';

export interface LoadSpecOptions {
  /** Local filesystem path to a static OpenAPI JSON/YAML file. */
  specPath?: string;
  /** URL to fetch the OpenAPI spec from (e.g. `/docs-json`). */
  specUrl?: string;
  /** Extra headers to send with `--url` requests, e.g. `["Authorization: Bearer xyz"]`. */
  headers?: string[];
}

/**
 * Paths NestJS/`@nestjs/swagger` projects commonly mount the OpenAPI JSON
 * at — there's no fixed convention, it's whatever string the project passed
 * to `SwaggerModule.setup()`. Used only to make a 404 actionable, never
 * tried unless the URL the caller actually asked for fails first.
 */
const COMMON_SPEC_PATHS = ['/api-json', '/docs-json', '/swagger-json', '/openapi.json', '/swagger.json'];

function parseHeaders(headers: string[] | undefined): Record<string, string> | undefined {
  if (!headers || headers.length === 0) return undefined;
  const result: Record<string, string> = {};
  for (const entry of headers) {
    const idx = entry.indexOf(':');
    if (idx === -1) throw new Error(`Invalid --header "${entry}" — expected "Name: value".`);
    result[entry.slice(0, idx).trim()] = entry.slice(idx + 1).trim();
  }
  return result;
}

/** True if `body` parses as JSON and looks like an OpenAPI/Swagger document. */
function looksLikeOpenApiDoc(body: string): boolean {
  try {
    const parsed = JSON.parse(body);
    return typeof parsed === 'object' && parsed !== null && ('openapi' in parsed || 'swagger' in parsed);
  } catch {
    return false;
  }
}

/**
 * Probes common sibling paths on the same origin after `--url` 404s, so the
 * error message can suggest the right one instead of leaving the user to
 * guess. Best-effort: a 3s timeout per candidate, network errors are
 * swallowed (a broken candidate just doesn't make it into the suggestion
 * list).
 */
async function findAlternateSpecUrls(
  failedUrl: string,
  headers: Record<string, string> | undefined,
): Promise<string[]> {
  let origin: string;
  try {
    origin = new URL(failedUrl).origin;
  } catch {
    return [];
  }

  const found: string[] = [];
  await Promise.all(
    COMMON_SPEC_PATHS.map(async (path) => {
      const candidate = origin + path;
      if (candidate === failedUrl) return;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(candidate, { headers, signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok && looksLikeOpenApiDoc(await res.text())) found.push(candidate);
      } catch {
        // ignore — not a viable candidate
      }
    }),
  );
  return found;
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
export async function loadSpec({ specPath, specUrl, headers }: LoadSpecOptions): Promise<DocumentModel> {
  if (specPath) return normalizeDocument(specPath);
  if (specUrl) {
    const fetchHeaders = parseHeaders(headers);
    const res = await fetch(specUrl, { headers: fetchHeaders });
    if (!res.ok) {
      const alternates = res.status === 404 ? await findAlternateSpecUrls(specUrl, fetchHeaders) : [];
      const hint =
        alternates.length > 0
          ? ` Found what looks like an OpenAPI doc at: ${alternates.join(', ')} — did you mean one of these?`
          : " The OpenAPI JSON path isn't a fixed convention — it's whatever your project passed to SwaggerModule.setup(), check your main.ts.";
      throw new Error(`Failed to fetch spec from ${specUrl}: ${res.status} ${res.statusText}.${hint}`);
    }
    return normalizeDocument(await res.json());
  }
  throw new Error('Either --spec <path> or --url <url> is required.');
}
