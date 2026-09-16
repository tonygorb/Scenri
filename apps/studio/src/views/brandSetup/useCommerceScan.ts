import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type CommerceScan } from '../../api.js';
import type { ApiError } from '../../apiTypes.js';

/**
 * Look for a shop on the site the kit was just built from.
 *
 * Deliberately a second request, after the brand has already landed. The kit
 * is on screen in a couple of seconds and a catalog takes longer to find, so
 * tying them together would either delay the brand or cut the search short.
 * Keeping them apart is also what makes "retrying the products never touches
 * the brand" true by construction rather than by care.
 *
 * `/setup` sits outside the task centre, so this polls for itself and stops
 * the moment the scan settles or the screen goes away.
 */
const POLL_MS = 700;
/** The scan's own budget is 25s; this is the giving-up point around it. */
const GIVE_UP_MS = 45_000;
/**
 * How long one poll may hang before we stop waiting on it.
 *
 * The give-up above is only checked between polls, so a request that never
 * returned deferred it indefinitely. Reading the state of a scan is a local
 * call; three seconds is already generous.
 */
const POLL_TIMEOUT_MS = 3_000;

/**
 * How the look ended, which is not the same question as what it found.
 *
 * `scan: CommerceScan | null` could not tell these apart, and null was every
 * one of them: a site with no shop, a scan that timed out, a scan the server
 * failed, and a scan whose answer we never managed to read. The screen drew
 * all four as "this site has no shop" and removed the products line, so a
 * store with 1,186 readable products looked exactly like a portfolio.
 */
export type ScanOutcome =
  | { kind: 'idle' }
  | { kind: 'scanning' }
  | { kind: 'result'; scan: CommerceScan }
  | { kind: 'timeout' }
  | { kind: 'error'; reason: string };

type ScanFailure = Extract<ScanOutcome, { kind: 'timeout' } | { kind: 'error' }>;

export interface CommerceScanState {
  scan: CommerceScan | null;
  scanning: boolean;
  /**
   * The look has finished, whatever it concluded.
   *
   * `!scanning` is not the same thing: there is a tick between asking for a
   * scan and the request being in flight, and a caller that acts on the
   * absence of a result during it acts before anything has been looked at.
   */
  settled: boolean;
  /** The same story, told in a shape that can distinguish its endings. */
  outcome: ScanOutcome;
  retry: () => void;
}

/**
 * @param url the address to look at. Omitted on `/setup`, where the brand was
 * just built from its own website; supplied on the products page, where
 * someone types a store address of their own.
 */
export function useCommerceScan(brandId: string | null, url?: string): CommerceScanState {
  const [scan, setScan] = useState<CommerceScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [settled, setSettled] = useState(false);
  const [failure, setFailure] = useState<ScanFailure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    if (!brandId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let startedScanId: string | null = null;
    setScanning(true);
    setSettled(false);
    setScan(null);
    setFailure(null);

    const end = (result: CommerceScan | null, failed: ScanFailure | null) => {
      setScan(result);
      setFailure(failed);
      setScanning(false);
      setSettled(true);
    };

    const run = async () => {
      try {
        const { scanId } = await api.catalogScan(brandId, url);
        startedScanId = scanId;
        // The cleanup below can have run already: leaving the screen while
        // this request was still in flight left `startedScanId` null, so the
        // cancel it promises never fired and the crawl carried on against a
        // stranger's store with nobody left to read the answer.
        if (stopped || !live.current) {
          void api.cancelCatalogScan(brandId, scanId).catch(() => {});
          return;
        }
        const deadline = Date.now() + GIVE_UP_MS;
        const poll = async () => {
          if (stopped || !live.current) return;
          if (Date.now() > deadline) {
            end(null, { kind: 'timeout' });
            return;
          }
          try {
            // Bounded, because the give-up above is only consulted between
            // polls: an un-timed GET that never came back postponed it for as
            // long as the request hung, which is how 45 seconds became minutes.
            const state = await api.catalogScanState(brandId, scanId, AbortSignal.timeout(POLL_TIMEOUT_MS));
            if (stopped || !live.current) return;
            if (state.status === 'running') {
              timer = setTimeout(poll, POLL_MS);
              return;
            }
            // A scan that ended without a result failed, and the server knows
            // why. Reading only `state.result` threw that reason away and left
            // the screen unable to tell a portfolio from a store it could not
            // open.
            if (state.result) end(state.result, null);
            else end(null, { kind: 'error', reason: state.error ?? 'The look for a shop did not finish.' });
          } catch (err) {
            if (stopped || !live.current) return;
            // A scan the server no longer holds is gone, and no amount of
            // asking brings it back.
            if ((err as ApiError)?.status === 404) {
              end(null, { kind: 'error', reason: 'The look for a shop was interrupted.' });
              return;
            }
            // One unread poll is not a verdict. The give-up above is what ends
            // this, so keep asking until it does.
            timer = setTimeout(poll, POLL_MS);
          }
        };
        timer = setTimeout(poll, POLL_MS);
      } catch {
        if (!stopped) end(null, { kind: 'error', reason: 'The look for a shop could not start.' });
      }
    };
    void run();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      // Leaving the screen stops the crawl rather than orphaning it against a
      // stranger's store with nobody left to read the answer.
      if (startedScanId) void api.cancelCatalogScan(brandId, startedScanId).catch(() => {});
    };
  }, [brandId, url, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const outcome: ScanOutcome = scanning
    ? { kind: 'scanning' }
    : failure
      ? failure
      : scan
        ? { kind: 'result', scan }
        : { kind: 'idle' };
  return { scan, scanning, settled, outcome, retry };
}
