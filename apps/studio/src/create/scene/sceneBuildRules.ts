import type { AssetBuild, AssetBuildFrame } from '../../apiTypes.js';

/**
 * What the scene builder shows for a job in a given state, and what its one
 * primary says. Pure, so the whole decision table sits under a unit test and
 * the component is left with rendering.
 */

export const TARGET_MIN = 4;
export const TARGET_MAX = 6;
/** Inspiration images a person may hand over. The set is built past them. */
export const MAX_UPLOADS = 4;

export type Build = AssetBuild | null | 'loading' | 'gone';
export type Screen = 'entry' | 'seeding' | 'awaiting' | 'viewing' | 'reviewing' | 'saving' | 'failed' | 'gone';

/** Stage to screen. `null` is nothing submitted; `gone` is a job the server no longer has. */
export function screenFor(build: Build): Screen {
  if (build === null) return 'entry';
  if (build === 'gone') return 'gone';
  if (build === 'loading') return 'seeding';
  switch (build.stage) {
    case 'awaiting':
      return 'awaiting';
    case 'viewing':
    case 'consensus':
      return 'viewing';
    case 'reviewing':
      return 'reviewing';
    case 'saving':
    case 'done':
      return 'saving';
    case 'failed':
    case 'cancelled':
      return 'failed';
    default:
      return 'seeding';
  }
}

export function clampTarget(n: number | null | undefined): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return TARGET_MIN;
  return Math.min(TARGET_MAX, Math.max(TARGET_MIN, v));
}

export const landedFrames = (b: AssetBuild): AssetBuildFrame[] =>
  (b.frames ?? []).filter((f) => f.status === 'landed' && !!f.hash);
export const drawingFrame = (b: AssetBuild): AssetBuildFrame | null =>
  (b.frames ?? []).find((f) => f.status === 'drawing') ?? null;
export const seedFrame = (b: AssetBuild): AssetBuildFrame | null =>
  landedFrames(b).find((f) => f.origin === 'seed') ?? null;
/** The frames this build drew and the person kept, by hash. */
export const drawnHashes = (b: AssetBuild): string[] =>
  landedFrames(b)
    .filter((f) => f.origin !== 'upload')
    .map((f) => f.hash as string);
export const figureLed = (b: AssetBuild): boolean => !!b.record?.figure;

/** What sits on the board, in order: the seed, the uploads, the views, then the one being drawn. */
export function boardFrames(b: AssetBuild): AssetBuildFrame[] {
  const landed = landedFrames(b);
  const drawing = drawingFrame(b);
  return [
    ...landed.filter((f) => f.origin === 'seed'),
    ...landed.filter((f) => f.origin === 'upload'),
    ...landed.filter((f) => f.origin === 'view'),
    ...(drawing ? [drawing] : []),
  ];
}

/** "First frame", "View 2", "Reference 1": what a frame is called to a person. */
export function frameLabel(board: AssetBuildFrame[], frame: AssetBuildFrame): string {
  if (frame.origin === 'seed') return 'First frame';
  const kin = board.filter((f) => f.origin === frame.origin && f.status !== 'rejected');
  const n = kin.indexOf(frame) + 1;
  return frame.origin === 'upload' ? `Reference ${n}` : `View ${n}`;
}

/** "Drawing view 2 of 4": the frame being drawn counts as the next one. */
export function viewCounter(b: AssetBuild): { n: number; of: number } {
  const of = clampTarget(b.target);
  return { n: Math.min(of, landedFrames(b).length + 1), of };
}

export function primaryFor(
  screen: Screen,
  ctx: {
    typed: boolean;
    uploads: number;
    name: string;
    busy: boolean;
    canGenerate: boolean;
    build: AssetBuild | null;
    /** Approved drawn frames the draft still holds, for a build that is over. */
    drawn: number;
  },
): { label: string; ready: boolean; blocked?: string } {
  const b = ctx.build;
  switch (screen) {
    case 'entry': {
      const ready = (ctx.typed || ctx.uploads > 0) && !ctx.busy;
      const label = ctx.uploads > 0 && !ctx.typed ? 'Read the references' : 'Draw the world';
      return { label, ready, blocked: ready ? undefined : 'Describe the place, or add an image' };
    }
    case 'seeding': {
      const reading = !b || b.stage === 'queued' || b.stage === 'analyzing';
      return {
        label: reading ? (ctx.uploads > 0 ? 'Reading the references' : 'Reading the direction') : 'Drawing the world',
        ready: false,
      };
    }
    case 'awaiting':
      return { label: 'Yes, this world', ready: !ctx.busy };
    case 'viewing': {
      if (b?.stage === 'consensus') return { label: 'Reading the set', ready: false };
      const { n, of } = b ? viewCounter(b) : { n: 1, of: TARGET_MIN };
      return { label: `Drawing view ${n} of ${of}`, ready: false };
    }
    case 'reviewing': {
      const ready = !!ctx.name.trim() && !ctx.busy;
      return { label: 'Save scene', ready, blocked: ready ? undefined : 'Name this scene' };
    }
    case 'saving':
      return { label: 'Saving', ready: false };
    case 'failed':
    case 'gone':
      return { label: ctx.drawn > 0 ? 'Continue' : 'Try again', ready: !ctx.busy };
  }
}

