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
  opts: { max: number; pendingState: (jobId: string) => PendingState },
) {
  const [fields, setFields] = useState<AssetFields>(EMPTY);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<string | null>(null);
  const pendingStateRef = useRef(opts.pendingState);
  pendingStateRef.current = opts.pendingState;

  // Read once, on mount. The host mounts a form only while its kind is the one
  // showing, so mounting and opening are the same moment.
  useEffect(() => {
    const draft = loadAssetDraft(brandId, kind);
    const state = draft?.pending ? pendingStateRef.current(draft.pending) : null;
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

  const set = useCallback(
    (patch: Partial<AssetFields>) => {
      setFields((cur) => {
        const next = { ...cur, ...patch };
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
        const room = opts.max - fields.imageHashes.length;
        const added: string[] = [];
        // Sequential: a handful of small uploads is quick, and a failed one
        // should not leave half a set with no way to tell which half.
        for (const f of files.slice(0, room)) added.push(await uploadImage(f));
        // Content-addressed, so the same picture twice is the same hash — drop
        // the twin rather than showing one image in two slots.
        set({ imageHashes: [...new Set([...fields.imageHashes, ...added])].slice(0, opts.max) });
      } catch (e: any) {
        setErr(String(e.message ?? e));
      } finally {
        setUploading(false);
      }
    },
    [fields.imageHashes, opts.max, set],
  );

  const removeHash = useCallback(
    (h: string) => set({ imageHashes: fields.imageHashes.filter((x) => x !== h) }),
    [fields.imageHashes, set],
  );

  const toggleFacet = useCallback(
    (v: string) =>
      set({ facets: fields.facets.includes(v) ? fields.facets.filter((x) => x !== v) : [...fields.facets, v] }),
    [fields.facets, set],
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
