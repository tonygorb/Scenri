import { describe, expect, it } from 'vitest';
import type { SceneReading, SceneStudioJob, SceneStudioJobKind } from '../src/apiTypes.js';
import {
  type Action,
  current,
  deserialize,
  EMPTY,
  readDue,
  reduce,
  serialize,
  type StudioState,
} from '../src/create/scene/sceneStudioRules.js';

/**
 * A seeded random walk over the scene studio's reducer.
 *
 * The states a person sits in while a read or a draw runs are where the
 * defects live, and the order things arrive in is not theirs to choose: a
 * Stop, a late answer for a job already let go, a second press, a reload. The
 * walk throws all of it at `reduce` in random order and checks, after every
 * step, what must never be false.
 */

/** Small, fast and seeded, so a failing walk is a named, repeatable case. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const reading = (n: number): SceneReading => ({
  name: `Place ${n}`,
  prompt: `A place, take ${n}.`,
  lighting: 'Low sun',
  subject: 'either',
  description: 'A place.',
});

const hashOf = (n: number) => n.toString(16).padStart(32, '0');

function step(s: StudioState, r: () => number, n: number): Action {
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const kinds: SceneStudioJobKind[] = ['make', 'again', 'change'];
  const jobId = s.job && r() < 0.8 ? s.job.id : `j${Math.floor(r() * 6)}`;
  const job = (status: SceneStudioJob['status']): SceneStudioJob => ({
    id: jobId,
    brandId: 'b',
    kind: s.job?.kind ?? pick(kinds),
    status,
    phase: status === 'running' ? pick(['reading', 'changing', 'drawing'] as const) : null,
    startedAt: 't',
    phaseAt: 't',
    finishedAt: status === 'running' ? null : 't',
    reading: r() < 0.7 ? reading(n) : null,
    coverage: [],
    hash: r() < 0.6 ? hashOf(n) : null,
    error: status === 'failed' ? 'no' : null,
    warnings: [],
    attachTo: null,
  });
  switch (
    pick([
      'inputs',
      'started',
      'stopping',
      'progress',
      'done',
      'failed',
      'cancelled',
      'lost',
      'put-back',
      'name',
      'forget',
    ])
  ) {
    case 'inputs':
      return { type: 'inputs', place: `a place ${Math.floor(r() * 3)}`, pictures: [] };
    case 'started':
      return { type: 'started', id: `j${Math.floor(r() * 6)}`, kind: pick(kinds), since: 't' };
    case 'stopping':
      return { type: 'stopping', id: jobId };
    case 'progress':
      return { type: 'progress', job: job('running') };
    case 'done':
      return { type: 'finished', job: job('done') };
    case 'failed':
      return { type: 'finished', job: job('failed') };
    case 'cancelled':
      return { type: 'finished', job: job('cancelled') };
    case 'lost':
      return { type: 'lost', id: jobId, error: 'gone' };
    case 'put-back':
      return { type: 'put-back', index: Math.floor(r() * (s.versions.length + 1)) };
    case 'name':
      return { type: 'name', text: `Name ${n}` };
    default:
      return { type: 'forget-record' };
  }
}

describe('the scene studio, walked at random', () => {
  it('never breaks what a person relies on, whatever order the answers come in', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      let s: StudioState = EMPTY;
      for (let n = 0; n < 60; n++) {
        const before = s;
        const a = step(s, r, n);
        s = reduce(s, a);
        const where = `seed ${seed}, step ${n}, ${a.type}`;

        // one piece of work at a time, and a second start never replaces it
        if (a.type === 'started' && before.job) expect(s.job?.id, where).toBe(before.job.id);
        // an answer for work this conversation is not waiting on changes nothing
        if ((a.type === 'finished' || a.type === 'progress') && before.job?.id !== a.job.id)
          expect(s, where).toBe(before);
        // the version on the stage always exists, or there is none
        expect(s.current, where).toBeGreaterThanOrEqual(-1);
        expect(s.current, where).toBeLessThan(Math.max(s.versions.length, 0) || 1);
        if (s.versions.length) expect(current(s), where).not.toBeNull();
        // a drawn picture is only ever let go of by the person (an answer changed under it)
        const drawn = (x: StudioState) => x.versions.filter((v) => v.hash).length;
        if (a.type !== 'forget-record') expect(drawn(s), where).toBeGreaterThanOrEqual(drawn(before));
        // Stopping is said for the job it was pressed for, and ends with it
        if (s.job?.stopping) expect(before.job?.id, where).toBe(s.job.id);
        // the read that starts on its own is never due twice for one revision
        if (s.readTried === s.inputsRev) expect(readDue(s, true), where).toBeNull();
        // and a reload finds exactly this
        expect(deserialize(serialize(s)), where).toEqual(s);
      }
    }
  });
});