/**
 * The card's frame unless somebody chose: the seed, else the first upload
 * (never for a world built around a figure, whose cover is its plate), else
 * whatever landed first. `drawn` are frames a resumed build was handed back,
 * which count as drawn whatever their origin says.
 */
export function defaultCover(b: AssetBuild, drawn: readonly string[] = []): string | null {
  const choices = coverChoices(b, drawn);
  if (b.cover && choices.includes(b.cover)) return b.cover;
  return choices[0] ?? null;
}

export function coverChoices(b: AssetBuild, drawn: readonly string[] = []): string[] {
  const landed = landedFrames(b);
  const seed = landed.find((f) => f.origin === 'seed');
  const ordered = [...(seed ? [seed] : []), ...landed.filter((f) => f !== seed)];
  return ordered
    .filter((f) => !figureLed(b) || f.origin !== 'upload' || drawn.includes(f.hash as string))
    .map((f) => f.hash as string);
}

export function canRemove(b: AssetBuild, hash: string): { ok: boolean; redraws: boolean; why?: string } {
  const landed = landedFrames(b);
  const frame = landed.find((f) => f.hash === hash);
  if (!frame) return { ok: false, redraws: false, why: 'Not on the board' };
  if (frame.origin === 'seed')
    return { ok: false, redraws: false, why: 'The first frame stays. Redraw a view instead.' };
  if (landed.length <= 1) return { ok: false, redraws: false, why: 'The last frame stays.' };
  return { ok: true, redraws: landed.length - 1 < clampTarget(b.target) };
}

export function canAddView(b: AssetBuild): { ok: boolean; why?: string } {
  if (drawingFrame(b)) return { ok: false, why: 'Wait for the view that is drawing.' };
  if (landedFrames(b).length >= TARGET_MAX) return { ok: false, why: `${TARGET_MAX} frames is the most a set holds.` };
  return { ok: true };
}

/**
 * Which job to pick back up: the one the URL names, else the one the draft
 * was sent as, else the one scene build this brand has running. A build the
 * server has forgotten still attaches, and shows as gone.
 */
export function resumeDecision(input: {
  param: string | null;
  draftPending: string | null;
  live: readonly Pick<AssetBuild, 'id' | 'kind' | 'finished'>[];
}): { attach: string } | null {
  if (input.param) return { attach: input.param };
  if (input.draftPending) return { attach: input.draftPending };
  const running = input.live.find((b) => b.kind === 'scene' && !b.finished);
  return running ? { attach: running.id } : null;
}

/** The one sentence read to assistive tech when the screen changes. */
export function statusLine(screen: Screen, build: AssetBuild | null): string {
  switch (screen) {
    case 'entry':
      return '';
    case 'seeding':
      return !build || build.stage === 'queued' || build.stage === 'analyzing'
        ? 'Reading the references.'
        : 'Drawing the first frame.';
    case 'awaiting':
      return 'The first frame is ready. Is this the world?';
    case 'viewing': {
      if (build?.stage === 'consensus') return 'Reading the set.';
      const landed = build ? landedFrames(build).length : 0;
      const of = build ? clampTarget(build.target) : TARGET_MIN;
      return landed > 1 ? `View ${landed - 1} of ${of - 1} landed.` : 'Drawing the views.';
    }
    case 'reviewing': {
      const n = build ? landedFrames(build).length : 0;
      return `${n === 1 ? 'One frame' : `${n} frames`}. Name it and save.`;
    }
    case 'saving':
      return 'Saving.';
    case 'failed':
      return build?.stage === 'cancelled' ? 'Stopped.' : 'The build failed.';
    case 'gone':
      return 'This build is gone. The frames you approved are still here.';
  }
}
