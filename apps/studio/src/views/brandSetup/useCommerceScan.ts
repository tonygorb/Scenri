import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type CommerceScan } from '../../api.js';

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

export interface CommerceScanState {
  scan: CommerceScan | null;
  scanning: boolean;
  retry: () => void;
}

export function useCommerceScan(brandId: string | null): CommerceScanState {
  const [scan, setScan] = useState<CommerceScan | null>(null);
  const [scanning, setScanning] = useState(false);
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
    setScanning(true);
    setScan(null);

    const run = async () => {
      try {
        const { scanId } = await api.catalogScan(brandId);
        const deadline = Date.now() + GIVE_UP_MS;
        const poll = async () => {
          if (stopped || !live.current) return;
          if (Date.now() > deadline) {
            setScanning(false);
            return;
          }
          try {
            const state = await api.catalogScanState(brandId, scanId);
            if (stopped || !live.current) return;
            if (state.status === 'running') {
              timer = setTimeout(poll, POLL_MS);
              return;
            }
            // An errored scan is not a failed import. Nothing was asked for
            // and nothing was lost, so the line simply says no catalog.
            setScan(state.result ?? null);
            setScanning(false);
          } catch {
            setScanning(false);
          }
        };
        timer = setTimeout(poll, POLL_MS);
      } catch {
        if (!stopped) setScanning(false);
      }
    };
    void run();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [brandId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { scan, scanning, retry };
}
