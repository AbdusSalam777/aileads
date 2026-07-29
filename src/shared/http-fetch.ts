import { userAgent } from '../config/env.js';

export type FetchOptions = {
  timeoutMs: number;
  maxBytes?: number;
  accept?: string;
  method?: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
};

export type FetchTextResult = {
  ok: boolean;
  status: number;
  url: string;
  body: string;
  contentType: string;
  truncated: boolean;
  retryAfterMs?: number;
};

export class HttpFetchError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'HttpFetchError';
  }
}

const parseRetryAfter = (value: string | null): number | undefined => {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);

  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
};

/**
 * Reads at most `maxBytes` so a hostile or accidentally huge response can't
 * exhaust memory. Returns the decoded prefix and flags it as truncated.
 */
const readCapped = async (response: Response, maxBytes: number) => {
  if (!response.body) {
    return { body: '', truncated: false };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let truncated = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (value) {
        chunks.push(value);
        received += value.byteLength;

        if (received >= maxBytes) {
          truncated = true;
          break;
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const merged = new Uint8Array(received);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { body: new TextDecoder('utf-8').decode(merged.slice(0, maxBytes)), truncated };
};

export const fetchText = async (url: string, options: FetchOptions): Promise<FetchTextResult> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      body: options.body,
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': userAgent,
        Accept: options.accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en',
        ...options.headers,
      },
    });

    const { body, truncated } = await readCapped(response, options.maxBytes ?? 2_000_000);

    return {
      ok: response.ok,
      status: response.status,
      url: response.url || url,
      body,
      contentType: response.headers.get('content-type') ?? '',
      truncated,
      retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    throw new HttpFetchError(
      aborted ? `Request to ${url} timed out after ${options.timeoutMs}ms` : `Request to ${url} failed`,
      error,
    );
  } finally {
    clearTimeout(timer);
  }
};

export const fetchJson = async <T>(url: string, options: FetchOptions): Promise<T> => {
  const result = await fetchText(url, { accept: 'application/json', ...options });

  if (!result.ok) {
    throw new HttpFetchError(`Request to ${url} returned HTTP ${result.status}`);
  }

  try {
    return JSON.parse(result.body) as T;
  } catch (error) {
    throw new HttpFetchError(`Response from ${url} was not valid JSON`, error);
  }
};
