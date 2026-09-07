import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type AssetBuild, type SceneBuildReply } from '../../api.js';
import { useTaskCenter } from '../../app/TaskCenter.js';
import type { Build } from './sceneBuildRules.js';

export type BuildAction = 'approve' | 'retry' | 'adjust' | 'remove' | 'addView' | 'finish' | 'cancel';

/**
 * One job, watched through the bell's poll, and the decisions a person makes
 * on it. Each decision answers with the job as it now stands, which is shown
 * until the next poll agrees, so a screen never flickers back to the state a
 * person just left.
 */
export function useSceneBuild(brandId: string, jobId: string | null) {
  const { builds, poke } = useTaskCenter();
  const [direct, setDirect] = useState<AssetBuild | 'gone' | null>(null);
  const [busy, setBusy] = useState<BuildAction | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const seenRef = useRef(false);

  const polled = jobId ? (builds.find((b) => b.id === jobId) ?? null) : null;
  if (polled) seenRef.current = true;

  // One direct ask on attach: the poll may not have this job yet, or may
  // never have it again.
  useEffect(() => {
    setDirect(null);
    setErr(null);
    seenRef.current = false;
    if (!jobId) return;
    let alive = true;
    api
      .assetBuild(brandId, jobId)
      .then((b) => {
        if (!alive) return;
        seenRef.current = true;
        setDirect(b);
      })
      .catch((e: { status?: number }) => {
        if (alive) setDirect(e?.status === 404 ? 'gone' : null);
      });
    return () => {
      alive = false;
    };
  }, [brandId, jobId]);

  // A fresh poll outranks whatever a decision answered with.
  useEffect(() => {
    if (polled) setDirect(null);
  }, [polled]);

  let build: Build = null;
  if (jobId) {
    if (direct === 'gone') build = 'gone';
    else if (direct) build = direct;
    else if (polled) build = polled;
    else build = seenRef.current ? 'gone' : 'loading';
  }

  const act = useCallback(
    async (kind: BuildAction, fn: (id: string) => Promise<SceneBuildReply>) => {
      if (!jobId) return;
      setBusy(kind);
      setErr(null);
      try {
        const r = await fn(jobId);
        setDirect(r.job);
        poke();
      } catch (e: any) {
        setErr(String(e?.message ?? e));
      } finally {
        setBusy(null);
      }
    },
    [jobId, poke],
  );

  const approve = useCallback(() => act('approve', (id) => api.approveSceneBuild(brandId, id)), [act, brandId]);
  const retry = useCallback(
    (frame?: string) => act('retry', (id) => api.retrySceneFrame(brandId, id, frame)),
    [act, brandId],
  );
  const adjust = useCallback(
    (note: string) => act('adjust', (id) => api.adjustSceneBuild(brandId, id, note)),
    [act, brandId],
  );
  const removeFrame = useCallback(
    (hash: string) => act('remove', (id) => api.removeSceneFrame(brandId, id, hash)),
    [act, brandId],
  );
  const addView = useCallback(() => act('addView', (id) => api.addSceneView(brandId, id)), [act, brandId]);
  const finish = useCallback(
    (p: { name: string; cover: string | null; facets?: string[] }) =>
      act('finish', (id) => api.finishSceneBuild(brandId, id, p)),
    [act, brandId],
  );
  const cancel = useCallback(async () => {
    if (!jobId) return;
    setBusy('cancel');
    try {
      await api.cancelAssetBuild(brandId, jobId);
      poke();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  }, [brandId, jobId, poke]);

  return {
    build,
    busy,
    err,
    clearErr: () => setErr(null),
    approve,
    retry,
    adjust,
    removeFrame,
    addView,
    finish,
    cancel,
  };
}
