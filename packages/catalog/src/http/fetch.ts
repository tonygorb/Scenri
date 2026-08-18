import type { FetchImpl } from '../types.js';

export const USER_AGENT = 'scenri-catalog/0.1 (+https://scenri.co)';

export interface HttpOptions {
  fetchImpl?: FetchImpl;
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  accept?: string;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Bounded fetch with timeout, polite UA, and exponential backoff on 429/5xx. */
export async function httpGet(url: string, opts: HttpOptions = {}): Promise<Response> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const retries = opts.retries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 25_000;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        redirect: 'follow',
        signal: ctrl.signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: opts.accept ?? 'application/json, text/html, application/xml, text/xml, */*;q=0.8',
          ...(opts.headers ?? {}),
        },
      });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(400 * 2 ** attempt);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (opts.signal?.aborted) throw err;
      if (attempt < retries) {
        await sleep(400 * 2 ** attempt);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }
  throw lastErr ?? new Error(`fetch failed: ${url}`);
}

export async function httpText(
  url: string,
  opts: HttpOptions = {},
): Promise<{ ok: boolean; status: number; text: string; url: string }> {
  const res = await httpGet(url, opts);
  const text = await res.text();
  return { ok: res.ok, status: res.status, text, url: res.url || url };
}

export async function httpJson<T = unknown>(
  url: string,
  opts: HttpOptions = {},
): Promise<{ ok: boolean; status: number; json: T | null; url: string; text: string }> {
  const res = await httpGet(url, { ...opts, accept: opts.accept ?? 'application/json' });
  const text = await res.text();
  let json: T | null = null;
  if (res.ok) {
    try {
      json = JSON.parse(text) as T;
    } catch {
      json = null;
    }
  }
  return { ok: res.ok && json !== null, status: res.status, json, url: res.url || url, text };
}

/** Run async work over items with a concurrency limit. */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
    while (true) {
      if (signal?.aborted) throw new Error('aborted');
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
