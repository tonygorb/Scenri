import { describe, expect, it } from 'vitest';
import type { SceneReading, SceneStudioJob } from '../src/apiTypes.js';
import {
  type Action,
  current,
  deserialize,
  EMPTY,
  offerOf,
  phaseOf,
  PICTURES_MAX,
  primaryFor,
  readAsk,
  readingLines,
  reduce,
  repeatsLastAsk,
  seeded,
  serialize,
  stale,
  statusLine,
  type StudioState,
  takesOf,
  unsaved,
  versionOfHash,
} from '../src/create/scene/sceneStudioRules.js';

const R = (over: Partial<SceneReading> = {}): SceneReading => ({
  name: 'Wet Basalt Shore',
  prompt: 'A wet basalt shelf at the waterline.',
  lighting: 'Low sunset',
  subject: 'product',
  description: 'A dark shore.',
  ...over,
});

const job = (over: Partial<SceneStudioJob>): SceneStudioJob => ({
  id: 'j1',
  brandId: 'b',
  kind: 'make',
  status: 'done',
  phase: null,
  startedAt: '2026-09-19T00:00:00Z',
  phaseAt: '2026-09-19T00:00:00Z',
  finishedAt: '2026-09-19T00:00:10Z',
  reading: R(),
  coverage: [],
  hash: 'a'.repeat(32),
  error: null,
  warnings: [],
  attachTo: null,
  ...over,
});

const run = (s: StudioState, ...as: Action[]) => as.reduce(reduce, s);
const H = (c: string) => c.repeat(32);
const caps = { canRead: true, canDraw: true };

describe('writing', () => {
  it('opens on nothing, with the one way on closed and saying why', () => {
    expect(phaseOf(EMPTY)).toBe('writing');
    expect(primaryFor(EMPTY, caps, false)).toEqual({ label: 'Draw the scene', blocked: expect.any(String) });
  });

  it('opens the way on with words, or with a picture', () => {
    expect(primaryFor(run(EMPTY, { type: 'place', text: 'a shore' }), caps, false).blocked).toBeNull();
    expect(primaryFor(run(EMPTY, { type: 'add-pictures', hashes: [H('a')] }), caps, false).blocked).toBeNull();
  });

  it('says a picture alone cannot be read when nothing can read', () => {
    const s = run(EMPTY, { type: 'add-pictures', hashes: [H('a')] });
    expect(primaryFor(s, { canRead: false, canDraw: true }, false).blocked).toMatch(/needs Codex/);
  });

  it('names the press for what the machine can do', () => {
    const s = run(EMPTY, { type: 'place', text: 'a shore' });
    expect(primaryFor(s, { canRead: true, canDraw: false }, false).label).toBe('Read the scene');
    expect(primaryFor(s, { canRead: false, canDraw: false }, false).label).toBe('Continue');
  });

  it('waits for pictures still uploading', () => {
    expect(primaryFor(run(EMPTY, { type: 'place', text: 'x' }), caps, true).blocked).toBe('Waiting for the pictures');
  });

  it('holds four pictures, once each', () => {
    const s = run(EMPTY, { type: 'add-pictures', hashes: [H('a'), H('a'), H('b'), H('c'), H('d'), H('e')] });
    expect(s.pictures).toEqual([H('a'), H('b'), H('c'), H('d')]);
    expect(s.pictures).toHaveLength(PICTURES_MAX);
  });
});

