import { PageMetadata, sanitizePageMetadata } from '../../shared/classification.js';

const MAX_HTML_BYTES = 600_000;
const DEFAULT_TIMEOUT_MS = 4000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export type MetadataResult =
  | { kind: 'html'; metadata: PageMetadata }
  /** PDFs, images, downloads: nothing to classify. */
  | { kind: 'not-html'; contentType: string }
  /** The site could not be reached; the shell will show its own error page. */
  | { kind: 'unreachable'; reason: string };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };

function decodeEntities(value: string): string {
  return value
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (match, code: string) => {
      const lower = code.toLowerCase();
      if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16) || 32);
      if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10) || 32);
      return ENTITIES[lower] ?? match;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return match ? (match[2] ?? match[3] ?? '') : null;
}

/**
 * Pulls structured metadata out of raw HTML without rendering it. Reads
 * <title>, meta name/property/itemprop tags (including YouTube's genre and
 * keywords), h1/h2 headings and a short visible-text sample.
 */
export function parseHtmlMetadata(html: string): Record<string, unknown> {
  const head = html.slice(0, MAX_HTML_BYTES);
  const meta = new Map<string, string>();
  const keywords: string[] = [];

  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attribute(tag, 'property') ?? attribute(tag, 'name') ?? attribute(tag, 'itemprop'))?.toLowerCase();
    const content = attribute(tag, 'content');
    if (!key || content === null) continue;
    const value = decodeEntities(content);
    if (key === 'og:video:tag') {
      keywords.push(value);
    } else if (!meta.has(key)) {
      meta.set(key, value);
    }
  }

  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  const headings = [...head.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)]
    .map((match) => decodeEntities(match[1]!.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean)
    .slice(0, 8);
  const body = /<body[^>]*>([\s\S]*)/i.exec(head)?.[1] ?? '';
  const textSample = decodeEntities(
    body
      .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).slice(0, 1200);

  const keywordMeta = meta.get('keywords');
  if (keywordMeta) {
    keywords.push(...keywordMeta.split(',').map((entry) => entry.trim()));
  }

  return {
    title: meta.get('og:title') ?? meta.get('title') ?? (titleTag ? decodeEntities(titleTag) : ''),
    description: meta.get('og:description') ?? meta.get('description') ?? '',
    keywords: keywords.filter(Boolean),
    headings,
    siteName: meta.get('og:site_name') ?? '',
    ogType: meta.get('og:type') ?? '',
    genre: meta.get('genre') ?? '',
    lang: /<html[^>]*\blang\s*=\s*["']?([a-z-]+)/i.exec(head)?.[1] ?? '',
    textSample
  };
}

async function readLimited(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_HTML_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
  }
  await reader.cancel().catch(() => undefined);
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}

/**
 * Search pages judged by their query. The query is what the student asked for,
 * the results match it, and the results page itself is often refused to
 * background requests, so it is not fetched.
 */
const SEARCH_PAGES: Array<{ hosts: string[]; path: string; param: string; site: string }> = [
  { hosts: ['youtube.com'], path: '/results', param: 'search_query', site: 'YouTube' }
];

export function searchPageMetadata(url: string, host: string): Record<string, unknown> | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const page = SEARCH_PAGES.find(
    ({ hosts, path }) => parsed.pathname.replace(/\/+$/, '') === path && hosts.some((entry) => host === entry || host.endsWith(`.${entry}`))
  );
  if (!page) {
    return null;
  }
  const query = (parsed.searchParams.get(page.param) ?? '').replace(/\s+/g, ' ').trim();
  return {
    title: query ? `${page.site} search: ${query}` : `${page.site} search`,
    description: query ? `Search results on ${page.site} for the query "${query}".` : `${page.site} search page with no query.`,
    keywords: query ? [query] : [],
    siteName: page.site,
    ogType: 'search'
  };
}

