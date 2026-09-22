import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type SceneExampleJob, type SceneExampleRole } from './api.js';
import { useAppData } from './app/AppShell.js';

const RUNNING_MS = 1500;

/**
 * A saved scene's examples as the server is drawing them: the run, what Add
 * more would draw, and a way to read it again at once after asking for work.
 *
 * Read on arrival, again whenever the place picture changes, and every second
 * and a half while a run draws. Each example lands in the brand document, so
 * the brand is read before a newer run state is handed back: a tile or a turn
 * never loses its shimmer before the picture it waits for is there. The scene
 * studio's conversation and the scene's page both read it.
 */
export function useSceneExamples(brandId: string, sceneId: string | null, place: string | null) {
  const { refreshBrands } = useAppData();
  const [job, setJob] = useState<SceneExampleJob | null>(null);
  const [more, setMore] = useState<SceneExampleRole[]>([]);
  /** The first answer is in: before it, "nothing is drawing" is not known yet. */
  const [read, setRead] = useState(false);
  const [asked, setAsked] = useState(0);
  /** The run as last handed back; undefined until the first read, which the brand already covers. */
  const landed = useRef<string | null | undefined>(undefined);
  const refreshRef = useRef(refreshBrands);
  refreshRef.current = refreshBrands;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the place picture and `asked` are the triggers, read on purpose
  useEffect(() => {
    if (!sceneId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const r = await api.sceneExamples(brandId, sceneId);
        if (!alive) return;
        const mark = r.job ? `${r.job.id}:${r.job.done.length}:${r.job.status}` : null;
        if (mark && landed.current !== undefined && mark !== landed.current) await refreshRef.current();
        if (!alive) return;
        landed.current = mark;
        setJob(r.job);
        setMore(r.more);
        setRead(true);
        if (r.job?.status === 'running') timer = setTimeout(tick, RUNNING_MS);
      } catch {
        // what the brand holds still shows; the next ask tells the truth
      }
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [brandId, sceneId, place, asked]);

  /** Read the run again now: something here just asked for work. */
  const again = useCallback(() => setAsked((n) => n + 1), []);
  return { job, more, read, again };
}
