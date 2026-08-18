import type { ApiError } from './apiTypes.js';
export async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
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