describe('working and landing', () => {
  const started = run(
    EMPTY,
    { type: 'place', text: 'a shore' },
    { type: 'started', id: 'j1', kind: 'make', since: 't0' },
  );

  it('is one job at a time: a second start is refused', () => {
    const twice = reduce(started, { type: 'started', id: 'j2', kind: 'make', since: 't1' });
    expect(twice.job?.id).toBe('j1');
  });

  it('holds the inputs while they are being read', () => {
    const s = run(started, { type: 'place', text: 'a beach' }, { type: 'add-pictures', hashes: [H('a')] });
    expect(s.place).toBe('a shore');
    expect(s.pictures).toEqual([]);
  });

  it('shows the words while the picture draws, and offers Use on them', () => {
    const s = reduce(started, { type: 'progress', job: job({ status: 'running', phase: 'drawing', hash: null }) });
    expect(s.job?.pending?.prompt).toBe(R().prompt);
    expect(s.name).toBe('Wet Basalt Shore');
    expect(offerOf(s).can).toBe(true);
  });

  it('does not offer Use while the words are still being read', () => {
    const s = reduce(started, {
      type: 'progress',
      job: job({ status: 'running', phase: 'reading', reading: null, hash: null }),
    });
    expect(offerOf(s).can).toBe(false);
  });

  it('lands a version as a pair of words and picture', () => {
    const s = reduce(started, { type: 'finished', job: job({}) });
    expect(phaseOf(s)).toBe('review');
    expect(current(s)).toMatchObject({ reading: R(), hash: H('a') });
    expect(statusLine(s)).toBe('The scene is ready');
  });

  it('refuses an answer for work it is no longer waiting on', () => {
    const s = reduce(started, { type: 'finished', job: job({ id: 'someone-else' }) });
    expect(s.versions).toHaveLength(0);
    expect(s.job?.id).toBe('j1');
  });

  it('keeps the words when the picture fails, and says so', () => {
    const s = reduce(started, { type: 'finished', job: job({ status: 'failed', hash: null, error: 'quota' }) });
    expect(current(s)?.reading).toEqual(R());
    expect(current(s)?.hash).toBeNull();
    expect(s.error).toBe('quota');
    expect(offerOf(s).can).toBe(true);
  });

  it('keeps nothing when the reading itself fails', () => {
    const s = reduce(started, {
      type: 'finished',
      job: job({ status: 'failed', reading: null, hash: null, error: 'no' }),
    });
    expect(s.versions).toHaveLength(0);
    expect(phaseOf(s)).toBe('writing');
    expect(s.error).toBe('no');
  });

  it('forgets work the server lost, and says what happened', () => {
    const s = reduce(started, { type: 'lost', id: 'j1', error: 'gone' });
    expect(s.job).toBeNull();
    expect(s.error).toBe('gone');
  });
});

describe('review', () => {
  const landed = run(
    EMPTY,
    { type: 'place', text: 'a shore' },
    { type: 'started', id: 'j1', kind: 'make', since: 't0' },
    { type: 'finished', job: job({}) },
  );

  it('Try again keeps the words and adds a picture', () => {
    const s = run(
      landed,
      { type: 'started', id: 'j2', kind: 'again', since: 't1' },
      { type: 'finished', job: job({ id: 'j2', kind: 'again', reading: R(), hash: H('b') }) },
    );
    expect(s.versions).toHaveLength(2);
    expect(current(s)).toMatchObject({ reading: R(), hash: H('b') });
    expect(s.readRev).toBe(landed.readRev);
  });

  it('a failed Try again changes nothing that stands', () => {
    const s = run(
      landed,
      { type: 'started', id: 'j2', kind: 'again', since: 't1' },
      { type: 'finished', job: job({ id: 'j2', kind: 'again', status: 'failed', hash: null, error: 'x' }) },
    );
    expect(s.versions).toHaveLength(1);
    expect(s.current).toBe(0);
  });

  it('Change something lands new words with their ask', () => {
    const warmer = R({ lighting: 'Early morning, warm' });
    const s = run(
      landed,
      { type: 'started', id: 'j3', kind: 'change', ask: 'warmer', since: 't2' },
      { type: 'finished', job: job({ id: 'j3', kind: 'change', reading: warmer, hash: H('c') }) },
    );
    expect(current(s)).toMatchObject({ reading: warmer, hash: H('c'), ask: 'warmer' });
    expect(repeatsLastAsk(s, ' Warmer ')).toBe(true);
  });

  it('Put back restores the whole pair, and spends nothing', () => {
    const s = run(
      landed,
      { type: 'started', id: 'j2', kind: 'change', ask: 'night', since: 't1' },
      { type: 'finished', job: job({ id: 'j2', kind: 'change', reading: R({ lighting: 'night' }), hash: H('b') }) },
      { type: 'put-back', index: versionOfHash(landed, H('a')) },
    );
    expect(current(s)).toMatchObject({ reading: R(), hash: H('a') });
    expect(takesOf(s)).toEqual([
      { n: 1, hash: H('a'), current: true },
      { n: 2, hash: H('b'), current: false },
    ]);
  });

  it('a name the person typed survives every new reading', () => {
    const s = run(
      landed,
      { type: 'name', text: 'Tide Shelf' },
      { type: 'started', id: 'j2', kind: 'change', ask: 'x', since: 't' },
      { type: 'finished', job: job({ id: 'j2', kind: 'change', reading: R({ name: 'Other' }) }) },
    );
    expect(s.name).toBe('Tide Shelf');
  });

  it('asks for a name before Use', () => {
    const s = reduce(landed, { type: 'name', text: '   ' });
    expect(offerOf(s)).toMatchObject({ can: false, why: 'Name this scene' });
  });

  it('goes back to writing when the place changes, and asks to read again', () => {
    const s = reduce(landed, { type: 'place', text: 'a beach' });
    expect(stale(s)).toBe(true);
    expect(phaseOf(s)).toBe('writing');
    expect(primaryFor(s, caps, false).label).toBe('Read again');
    expect(offerOf(s).can).toBe(false);
  });
});