/** oEmbed endpoints for video hosts, which give a title and channel even when the page itself is refused. */
const OEMBED_ENDPOINTS: Array<{ hosts: string[]; endpoint: string }> = [
  { hosts: ['youtube.com', 'youtu.be'], endpoint: 'https://www.youtube.com/oembed?format=json&url=' },
  { hosts: ['vimeo.com'], endpoint: 'https://vimeo.com/api/oembed.json?url=' }
];

function oembedUrlFor(url: string, host: string): string | null {
  const match = OEMBED_ENDPOINTS.find(({ hosts }) => hosts.some((entry) => host === entry || host.endsWith(`.${entry}`)));
  return match ? `${match.endpoint}${encodeURIComponent(url)}` : null;
}

type OEmbed = { title: string; author: string; provider: string };

async function fetchOEmbed(endpoint: string, doFetch: typeof fetch, signal: AbortSignal): Promise<OEmbed | null> {
  try {
    const response = await doFetch(endpoint, { signal, headers: { 'user-agent': USER_AGENT, accept: 'application/json' } });
    if (!response.ok) return null;
    const data = (await response.json()) as Record<string, unknown>;
    const title = typeof data.title === 'string' ? data.title : '';
    if (!title) return null;
    return {
      title,
      author: typeof data.author_name === 'string' ? data.author_name : '',
      provider: typeof data.provider_name === 'string' ? data.provider_name : ''
    };
  } catch {
    return null;
  }
}

/** Fills gaps in page metadata from oEmbed: title, site name, and the channel as a description. */
function withOEmbed(raw: Record<string, unknown>, oembed: OEmbed | null, url: string): Record<string, unknown> {
  if (!oembed) return raw;
  const title = typeof raw.title === 'string' && raw.title && raw.title !== url ? raw.title : oembed.title;
  const byline = oembed.author ? `Video by ${oembed.author}${oembed.provider ? ` on ${oembed.provider}` : ''}.` : '';
  return {
    ...raw,
    title,
    siteName: raw.siteName || oembed.provider,
    description: raw.description || byline,
    keywords: [...(Array.isArray(raw.keywords) ? raw.keywords : []), ...(oembed.author ? [oembed.author] : [])]
  };
}

/**
 * True when the response is an error, a bot check (Google's "unusual traffic"
 * page) or a cookie-consent wall rather than the page itself.
 */
function isRefused(response: Response): boolean {
  if (!response.ok) return true;
  try {
    const final = new URL(response.url);
    return final.hostname.startsWith('consent.') || final.pathname.startsWith('/sorry/');
  } catch {
    return false;
  }
}

/**
 * Fetches a page's HTML in the main process (before the tab renders it) and
 * extracts metadata for classification. Video hosts are also asked for oEmbed,
 * which still answers when the page itself is refused.
 */
export async function fetchPageMetadata(
  url: string,
  host: string,
  key: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): Promise<MetadataResult> {
  const search = searchPageMetadata(url, host);
  if (search) {
    return { kind: 'html', metadata: sanitizePageMetadata(search, url, host, key) };
  }

  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const oembedUrl = oembedUrlFor(url, host);
  const oembedRequest = oembedUrl ? fetchOEmbed(oembedUrl, doFetch, controller.signal) : Promise.resolve(null);

  try {
    let raw: Record<string, unknown> | null = null;
    let failure = '';
    try {
      const response = await doFetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en' }
      });
      const contentType = response.headers.get('content-type') ?? '';
      if (isRefused(response)) {
        await response.body?.cancel().catch(() => undefined);
        failure = `The site refused the metadata request (HTTP ${response.status}).`;
      } else if (!/text\/html|application\/xhtml/i.test(contentType)) {
        await response.body?.cancel().catch(() => undefined);
        return { kind: 'not-html', contentType };
      } else {
        raw = parseHtmlMetadata(await readLimited(response));
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }

    const oembed = await oembedRequest;
    if (raw || oembed) {
      return { kind: 'html', metadata: sanitizePageMetadata(withOEmbed(raw ?? {}, oembed, url), url, host, key) };
    }
    return { kind: 'unreachable', reason: failure };
  } finally {
    clearTimeout(timer);
  }
}
