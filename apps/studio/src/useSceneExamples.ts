import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type SceneExampleJob, type SceneExampleRole } from './api.js';
import { useAppData } from './app/AppShell.js';

const RUNNING_MS = 1500;

/**
 * A saved scene's examples as the server is drawing them: the run, what each
 * offer would draw, and a way to read it again at once after asking for work.
 *
 * It only ever reads. Nothing here draws, because a picture is spent quota and
 * every one of them is a press somewhere a person can see it.
 *
 * Read on arrival, again whenever the place picture changes, and every second
 * and a half while a run draws. A read that fails is asked again, a little
 * later: one dropped request used to end the watch for good, and the run
 * stayed "drawing" long after it had finished.
 *
 * Each example lands in the brand document. While the run draws, the bell
 * reads the brand once per example that lands (TaskCenter), and a tile shows
 * its shimmer until the brand it holds has the picture (`exampleTiles`). When
 * the run ends, the brand is read here before the ended run is handed back,
 * so the last tile never loses its shimmer before its picture is there. The
 * scene studio's conversation and the scene's page both read it.
 */
export function useSceneExamples(brandId: string, sceneId: string | null, place: string | null) {
  const { refreshBrands } = useAppData();
  const [job, setJob] = useState<SceneExampleJob | null>(null);
  const [first, setFirst] = useState<SceneExampleRole[]>([]);
  const [more, setMore] = useState<SceneExampleRole[]>([]);
  /** The first answer is in: before it, "nothing is drawing" is not known yet. */
  const [read, setRead] = useState(false);
  const [asked, setAsked] = useState(0);
  /** Work was just asked for and the run it started is not read back yet. */
  const [waiting, setWaiting] = useState(false);
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
        const mark = r.job ? `${r.job.id}:${r.job.status}` : null;
        const ended = r.job && r.job.status !== 'running';
        if (ended && landed.current !== undefined && mark !== landed.current) await refreshRef.current();
        if (!alive) return;
        landed.current = mark;
        setJob(r.job);
        setFirst(r.first);
        setMore(r.more);
        setRead(true);
        setWaiting(false);
        if (r.job?.status === 'running') timer = setTimeout(tick, RUNNING_MS);
      } catch (e: any) {
        // What the brand holds still shows, and the next ask tells the truth.
        // A scene that is gone has nothing more to tell.
        if (alive && e?.status !== 404) timer = setTimeout(tick, RUNNING_MS * 2);
      }
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [brandId, sceneId, place, asked]);

  /** Read the run again now: something here just asked for work. */
  const again = useCallback(() => {
    setWaiting(true);
    setAsked((n) => n + 1);
  }, []);
  return { job, first, more, read, waiting, again };
}