describe('the one line', () => {
  it.each([
    ['make it warmer', 'change'],
    ['darker walls, raw concrete', 'change'],
    ['no people', 'change'],
    ['a figure seated at the window', 'change'],
    ['a few people far off in the background', 'change'],
    ['remove the logo on the wall', 'change'],
    ['add a model in a red coat', 'refuse'],
    ['put my product on the counter', 'refuse'],
    ['show the brand logo on the wall', 'refuse'],
    ['undo that', 'navigate'],
    ['go back to the first one', 'navigate'],
    ['hi', 'chatter'],
    ['what lens is this?', 'chatter'],
    ['can you make it warmer?', 'change'],
  ])('%s is a %s', (text, kind) => {
    expect(readAsk(text).kind).toBe(kind);
  });
});

describe('the reading, as a person reads it', () => {
  it('lists the place, the light, the camera and the figure', () => {
    const lines = readingLines(
      R({ camera: 'low and wide', figure: 'someone at the ledge.', figureTreatment: 'veiled' }),
    );
    expect(lines.map((l) => l.label)).toEqual(['The place', 'Light', 'Camera', 'Built around']);
    expect(lines[3].text).toBe('someone at the ledge, veiled.');
  });
});

describe('the words, by hand', () => {
  it('keeps them as a new version over the same picture', () => {
    const landed = run(
      EMPTY,
      { type: 'place', text: 'a shore' },
      { type: 'started', id: 'j1', kind: 'make', since: 't0' },
      { type: 'finished', job: job({}) },
    );
    const s = reduce(landed, { type: 'edit-words', reading: R({ prompt: 'A dry basalt shelf.' }) });
    expect(s.versions).toHaveLength(2);
    expect(current(s)).toMatchObject({ reading: { prompt: 'A dry basalt shelf.' }, hash: H('a') });
    expect(reduce(landed, { type: 'edit-words', reading: R({ prompt: '  ' }) })).toBe(landed);
    // one take for the one picture, pointing at the newest words it wears
    expect(takesOf(s)).toEqual([{ n: 2, hash: H('a'), current: true }]);
    expect(versionOfHash(s, H('a'))).toBe(1);
  });
});

describe('editing a saved scene', () => {
  const opened = seeded({ place: 'a shore', pictures: [H('a')], reading: R(), hash: H('b'), name: 'Shore' });

  it('opens in review with nothing spent and nothing to lose', () => {
    expect(phaseOf(opened)).toBe('review');
    expect(unsaved(opened, opened)).toBe(false);
  });

  it('counts a new version, a put back, a new name or new inputs as unsaved', () => {
    expect(unsaved(reduce(opened, { type: 'name', text: 'Tide' }), opened)).toBe(true);
    expect(unsaved(reduce(opened, { type: 'remove-picture', hash: H('a') }), opened)).toBe(true);
  });
});

describe('the session', () => {
  it('survives a reload whole, apart from the one-line replies', () => {
    const s = run(
      EMPTY,
      { type: 'place', text: 'a shore' },
      { type: 'add-pictures', hashes: [H('a')] },
      { type: 'started', id: 'j1', kind: 'make', since: 't0' },
      { type: 'finished', job: job({}) },
      { type: 'started', id: 'j2', kind: 'change', ask: 'warmer', since: 't1' },
      { type: 'say', text: 'hello' },
    );
    const back = deserialize(serialize(s));
    expect(back).toEqual({ ...s, said: null });
  });

  it('drops what it cannot trust', () => {
    expect(deserialize('{nope')).toBeNull();
    expect(deserialize(JSON.stringify({ v: 99 }))).toBeNull();
    const odd = deserialize(JSON.stringify({ v: 1, versions: [{ reading: 3 }], current: 7, pictures: [1, 'x'] }));
    expect(odd?.versions).toEqual([]);
    expect(odd?.current).toBe(-1);
    expect(odd?.pictures).toEqual(['x']);
  });
});

