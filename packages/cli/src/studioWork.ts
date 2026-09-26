/**
 * The studios' work, as Activity shows it.
 *
 * A scene drawn in the scene studio and a presenter's views drawn in theirs run
 * on the server whatever the page does, so the bell is where a person who left
 * finds them again: running with what they are doing, then finished, failed or
 * stopped, each leading back to the conversation or the draft it belongs to.
 *
 * Nothing new is kept for this. Both registries already hold what ran; this only
 * says it in one shape, beside the shots and the imports, in the same request.
 */
import type { Core } from '@scenri/core';
import { CORE_VIEWS, HAND_APPROVED, PRESENTER_VIEWS, type PresenterView } from './presenterPrompts.js';
import { getPresenterDraft, presenterDraftRuns } from './presenterDrafts.js';
import type { ExampleJob } from './sceneExamples.js';
import { listSceneStudioJobs, type SceneStudioJob } from './sceneStudio.js';

export interface StudioWork {
  /** `scene:<job>`, `examples:<job>` or `presenter:<draft>:<run>`: one row per run of work, stable while it runs. */
  id: string;
  kind: 'scene' | 'presenter' | 'examples';
  status: 'running' | 'done' | 'failed' | 'cancelled';
  /** What it is doing, or last did: `reading`, `changing`, `drawing`, or a presenter view. */
  step: string | null;
  /** Scene only: the job's kind, so a read that finished is not news. */
  job?: SceneStudioJob['kind'];
  name: string;
  /** The picture the row shows, once there is one. */
  thumb: string | null;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  /** Scene: the studio conversation it belongs to, and the saved scene it edits or landed on. */
  conversation?: string | null;
  sceneId?: string | null;
  attachTo?: string | null;
  /** Presenter: the draft, and the saved presenter it edits. */
  draftId?: string;
  presenterId?: string | null;
  /** Presenter: views decided, of the views the set wants; examples: pictures drawn, of those asked. Real counters, so a real bar. */
  done?: number;
  total?: number;
  /** Presenter: the view that finished is one a person decides (the face, the full body). */
  awaiting?: boolean;
}

function sceneWork(j: SceneStudioJob): StudioWork | null {
  // A read is seconds long and leads straight to a question on the page; once
  // it has worked it is not news anywhere else. While it runs, and if it
  // fails, it is.
  if (j.kind === 'make' && j.status !== 'running' && j.status !== 'failed') return null;
  return {
    id: `scene:${j.id}`,
    kind: 'scene',
    status: j.status,
    step: j.phase,
    job: j.kind,
    name: j.label,
    thumb: j.hash,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
    error: j.error,
    conversation: j.conversation,
    sceneId: j.sceneId,
    attachTo: j.attachTo,
  };
}

function presenterWork(core: Core, brandId: string): StudioWork[] {
  const out: StudioWork[] = [];
  for (const run of presenterDraftRuns(brandId)) {
    const rec = getPresenterDraft(core, run.draftId);
    if (!rec) continue;
    const wanted: readonly PresenterView[] = rec.extras ? PRESENTER_VIEWS : CORE_VIEWS;
    const view = run.view;
    out.push({
      id: `presenter:${run.draftId}:${run.id}`,
      kind: 'presenter',
      status: run.status,
      step: run.status === 'running' ? (view ?? 'reading') : view,
      name: rec.name,
      thumb: rec.views.portrait.hash ?? null,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      error: run.error,
      draftId: rec.id,
      presenterId: rec.presenterId ?? null,
      done: wanted.filter((v) => rec.views[v].status === 'approved').length,
      total: wanted.length,
      awaiting: !!view && HAND_APPROVED.has(view) && rec.views[view].status === 'candidate',
    });
  }
  return out;
}

/** A scene's examples drawing: one row for the run, leading to the scene's page. */
function exampleWork(j: ExampleJob): StudioWork {
  return {
    id: `examples:${j.id}`,
    kind: 'examples',
    status: j.status,
    step: j.current,
    name: j.name,
    // The place it is drawn in, until the page shows the examples themselves.
    thumb: j.from.startsWith('asset:') ? j.from.slice(6) : null,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
    // A set that finished with some pictures missing says so: the bell is where
    // a person who left learns how it went, and "ready" alone would be untrue.
    error: j.error ?? (j.status === 'done' && j.failed.length ? didNotDraw(j.failed.length) : null),
    sceneId: j.sceneId,
    done: j.done.length,
    total: j.roles.length,
  };
}

const didNotDraw = (n: number) => (n === 1 ? 'One example did not draw' : `${n} examples did not draw`);

/**
 * How many finished rows the bell is handed. It keeps its own record of what
 * finished; the answer only has to carry what is running and what just ended,
 * so a finish can be told. Uncapped, a long session's answer grew by about
 * twenty rows every ten minutes and was polled every few seconds.
 */
export const STUDIO_WORK_FINISHED = 40;

/** Everything the studios have running, and the newest of what finished, for a brand, newest first. */
export function listStudioWork(core: Core, brandId: string, examples: readonly ExampleJob[] = []): StudioWork[] {
  const scenes = listSceneStudioJobs(brandId)
    .map(sceneWork)
    .filter((w): w is StudioWork => !!w);
  const all = [...scenes, ...examples.map(exampleWork), ...presenterWork(core, brandId)].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  );
  let finished = 0;
  return all.filter((w) => w.status === 'running' || ++finished <= STUDIO_WORK_FINISHED);
}
