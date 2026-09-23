import type { StudioWork } from '../../apiTypes.js';
import { forgetSaid } from '../../conversation/Transcript.js';
import { local } from '../../storage.js';
import { unpackSession } from './sceneFlowRules.js';
import { current, keptAsDraft } from './sceneStudioRules.js';

/**
 * Scenes still being made, for the wall to offer back.
 *
 * A scene conversation is kept in this browser under its address
 * (`useSceneFlow`), and its work runs on the server. So a scene closed while it
 * drew, or drawn and left without Use, is unfinished work with no door to it
 * but the bell. The Scenes wall shows each one as a draft card, the way the
 * Presenters wall shows a half-cast person.
 *
 * Only conversations with something in them are cards: a reading, a picture,
 * a draw under way, or a draw that failed (a scene Codex could not draw today
 * is still worth coming back to). Answers alone, before anything is read, are
 * cheap to give again. Edits of a saved scene are not drafts: the scene is
 * already on the wall.
 */
export interface SceneDraft {
  convo: string;
  name: string;
  hash: string | null;
  drawing: boolean;
  failed: boolean;
  /** Its words were read: a draft with no picture yet is still a scene. */
  read: boolean;
  /** The job this conversation last started, to read its state off the bell. */
  jobId: string | null;
  at: number;
}

export const keptPrefix = (brandId: string) => `scenri:scene-studio:${brandId}:`;

/** One kept conversation, read as a draft; null when it is not one. */
export function sceneDraftOf(convo: string, raw: string | null): SceneDraft | null {
  if (!raw) return null;
  let o: any;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (o?.sceneId) return null;
  const session = unpackSession(typeof o?.session === 'string' ? o.session : null);
  const studio = session?.studio;
  if (!studio) return null;
  if (!keptAsDraft(studio)) return null;
  // the picture on the stage, else the newest one drawn
  const drawn = [studio.versions[studio.current], ...[...studio.versions].reverse()].find((v) => v?.hash);
  const v = current(studio);
  const said = studio.place.trim().split(/\s+/).slice(0, 5).join(' ');
  return {
    convo,
    name: studio.name.trim() || v?.reading.name || studio.job?.pending?.name || said,
    hash: drawn?.hash ?? null,
    drawing: !!studio.job,
    failed: !studio.job && !!studio.error,
    read: studio.versions.length > 0,
    jobId: studio.job?.id ?? null,
    at: Number(o.at) || 0,
  };
}

/**
 * The drafts as they stand now: what this browser kept, told what the server
 * knows about the work each one started. A job the server has finished lands
 * here as its picture before the studio is opened again; one the server no
 * longer knows (a restart) is simply not drawing any more. Work running for a
 * conversation this browser does not hold (another tab's) is a draft too.
 */
export function sceneDrafts(kept: SceneDraft[], work: StudioWork[]): SceneDraft[] {
  const byJob = new Map(work.filter((w) => w.kind === 'scene').map((w) => [w.id.slice('scene:'.length), w]));
  const out = kept.map((d) => {
    const w = d.jobId ? byJob.get(d.jobId) : undefined;
    if (!w) return { ...d, drawing: false };
    // the conversation already heard how its last job ended
    if (!d.drawing) return d;
    return {
      ...d,
      name: d.name || w.name,
      hash: w.status === 'done' && w.thumb ? w.thumb : d.hash,
      drawing: w.status === 'running',
      failed: w.status === 'failed',
    };
  });
  const known = new Set(kept.map((d) => d.convo));
  for (const w of work) {
    if (w.kind !== 'scene' || w.status !== 'running' || !w.conversation || w.sceneId || known.has(w.conversation))
      continue;
    known.add(w.conversation);
    out.push({
      convo: w.conversation,
      name: w.name,
      hash: null,
      drawing: true,
      failed: false,
      read: false,
      jobId: w.id.slice('scene:'.length),
      at: Date.parse(w.startedAt) || 0,
    });
  }
  return out.filter((d) => d.drawing || d.hash || d.failed || d.read).sort((a, b) => b.at - a.at);
}

/** Where a scene draft stands, in words. */
export function sceneDraftState(d: SceneDraft): string {
  if (d.drawing) return 'Drawing';
  if (d.failed) return 'Did not finish';
  return d.hash ? 'Drawn, not used yet' : 'Not drawn yet';
}

/** Every conversation this browser keeps for a brand, read as drafts. */
export function keptSceneDrafts(brandId: string): SceneDraft[] {
  const prefix = keptPrefix(brandId);
  return local
    .keys(prefix)
    .map((k) => sceneDraftOf(k.slice(prefix.length), local.get(k)))
    .filter((d): d is SceneDraft => !!d);
}

/** Let a draft go: the conversation and what was said in it. */
export function forgetSceneDraft(brandId: string, convo: string): void {
  const key = `${keptPrefix(brandId)}${convo}`;
  local.del(key);
  forgetSaid(key);
}
