import { useCallback, useEffect, useRef, useState } from 'react';
import { api, saveBrandOnUnload, type Brand } from '../../api.js';
import { useAppData } from '../../app/AppShell.js';
import { useBrand } from '../../app/BrandLayout.js';
import { useToasts } from '../../toasts.js';

/** Top-level keys the Brand page owns. Anything else on the row belongs to someone else. */
export type BrandDocKey = 'meta' | 'palette' | 'logos' | 'imagery' | 'rules';

export type SaveState = 'idle' | 'pending' | 'saving' | 'error';

export interface BrandDoc {
  /** brand.json with this page's pending edits laid over it — what every section renders from. */
  json: any;
  state: SaveState;
  /** Merge a patch of owned keys. 500ms while typing, 0 for structural edits. */
  patch: (fields: Partial<Record<BrandDocKey, unknown>>, opts?: { debounce?: number }) => void;
  /** Send whatever is pending right now (blur, unmount, before an export). */
  flush: () => Promise<void>;
  /** Replace the row wholesale — for routes that return a whole brand (logo upload, re-scrape). */
  applyRow: (row: Brand) => void;
}

/**
 * The Brand page's one writer.
 *
 * Three things make this more than a debounced PUT:
 *
 * **It overlays rather than snapshots.** The API has no patch: every write is a
 * full-document PUT. A page holding its own copy of `brand.json` therefore
 * re-sends whatever it read at mount, which would quietly undo a catalog import
 * or a product upload that landed while the page was open — both write
 * `products[]` into this same row. So only the keys this page edits are held,
 * and the body is composed against the freshest row at send time.
 *
 * **One timer, not one per section.** Two timers means two compositions, and
 * the later one wins carrying a stale copy of its sibling. Every patch cancels
 * whatever was pending, for the reason the old palette editor documented: an
 * in-flight edit completing after a delete resurrects what was deleted.
 *
 * **A failure keeps the overlay.** Rolling back would erase what is still on
 * screen and still true for the user. The edit stays, the toast offers a retry,
 * and the header keeps saying so rather than letting a toast age out silently.
 */
export function useBrandDoc(): BrandDoc {
  const { brand } = useBrand();
  const { applyBrand } = useAppData();
  const { push } = useToasts();

  const [overlay, setOverlay] = useState<Partial<Record<BrandDocKey, unknown>>>({});
  const [state, setState] = useState<SaveState>('idle');

  // Refs, not state: the timer callback and the unload handler both need the
  // current values and neither may re-subscribe on every keystroke.
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;
  const brandRef = useRef(brand);
  brandRef.current = brand;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef(false);
  const queued = useRef(false);

  const compose = useCallback(() => ({ ...(brandRef.current.json ?? {}), ...overlayRef.current }), []);

  const send = useCallback(async () => {
    if (!Object.keys(overlayRef.current).length) return;
    if (inflight.current) {
      // Coalesce: a fast typist must not stack one PUT per pause.
      queued.current = true;
      return;
    }
    inflight.current = true;
    setState('saving');
    const sent = overlayRef.current;
    try {
      const row = await api.updateBrand(brandRef.current.id, compose());
      applyBrand(row);
      // Only clear what this write actually carried: an edit made while the
      // request was in the air is still pending and still has to be sent.
      setOverlay((cur) => {
        const next = { ...cur };
        for (const k of Object.keys(sent) as BrandDocKey[]) if (cur[k] === sent[k]) delete next[k];
        return next;
      });
      setState(queued.current ? 'pending' : 'idle');
    } catch (e: any) {
      setState('error');
      push({
        kind: 'error',
        title: 'Could not save the brand',
        detail: String(e?.message ?? e),
        action: { label: 'Retry', onClick: () => void send() },
      });
    } finally {
      inflight.current = false;
      if (queued.current) {
        queued.current = false;
        void send();
      }
    }
  }, [applyBrand, compose, push]);

  const patch = useCallback(
    (fields: Partial<Record<BrandDocKey, unknown>>, opts?: { debounce?: number }) => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      const next = { ...overlayRef.current, ...fields };
      overlayRef.current = next;
      setOverlay(next);
      setState('pending');
      const wait = opts?.debounce ?? 0;
      if (wait > 0) timer.current = setTimeout(() => void send(), wait);
      else void send();
    },
    [send],
  );

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    await send();
  }, [send]);

  const applyRow = useCallback(
    (row: Brand) => {
      // The server just returned the whole document, so anything this page was
      // still holding for those keys is now behind it.
      setOverlay({});
      overlayRef.current = {};
      applyBrand(row);
      setState('idle');
    },
    [applyBrand],
  );

  // A brand switch under the same mounted page must not carry the old brand's
  // pending edits onto the new row.
  const brandId = brand.id;
  useEffect(() => {
    setOverlay({});
    overlayRef.current = {};
    setState('idle');
  }, [brandId]);

  useEffect(() => {
    const onLeave = () => {
      if (Object.keys(overlayRef.current).length) saveBrandOnUnload(brandRef.current.id, compose());
    };
    window.addEventListener('beforeunload', onLeave);
    return () => {
      window.removeEventListener('beforeunload', onLeave);
      if (timer.current) clearTimeout(timer.current);
      // Navigating away is not a reason to lose the last edit, and there is no
      // component left to await the answer.
      onLeave();
    };
  }, [compose]);

  return { json: compose(), state, patch, flush, applyRow };
}

/** What the header says, given the save state. */
export function saveLabel(state: SaveState): string {
  if (state === 'saving') return 'Saving…';
  if (state === 'pending') return 'Unsaved changes';
  if (state === 'error') return 'Not saved';
  return 'Saved';
}