/**
 * The walk: thousands of actions a person and a network could produce in any
 * order, including answers that arrive late, twice, or for the wrong job.
 * After every step the invariants the break-it phase names must hold.
 */
describe('a random walk over everything that can happen', () => {
  const rng = (seed: number) => () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const check = (s: StudioState, before: StudioState, a: Action) => {
    // the index always points at a version, or at nothing when there are none
    expect(s.current).toBeGreaterThanOrEqual(-1);
    expect(s.current).toBeLessThan(Math.max(1, s.versions.length));
    if (s.versions.length) expect(s.current).toBeGreaterThanOrEqual(0);
    // review always has a version to show
    if (phaseOf(s) === 'review') expect(current(s)).not.toBeNull();
    // Use is never open without words and a name
    const offer = offerOf(s);
    if (offer.can) {
      expect(offer.words).not.toBeNull();
      expect(s.name.trim()).not.toBe('');
    }
    // never silently stuck: every state has a way on, or says why not
    const phase = phaseOf(s);
    if (phase === 'writing') {
      const p = primaryFor(s, caps, false);
      if (p.blocked) expect(p.blocked.length).toBeGreaterThan(0);
    }
    if (phase === 'working') expect(s.job).not.toBeNull();
    // only a landing adds a version, and only for the job being waited on
    if (s.versions.length !== before.versions.length) {
      expect(['finished', 'edit-words']).toContain(a.type);
      if (a.type === 'finished') expect(before.job?.id).toBe(a.job.id);
      if (a.type === 'edit-words') expect(before.job).toBeNull();
      expect(s.versions.length).toBe(before.versions.length + 1);
    }
    // words change only by a landing, a put back, or the person's own hand
    if (current(s)?.reading !== current(before)?.reading)
      expect(['finished', 'put-back', 'edit-words']).toContain(a.type);
    // inputs never move while something is reading them
    if (before.job && a.type !== 'finished' && a.type !== 'lost') {
      expect(s.place).toBe(before.place);
      expect(s.pictures).toEqual(before.pictures);
    }
    // the session round-trips
    expect(deserialize(serialize(s))).toEqual({ ...s, said: null });
  };

  it.each([1, 7, 42, 1234, 99991])('holds for seed %i', (seed) => {
    const r = rng(seed);
    const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    let s: StudioState = EMPTY;
    let ids = 0;
    for (let step = 0; step < 2000; step++) {
      const jobId = s.job && r() < 0.8 ? s.job.id : `j${ids}`;
      const kind = s.job?.kind ?? 'make';
      const a: Action = pick<Action>([
        { type: 'place', text: pick(['', 'a shore', 'a beach at dusk', 'x'.repeat(500)]) },
        { type: 'add-pictures', hashes: [H(pick(['a', 'b', 'c', 'd', 'e']))] },
        { type: 'remove-picture', hash: H(pick(['a', 'b', 'c'])) },
        { type: 'name', text: pick(['', 'Tide', 'y'.repeat(90)]) },
        {
          type: 'started',
          id: `j${++ids}`,
          kind: pick(['make', 'again', 'change'] as const),
          ask: 'warmer',
          since: 't',
        },
        {
          type: 'progress',
          job: job({
            id: jobId,
            status: 'running',
            phase: pick(['reading', 'drawing'] as const),
            hash: null,
            reading: r() < 0.5 ? R() : null,
          }),
        },
        {
          type: 'finished',
          job: job({
            id: jobId,
            kind,
            status: pick(['done', 'failed', 'cancelled'] as const),
            reading: r() < 0.8 ? R({ prompt: `words ${step}` }) : null,
            hash: r() < 0.7 ? H(pick(['1', '2', '3', '4', '5', '6'])) : null,
          }),
        },
        { type: 'lost', id: jobId, error: 'gone' },
        { type: 'put-back', index: Math.floor(r() * (s.versions.length + 2)) - 1 },
        { type: 'edit-words', reading: R({ prompt: pick(['', 'hand written', `hand ${step}`]) }) },
        { type: 'say', text: pick([null, 'hello']) },
      ]);
      const next = reduce(s, a);
      check(next, s, a);
      s = next;
    }
  });
});
