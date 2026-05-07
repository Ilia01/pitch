import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

export interface ExtractResult {
  ok: true;
  title?: string;
  byline?: string;
  text: string;
  url: string;
}

export interface ExtractFailure {
  ok: false;
  url: string;
  reason: string;
}

export type ExtractOutcome = ExtractResult | ExtractFailure;

export interface FetchAndExtractOptions {
  /** Override for tests. */
  fetchImpl?: typeof fetch;
  /** Timeout in ms. Default 10_000. */
  timeoutMs?: number;
  /** Max chars of extracted text to return. Default 4000. */
  maxChars?: number;
  /** User-Agent to send. Default a recognisable string. */
  userAgent?: string;
}

const DEFAULT_UA = 'Mozilla/5.0 (compatible; PitchBot/0.1; +https://github.com/Ilia01/pitch)';

export async function fetchAndExtract(
  url: string,
  opts: FetchAndExtractOptions = {},
): Promise<ExtractOutcome> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxChars = opts.maxChars ?? 4000;
  const userAgent = opts.userAgent ?? DEFAULT_UA;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url, {
      headers: { 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml' },
      signal: ctrl.signal,
      redirect: 'follow',
    });

    if (!res.ok) {
      return { ok: false, url, reason: `HTTP ${res.status}` };
    }
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('html')) {
      return { ok: false, url, reason: `unsupported content-type ${ct || '<empty>'}` };
    }

    const html = await res.text();
    const parsed = extractFromHtml(html, url);
    if (!parsed.ok) return parsed;

    return {
      ok: true,
      url: parsed.url,
      title: parsed.title,
      byline: parsed.byline,
      text:
        parsed.text.length > maxChars
          ? `${parsed.text.slice(0, maxChars).trimEnd()}…`
          : parsed.text,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, url, reason: message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pure helper: run Readability on an HTML string. Useful in tests and when
 * the HTML is already in hand.
 */
export function extractFromHtml(html: string, url: string): ExtractOutcome {
  let article: ReturnType<Readability['parse']>;
  try {
    const { document } = parseHTML(html);
    // linkedom's Document is structurally compatible with what Readability
    // expects, but its lib.dom-typed signature requires a cast.
    type ReadabilityDoc = ConstructorParameters<typeof Readability>[0];
    article = new Readability(document as unknown as ReadabilityDoc).parse();
  } catch (err) {
    return { ok: false, url, reason: err instanceof Error ? err.message : String(err) };
  }

  const text = (article?.textContent ?? '')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length < 40) {
    return { ok: false, url, reason: 'extracted text too short' };
  }

  return {
    ok: true,
    url,
    title: article?.title ?? undefined,
    byline: article?.byline ?? undefined,
    text,
  };
}
