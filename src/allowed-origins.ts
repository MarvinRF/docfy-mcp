/**
 * Builds the set of origins `contract_test`/`diff_specs` are permitted to target when
 * `restrictToServers` is on. Mirrors `buildAllowedOrigins()` in nest-docfy's
 * `proxy-handler.ts` — same shape, adapted to docfy-core's `DocumentModel.servers`
 * (already normalized to absolute URL strings, no `{ url }` wrapper needed).
 */
export function buildAllowedOrigins(servers: string[]): Set<string> {
  const origins = new Set<string>();
  for (const url of servers) {
    try {
      origins.add(new URL(url).origin);
    } catch {
      // Relative or malformed server URL — no safe base to resolve it against, skip.
    }
  }
  return origins;
}

/** True if `targetUrl`'s origin is in `allowed`. False (not thrown) for a malformed `targetUrl` — the caller decides how to report that. */
export function isOriginAllowed(targetUrl: string, allowed: Set<string>): boolean {
  try {
    return allowed.has(new URL(targetUrl).origin);
  } catch {
    return false;
  }
}
