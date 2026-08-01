import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadSpec } from './load-spec';

describe('loadSpec()', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('throws when neither --spec nor --url is given', async () => {
    await expect(loadSpec({})).rejects.toThrow('Either --spec <path> or --url <url> is required.');
  });

  it('fetches --url with no headers by default', async () => {
    const spec = { openapi: '3.0.3', info: { title: 't', version: '1' }, paths: {} };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => spec });
    global.fetch = fetchMock as unknown as typeof fetch;

    await loadSpec({ specUrl: 'http://localhost:3000/api-json' });

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/api-json', { headers: undefined });
  });

  it('parses --header entries into a headers object', async () => {
    const spec = { openapi: '3.0.3', info: { title: 't', version: '1' }, paths: {} };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => spec });
    global.fetch = fetchMock as unknown as typeof fetch;

    await loadSpec({
      specUrl: 'http://localhost:3000/api-json',
      headers: ['Authorization: Bearer xyz', 'X-Custom:  value-with-spaces  '],
    });

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/api-json', {
      headers: { Authorization: 'Bearer xyz', 'X-Custom': 'value-with-spaces' },
    });
  });

  it('rejects a malformed --header entry', async () => {
    await expect(loadSpec({ specUrl: 'http://localhost:3000/api-json', headers: ['not-a-header'] })).rejects.toThrow(
      'Invalid --header "not-a-header"',
    );
  });

  it('on a 404, suggests a sibling path that looks like an OpenAPI doc', async () => {
    const openApiBody = JSON.stringify({ openapi: '3.0.3', info: { title: 't', version: '1' }, paths: {} });
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === 'http://localhost:3000/docs-json') {
        return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' });
      }
      if (url === 'http://localhost:3000/api-json') {
        return Promise.resolve({ ok: true, status: 200, text: async () => openApiBody });
      }
      return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(loadSpec({ specUrl: 'http://localhost:3000/docs-json' })).rejects.toThrow(
      /Found what looks like an OpenAPI doc at: http:\/\/localhost:3000\/api-json/,
    );
  });

  it('on a 404 with no viable sibling, points at SwaggerModule.setup() instead of guessing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(loadSpec({ specUrl: 'http://localhost:3000/docs-json' })).rejects.toThrow(/SwaggerModule\.setup\(\)/);
  });

  it('does not probe alternates for non-404 failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(loadSpec({ specUrl: 'http://localhost:3000/docs-json' })).rejects.toThrow(
      'Failed to fetch spec from http://localhost:3000/docs-json: 500 Internal Server Error.',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  describe('allowedOrigins', () => {
    it('rejects a specUrl outside the allowed origins before fetching', async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock as unknown as typeof fetch;

      await expect(
        loadSpec({
          specUrl: 'http://169.254.169.254/latest/meta-data',
          allowedOrigins: new Set(['http://localhost:3000']),
        }),
      ).rejects.toThrow("is not one of the primary spec's declared servers");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('allows a specUrl matching one of the allowed origins', async () => {
      const spec = { openapi: '3.0.3', info: { title: 't', version: '1' }, paths: {} };
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => spec });
      global.fetch = fetchMock as unknown as typeof fetch;

      await loadSpec({
        specUrl: 'http://localhost:3000/api-json',
        allowedOrigins: new Set(['http://localhost:3000']),
      });
      expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/api-json', { headers: undefined });
    });

    it('does not restrict anything when allowedOrigins is omitted', async () => {
      const spec = { openapi: '3.0.3', info: { title: 't', version: '1' }, paths: {} };
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => spec });
      global.fetch = fetchMock as unknown as typeof fetch;

      await loadSpec({ specUrl: 'http://169.254.169.254/latest/meta-data' });
      expect(fetchMock).toHaveBeenCalled();
    });
  });
});
