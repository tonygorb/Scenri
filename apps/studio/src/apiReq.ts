import type { ApiError } from './apiTypes.js';
/**
 * `init.keepalive` hands a small write to the browser to finish on its own, so
 * a reload in the same instant does not drop it (guide intents).
 */
export async function req<T>(
  method: string,
  url: string,
  body?: unknown,
  signal?: AbortSignal,
  init?: { keepalive?: boolean },
): Promise<T> {
  const res = await fetch(url, {
    method,
    signal,
    keepalive: init?.keepalive,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j.error ?? msg;
      if (j.details) msg += `: ${j.details.join('; ')}`;
    } catch {
      /* ignore */
    }
    throw Object.assign(new Error(msg), { status: res.status, method, url }) as ApiError;
  }
  return res.json() as Promise<T>;
}
