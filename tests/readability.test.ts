import { describe, expect, it } from 'vitest';
import { extractFromHtml, fetchAndExtract } from '../src/core/readability.js';

const sampleHtml = `
<!doctype html>
<html>
  <head><title>Scaling Postgres at Acme</title></head>
  <body>
    <header>nav nav nav</header>
    <article>
      <h1>Scaling Postgres at Acme</h1>
      <p>By Alice Cooper</p>
      <p>We recently migrated our analytics workload to a separate read replica
      after seeing connection-pool saturation during business hours.</p>
      <p>The key insight was that pgBouncer alone wasn't enough — we also had
      to refactor the application's transaction boundaries to avoid holding
      idle connections during slow JSON serialization.</p>
      <p>This took about three weeks of careful migration work and a lot of
      careful staging-environment testing before we shipped to production.</p>
    </article>
    <footer>footer noise</footer>
  </body>
</html>`;

describe('extractFromHtml', () => {
  it('extracts the main article body', () => {
    const result = extractFromHtml(sampleHtml, 'https://acme.com/blog/scaling-postgres');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.title).toContain('Scaling Postgres');
    expect(result.text).toContain('connection-pool saturation');
    expect(result.text).not.toContain('nav nav nav');
  });

  it('returns ok:false when content is too short', () => {
    const html = '<html><body><article>tiny</article></body></html>';
    const result = extractFromHtml(html, 'https://example.com/');
    expect(result.ok).toBe(false);
  });
});

describe('fetchAndExtract', () => {
  function mockFetch(response: {
    ok?: boolean;
    status?: number;
    body: string;
    headers?: Record<string, string>;
  }) {
    return async (_url: string | URL | Request): Promise<Response> => {
      const headers = new Headers(response.headers ?? { 'content-type': 'text/html' });
      const r = {
        ok: response.ok ?? true,
        status: response.status ?? 200,
        headers,
        text: async () => response.body,
        json: async () => JSON.parse(response.body) as unknown,
      };
      return r as unknown as Response;
    };
  }

  it('returns ok with extracted text on a 200 HTML response', async () => {
    const result = await fetchAndExtract('https://acme.com/post', {
      fetchImpl: mockFetch({ body: sampleHtml }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text.length).toBeGreaterThan(40);
  });

  it('reports HTTP errors with status', async () => {
    const result = await fetchAndExtract('https://acme.com/missing', {
      fetchImpl: mockFetch({ ok: false, status: 404, body: '' }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('HTTP 404');
  });

  it('rejects non-HTML content types', async () => {
    const result = await fetchAndExtract('https://acme.com/api.json', {
      fetchImpl: mockFetch({ body: '{}', headers: { 'content-type': 'application/json' } }),
    });
    expect(result.ok).toBe(false);
  });

  it('clips extracted text to maxChars', async () => {
    const result = await fetchAndExtract('https://acme.com/post', {
      fetchImpl: mockFetch({ body: sampleHtml }),
      maxChars: 50,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text.length).toBeLessThanOrEqual(51); // 50 + ellipsis
  });
});
