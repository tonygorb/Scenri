import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadImage } from '../api.js';
import {
  clearAssetDraft,
  isNonTrivial,
  loadAssetDraft,
  saveAssetDraft,
  shouldHydrate,
  type CreateKind,
  type PendingState,
} from '../createDraft.js';

export interface AssetFields {
  name: string;
  instruction: string;
  facets: string[];
  imageHashes: string[];
  importUrl: string;
}

const EMPTY: AssetFields = { name: '', instruction: '', facets: [], imageHashes: [], importUrl: '' };

/**
 * The fields of one creation form, the uploads behind them, and the draft that
 * keeps both across a close.
 *
 * Shared by all three flows because all three want the same three things:
 * remember what I typed, upload as I pick rather than on submit, and put it all
 * back if the build I sent it as failed. What the fields *mean* is the form's
 * business; none of that is in here.
 */
export function useAssetFields(
  brandId: string,
  kind: CreateKind,
  opts: {
    max: number;
    pendingState: (jobId: string) => PendingState;
    /**
     * Whether the brand already holds something of this kind by that name.
     *
     * Only consulted for a build the server can no longer account for, where it
     * is the difference between "it landed before the registry forgot it" and
     * "it never finished". Kinds that never submit a pending draft do not need
     * one.
     */
    exists?: (name: string) => boolean;
  },
) {
  const [fields, setFields] = useState<AssetFields>(EMPTY);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<string | null>(null);
  const pendingStateRef = useRef(opts.pendingState);
  pendingStateRef.current = opts.pendingState;
  const existsRef = useRef(opts.exists);
  existsRef.current = opts.exists;
  // How full the strip is right now, for the one reader that runs after an
  // await and so cannot trust what it captured.
  const countRef = useRef(0);
  countRef.current = fields.imageHashes.length;

  // Read once, on mount. The host mounts a form only while its kind is the one
  // showing, so mounting and opening are the same moment.
  useEffect(() => {
    const draft = loadAssetDraft(brandId, kind);
    const state = draft?.pending ? pendingStateRef.current(draft.pending) : null;
    /*
     * A build the server cannot account for is the one ambiguous case, and the
     * library settles it.
     *
     * The registry is an in-memory Map, so a restart between a scene landing
     * and the next poll loses the row while the scene it already wrote stays on
     * disk. Nothing then spends the draft, `unknown` means hand the work back,
     * and a finished scene's references and Direction refill the next New scene
     * — the exact contamination the session lane was introduced to stop.
     *
     * So before refilling, ask whether what this draft was sent to make is
     * already there. Only for `unknown`: a build the server reports as failed
     * or cancelled has a definite answer, and Try again still deserves its
     * photographs back.
     */
    if (draft?.pending && state === 'unknown' && existsRef.current?.(draft.name)) {
      clearAssetDraft(brandId, kind);
      return;
    }
    if (draft && shouldHydrate(draft, state)) {
      pendingRef.current = draft.pending;
      setFields({
        name: draft.name,
        instruction: draft.instruction,
        facets: draft.facets,
        imageHashes: draft.imageHashes,
        importUrl: draft.importUrl,
      });
    }
  }, [brandId, kind]);

  /** Debounced, and never writes an empty shell — a blank form is not a draft. */
  const remember = useCallback(
    (next: AssetFields) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (isNonTrivial(next)) saveAssetDraft(brandId, kind, { ...next, pending: pendingRef.current });
        else clearAssetDraft(brandId, kind);
      }, 400);
    },
    [brandId, kind],
  );

  /**
   * Takes an updater as well as a patch, and everything that edits a list uses
   * the updater form.
   *
   * A patch built from `fields` read at call time is a snapshot, and an upload
   * puts an `await` between reading it and writing it back. Nothing in the
   * dialog is disabled while that upload runs, so a reference removed in the
   * middle of one used to come back when it landed.
   */
  const set = useCallback(
    (patch: Partial<AssetFields> | ((cur: AssetFields) => Partial<AssetFields>)) => {
      setFields((cur) => {
        const next = { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) };
        remember(next);
        return next;
      });
    },
    [remember],
  );

  /** Write now rather than in 400ms — the dialog is closing under us. */
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setFields((cur) => {
      if (isNonTrivial(cur)) saveAssetDraft(brandId, kind, { ...cur, pending: pendingRef.current });
      else clearAssetDraft(brandId, kind);
      return cur;
    });
  }, [brandId, kind]);

  useEffect(() => {
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [flush]);

  const addFiles = useCallback(
    async (files: File[]) => {
      setUploading(true);
      setErr(null);
      try {
        const room = opts.max - countRef.current;
        const added: string[] = [];
        // Sequential: a handful of small uploads is quick, and a failed one
        // should not leave half a set with no way to tell which half.
        for (const f of files.slice(0, room)) added.push(await uploadImage(f));
        // Content-addressed, so the same picture twice is the same hash — drop
        // the twin rather than showing one image in two slots. Merged against
        // the set as it stands now, not as it stood when the upload began.
        set((cur) => ({ imageHashes: [...new Set([...cur.imageHashes, ...added])].slice(0, opts.max) }));
      } catch (e: any) {
        setErr(String(e.message ?? e));
      } finally {
        setUploading(false);
      }
    },
    [opts.max, set],
  );

  const removeHash = useCallback(
    (h: string) => set((cur) => ({ imageHashes: cur.imageHashes.filter((x) => x !== h) })),
    [set],
  );

  const toggleFacet = useCallback(
    (v: string) =>
      set((cur) => ({ facets: cur.facets.includes(v) ? cur.facets.filter((x) => x !== v) : [...cur.facets, v] })),
    [set],
  );

  /**
   * The form went through. A product is finished with its draft; a build is not
   * — it keeps one, marked with the job, so a failure can hand it all back.
   */
  const submitted = useCallback(
    (jobId: string | null) => {
      if (timer.current) clearTimeout(timer.current);
      if (!jobId) {
        clearAssetDraft(brandId, kind);
        pendingRef.current = null;
        setFields(EMPTY);
        return;
      }
      pendingRef.current = jobId;
      setFields((cur) => {
        saveAssetDraft(brandId, kind, { ...cur, pending: jobId });
        return cur;
      });
    },
    [brandId, kind],
  );

  return { fields, set, uploading, err, setErr, addFiles, removeHash, toggleFacet, submitted };
}
