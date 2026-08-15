import { clip, sanitiseUrl, scrub } from './scrub.js';
import type { ErrorEntry } from './types.js';

/**
 * The last few things that went wrong, so a report filed right after a failure
 * carries the failure.
 *
 * In memory only, and deliberately so: persisting failure text to localStorage
 * would put it somewhere scrub.ts cannot reach on the way out, and somewhere it
 * outlives the session that produced it. Nothing here is transmitted until a
 * human presses Send.
 *
 * What is never recorded: request or response headers, request or response
 * bodies, the sc_access cookie, any localStorage value. An entry is a method, a
 * status, a sanitised pathname and a message — nothing else.
 */

const CAP = 25;
const ring: ErrorEntry[] = [];

function push(e: ErrorEntry): void {
  ring.push(e);
  if (ring.length > CAP) ring.shift();
}

export function recordError(e: Omit<ErrorEntry, 'at'>): void {
  if (!__SC_ALPHA__) return;
  push({
    ...e,
    // scrubbed on the way IN, not only at build time: the ring should never
    // hold a key or a home path, not even in memory for a debugger to find
    message: scrub(clip(e.message, 300)),
    url: e.url ? sanitiseUrl(e.url) : undefined,
    at: new Date().toISOString(),
  });
}

/** Newest last, as a copy, so a report cannot be mutated by later failures. */
export const recentErrors = (): ErrorEntry[] => ring.slice();

export const clearErrors = (): void => {
  ring.length = 0;
};

/**
 * The two failure paths the app has no coverage for at all: there is no error
 * boundary, no window.onerror and no unhandledrejection handler anywhere in
 * the studio today. Listeners are passive — nothing is prevented, nothing is
 * swallowed, so app behaviour is unchanged.
 */
export function installErrorHooks(): () => void {
  if (!__SC_ALPHA__) return () => {};

  const onError = (ev: ErrorEvent) => {
    recordError({
      kind: 'window',
      message: ev.message || String(ev.error ?? 'error'),
      url: ev.filename || undefined,
    });
  };
  const onRejection = (ev: PromiseRejectionEvent) => {
    const r = ev.reason as { message?: string; status?: number; url?: string; method?: string } | undefined;
    recordError({
      kind: 'promise',
      message: r?.message ?? String(ev.reason),
      status: r?.status,
      method: r?.method,
      url: r?.url,
    });
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
