/**
 * Website scans, held in memory for as long as someone is looking at them.
 *
 * A scan writes nothing. That is the whole point of it, and it is also why it
 * is not an `import_jobs` row: a job row would surface in the task centre as
 * an import that never imports, and a `catalog_candidates` table would give
 * the codebase two answers to "what is a product". A restart loses a scan and
 * the client asks again, which is a fair price for a bounded 25-second look.
 */
import { randomUUID } from 'node:crypto';
import { scanForCandidates, type ScanResult } from '@scenri/catalog';
import type { Core } from '@scenri/core';

export interface ScanState {
  id: string;
  brandId: string;
  url: string;
  status: 'running' | 'done' | 'error';
  result?: ScanResult;
  error?: string;
  startedAt: number;
}

const scans = new Map<string, ScanState>();
const controllers = new Map<string, AbortController>();
/** Enough for the handful a session looks at; the oldest fall off the back. */
const KEEP = 32;

/**
 * When we stop a scan ourselves.
 *
 * The scan budgets itself at 25 seconds, but nothing enforced that from
 * outside, so a crawl that never returned left a row reading `running`
 * forever and a screen waiting on it.
 *
 * Three numbers in a row, and the order matters: a scan that spends
 * everything takes its 25 second budget for discovery plus the 12 second
 * floor the preview is owed after it, so 37; this backstop sits above that so
 * it only ever catches a crawl that is genuinely stuck; and the client gives
 * up at 45, above this, so the answer a screen gets is a finished scan rather
 * than its own patience running out.
 */
const HARD_STOP_MS = 42_000;

/**
 * How long a settled scan stays readable.
 *
 * Long enough to survive a reload and a look, short enough that a scan cannot
 * be answered from an hour-old crawl. Independent of `KEEP`, which bounds how
 * many we hold rather than how old they may be.
 */
const KEEP_MS = 10 * 60_000;

function remember(state: ScanState): void {
  scans.set(state.id, state);
  while (scans.size > KEEP) {
    const oldest = scans.keys().next().value;
    if (oldest === undefined) break;
    scans.delete(oldest);
    controllers.delete(oldest);
  }
}

export function getScan(scanId: string): ScanState | undefined {
  const state = scans.get(scanId);
  if (!state) return undefined;
  // An expired scan is gone rather than stale. A screen that asks about one
  // gets a clean miss it can say something about, not an old answer.
  if (state.status !== 'running' && Date.now() - state.startedAt > KEEP_MS) {
    scans.delete(scanId);
    controllers.delete(scanId);
    return undefined;
  }
  return state;
}

export function cancelScan(scanId: string): boolean {
  const ctrl = controllers.get(scanId);
  if (!ctrl) return false;
  ctrl.abort();
  return true;
}

export function startCatalogScan(
  deps: { core: Core; fetchImpl?: typeof fetch },
  brandId: string,
  url: string,
): { scanId: string } {
  const { core, fetchImpl } = deps;
  if (!core.store.getBrand(brandId)) throw Object.assign(new Error('brand not found'), { statusCode: 404 });

  const id = randomUUID();
  const ctrl = new AbortController();
  const state: ScanState = { id, brandId, url, status: 'running', startedAt: Date.now() };
  remember(state);
  controllers.set(id, ctrl);

  // Nothing outside the crawl was watching it. A scan that never settled sat
  // `running` until it was evicted, and the screen waiting on it had only its
  // own patience to end on.
  let hardStopped = false;
  const stopper = setTimeout(() => {
    hardStopped = true;
    ctrl.abort();
  }, HARD_STOP_MS);
  stopper.unref?.();

  void scanForCandidates({ url, fetchImpl, signal: ctrl.signal })
    .then((result) => {
      state.result = result;
      state.status = 'done';
    })
    .catch((err: unknown) => {
      state.status = 'error';
      state.error = hardStopped
        ? 'This site took too long to look through.'
        : err instanceof Error
          ? err.message
          : String(err);
    })
    .finally(() => {
      clearTimeout(stopper);
      controllers.delete(id);
    });

  return { scanId: id };
}
