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
  return scans.get(scanId);
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

  void scanForCandidates({ url, fetchImpl, signal: ctrl.signal })
    .then((result) => {
      state.result = result;
      state.status = 'done';
    })
    .catch((err: unknown) => {
      state.status = 'error';
      state.error = err instanceof Error ? err.message : String(err);
    })
    .finally(() => controllers.delete(id));

  return { scanId: id };
}
