import type { SceneExampleJob, SceneExampleRole } from './api.js';
import type { SceneExampleView } from './brandAssets.js';

/**
 * A scene's examples, as its page and Activity say them.
 *
 * The place is the first picture and it is not one of these: it is the one a
 * person approved with Use this scene. After it come the hero and the
 * close-up, drawn by themselves, then whatever was asked for.
 */
export const EXAMPLE_ORDER: readonly SceneExampleRole[] = ['hero', 'close', 'hands', 'angle', 'bold'];

/** What a tile is called under its picture. */
export const EXAMPLE_LABEL: Record<SceneExampleRole, string> = {
  hero: 'Hero',
  close: 'Close-up',
  hands: 'Hands',
  angle: 'Another angle',
  bold: 'A bold one',
};

/** What the role is called inside a sentence ("Drawing the close-up"). */
const IN_A_SENTENCE: Record<SceneExampleRole, string> = {
  hero: 'hero',
  close: 'close-up',
  hands: 'hands',
  angle: 'other angle',
  bold: 'bold one',
};

export interface ExampleTile {
  role: SceneExampleRole;
  state: 'shown' | 'drawing' | 'failed';
  /** The picture, when there is one; a redraw keeps the old one under the shimmer. */
  url?: string;
  hash?: string;
  earlier?: boolean;
  setup?: string;
  error?: string;
}

/** A role the run has yet to finish, one way or the other. */
const pending = (job: SceneExampleJob | null, role: SceneExampleRole) =>
  !!job &&
  job.status === 'running' &&
  job.roles.includes(role) &&
  !job.done.includes(role) &&
  !job.failed.some((f) => f.role === role);

/**
 * The tiles after the place, in the set's order: every example kept, every
 * one still drawing (so the rail is its final length from the first moment
 * and never jumps), and every one the last run could not draw.
 */
export function exampleTiles(examples: readonly SceneExampleView[] = [], job: SceneExampleJob | null): ExampleTile[] {
  const out: ExampleTile[] = [];
  for (const role of EXAMPLE_ORDER) {
    const kept = examples.find((e) => e.role === role);
    // drawing, or drawn and not yet read back into the brand this page holds
    if (pending(job, role) || (job?.status === 'running' && job.done.includes(role) && !kept)) {
      out.push({ role, state: 'drawing', ...(kept ? { url: kept.url, hash: kept.hash } : {}) });
      continue;
    }
    if (kept) {
      out.push({
        role,
        state: 'shown',
        url: kept.url,
        hash: kept.hash,
        earlier: kept.earlier,
        ...(kept.setup ? { setup: kept.setup } : {}),
      });
      continue;
    }
    const failed = job?.failed.find((f) => f.role === role);
    if (failed) out.push({ role, state: 'failed', error: failed.error });
  }
  return out;
}

/** The roles "Add more" would still draw: offered, not kept, not on their way. */
export function missingMore(
  more: readonly SceneExampleRole[],
  examples: readonly SceneExampleView[] = [],
  job: SceneExampleJob | null,
): SceneExampleRole[] {
  return more.filter((r) => !examples.some((e) => e.role === r) && !pending(job, r));
}

/** The examples drawn from a picture of the place that has since changed. */
export function earlierRoles(examples: readonly SceneExampleView[] = []): SceneExampleRole[] {
  return examples.filter((e) => e.earlier).map((e) => e.role);
}

/** Activity's second line for a scene's examples. */
export function examplesSubtitle(w: {
  status: 'running' | 'done' | 'failed' | 'cancelled';
  step: string | null;
  done?: number;
  total?: number;
  error: string | null;
}): string {
  if (w.status === 'failed') return w.error ?? 'The examples did not draw';
  if (w.status === 'cancelled') return 'Stopped';
  const of = w.total ? ` · ${w.done ?? 0} of ${w.total}` : '';
  if (w.status === 'running') {
    const role = w.step && w.step in IN_A_SENTENCE ? IN_A_SENTENCE[w.step as SceneExampleRole] : null;
    return `${role ? `Drawing the ${role}` : 'Drawing examples'}${of}`;
  }
  return w.done === 1 ? 'One example drawn' : `${w.done ?? 0} examples drawn`;
}
