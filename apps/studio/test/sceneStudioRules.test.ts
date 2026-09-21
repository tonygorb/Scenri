import { describe, expect, it } from 'vitest';
import type { SceneReading, SceneStudioJob } from '../src/apiTypes.js';
import {
  type Action,
  current,
  deserialize,
  drawn,
  EMPTY,
  offerOf,
  phaseOf,
  namedIn,
  readAsk,
  keptAsDraft,
  readDue,
  readingLines,
  reduce,
  repeatsLastAsk,
  seeded,
  serialize,
  stale,
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

describe('inputs', () => {
  it('takes the place as the setup gives it, and counts each new one', () => {
    const s = reduce(EMPTY, { type: 'inputs', place: 'a shore', pictures: [H('a'), H('a'), H('b')] });
    expect(s.place).toBe('a shore');
    expect(s.pictures).toEqual([H('a'), H('b')]);
    expect(s.inputsRev).toBe(1);
    expect(reduce(s, { type: 'inputs', place: 'a shore', pictures: [H('a'), H('b')] })).toBe(s);
  });

  it('drops a read that finished after the taps moved', () => {
    const s = reduce(EMPTY, { type: 'inputs', place: 'first', pictures: [] });
    const started = reduce(s, { type: 'started', id: 'j1', kind: 'make', since: 't0' });
    const moved = reduce(started, { type: 'inputs', place: 'second', pictures: [] });
    const landed = reduce(moved, { type: 'finished', job: job({ status: 'done', hash: null, reading: R() }) });
    expect(landed.job).toBeNull();
    expect(landed.versions).toHaveLength(0);
    expect(landed.place).toBe('second');
  });

  it('holds four pictures at most', () => {
    const s = reduce(EMPTY, { type: 'inputs', place: '', pictures: ['1', '2', '3', '4', '5'].map(H) });
    expect(s.pictures).toHaveLength(4);
  });
});

describe('working and landing', () => {
  const started = run(
    EMPTY,
    { type: 'inputs', place: 'a shore', pictures: [] },
    { type: 'started', id: 'j1', kind: 'make', since: 't0' },
  );

  it('is one job at a time: a second start is refused', () => {
    const twice = reduce(started, { type: 'started', id: 'j2', kind: 'make', since: 't1' });
    expect(twice.job?.id).toBe('j1');
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
    expect(current(s)).toMatchObject({ reading: R(), hash: H('a'), how: 'read' });
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

  it('a stopped read is not a fault, and leaves a way back on', () => {
    const s = reduce(started, {
      type: 'finished',
      job: job({ status: 'cancelled', reading: null, hash: null }),
    });
    expect(s.versions).toHaveLength(0);
    expect(s.job).toBeNull();
    expect(s.error).toBe('Stopped before the place was read. Read it again, or say it differently.');
  });

  it('keeps words that already landed when a later draw is stopped', () => {
    const s = reduce(started, {
      type: 'finished',
      job: job({ status: 'cancelled', hash: null }),
    });
    expect(current(s)?.reading).toEqual(R());
    expect(current(s)?.hash).toBeNull();
    expect(s.error).toBeNull();
  });

  it('forgets work the server lost, and says what happened', () => {
    const s = reduce(started, { type: 'lost', id: 'j1', error: 'gone' });
    expect(s.job).toBeNull();
    expect(s.error).toBe('gone');
  });

  it('says Stopping at once, once, for the job it was pressed for', () => {
    const s = reduce(started, { type: 'stopping', id: 'j1' });
    expect(s.job?.stopping).toBe(true);
    expect(reduce(s, { type: 'stopping', id: 'j1' })).toBe(s);
    // a press for work this conversation is not waiting on changes nothing
    expect(reduce(started, { type: 'stopping', id: 'j9' })).toBe(started);
    // and the answer, when it comes, ends it like any other
    const done = reduce(s, { type: 'finished', job: job({ status: 'cancelled', reading: null, hash: null }) });
    expect(done.job).toBeNull();
    // the flag rides a reload, so the pill still says Stopping after one
    expect(deserialize(serialize(s))?.job?.stopping).toBe(true);
  });

  it('keeps the new words of a change stopped while it drew, and says the picture did not come', () => {
    const standing = run(
      EMPTY,
      { type: 'inputs', place: 'a shore', pictures: [] },
      { type: 'started', id: 'j1', kind: 'make', since: 't0' },
      { type: 'finished', job: job({ kind: 'make', hash: null }) },
      { type: 'started', id: 'j2', kind: 'again', since: 't1' },
      { type: 'finished', job: job({ id: 'j2', kind: 'again', hash: H('b') }) },
      { type: 'started', id: 'j3', kind: 'change', ask: 'make it dusk', since: 't2' },
    );
    const s = reduce(standing, {
      type: 'finished',
      job: job({ id: 'j3', kind: 'change', status: 'cancelled', reading: R({ lighting: 'Dusk' }), hash: null }),
    });
    expect(current(s)?.reading.lighting).toBe('Dusk');
    expect(current(s)?.hash).toBeNull();
    expect(s.error).toMatch(/^Stopped before the picture changed/);
    // the picture it was changing is still there to put back
    expect(s.versions.some((v) => v.hash === H('b'))).toBe(true);
  });

  it('a stopped first draw keeps the words and says nothing was drawn', () => {
    const read = run(
      EMPTY,
      { type: 'inputs', place: 'a shore', pictures: [] },
      { type: 'started', id: 'j1', kind: 'make', since: 't0' },
      { type: 'finished', job: job({ kind: 'make', hash: null }) },
      { type: 'started', id: 'j2', kind: 'again', since: 't1' },
    );
    const s = reduce(read, {
      type: 'finished',
      job: job({ id: 'j2', kind: 'again', status: 'cancelled', hash: null }),
    });
    expect(current(s)?.reading).toEqual(R());
    expect(s.error).toBe('Stopped. Nothing was drawn.');
  });
});

describe('the read that starts on its own', () => {
  const given = reduce(EMPTY, { type: 'inputs', place: 'a shore', pictures: [] });

  it('is due once the place is given and nothing is running', () => {
    expect(readDue(given, true)).toBe(1);
    expect(readDue(given, false)).toBeNull();
    expect(readDue(EMPTY, true)).toBeNull();
  });

  it('is not due again for a revision it was started for, even after a reload', () => {
    const tried = reduce(given, { type: 'started', id: 'j1', kind: 'make', since: 't0' });
    expect(readDue(tried, true)).toBeNull();
    const stopped = reduce(tried, { type: 'finished', job: job({ status: 'cancelled', reading: null, hash: null }) });
    expect(readDue(stopped, true)).toBeNull();
    // the page reloads: the session comes back, and the stopped read stays stopped
    const reloaded = deserialize(serialize(stopped));
    expect(reloaded?.readTried).toBe(1);
    expect(readDue(reloaded!, true)).toBeNull();
  });

  it('is due again when what was given changes', () => {
    const tried = run(
      given,
      { type: 'started', id: 'j1', kind: 'make', since: 't0' },
      { type: 'finished', job: job({ status: 'failed', reading: null, hash: null, error: 'no' }) },
    );
    const changed = reduce(tried, { type: 'inputs', place: 'a colder shore', pictures: [] });
    expect(readDue(changed, true)).toBe(2);
  });

  it('is never due while it is read', () => {
    const read = run(
      given,
      { type: 'started', id: 'j1', kind: 'make', since: 't0' },
      { type: 'finished', job: job({ kind: 'make', hash: null }) },
    );
    expect(readDue(read, true)).toBeNull();
  });
});

describe('review', () => {
  const landed = run(
    EMPTY,
    { type: 'inputs', place: 'a shore', pictures: [] },
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
    expect(current(s)).toMatchObject({ reading: R(), hash: H('b'), how: 'again' });
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

  it('a changed answer under the pictures takes them back, keeps the name, and never while work runs', () => {
    const s = run(landed, { type: 'name', text: 'Tide Shelf' }, { type: 'forget-record' });
    expect(s.versions).toEqual([]);
    expect(current(s)).toBeNull();
    expect(drawn(s)).toBe(false);
    expect(s.name).toBe('Tide Shelf');
    const busy = run(landed, { type: 'started', id: 'j9', kind: 'again', since: 't' }, { type: 'forget-record' });
    expect(busy.versions).toEqual(landed.versions);
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

  it('is stale when the place is given again, and offers no Use until it is read', () => {
    const s = reduce(landed, { type: 'inputs', place: 'a beach', pictures: [] });
    expect(stale(s)).toBe(true);
    expect(phaseOf(s)).toBe('writing');
    expect(offerOf(s).can).toBe(false);
  });

  it('calls the first picture a draw and the next an again', () => {
    const words = run(
      EMPTY,
      { type: 'inputs', place: 'x', pictures: [] },
      { type: 'started', id: 'j1', kind: 'make', since: 't' },
      { type: 'finished', job: job({ hash: null }) },
      { type: 'started', id: 'j2', kind: 'again', since: 't' },
      { type: 'finished', job: job({ id: 'j2', kind: 'again', hash: H('b') }) },
      { type: 'started', id: 'j3', kind: 'again', since: 't' },
      { type: 'finished', job: job({ id: 'j3', kind: 'again', hash: H('c') }) },
    );
    expect(words.versions.map((v) => v.how)).toEqual(['read', 'draw', 'again']);
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
    ['call it Stone Hall', 'rename'],
    ['rename it to "Dusk Lobby"', 'rename'],
    ['make the name smaller on the wall sign', 'change'],
  ])('%s is a %s', (text, kind) => {
    expect(readAsk(text).kind).toBe(kind);
  });

  it('takes the name out of a sentence that names the scene, and nothing else', () => {
    expect(namedIn('call it Stone Hall')).toBe('Stone Hall');
    expect(namedIn('Name it Salt Room.')).toBe('Salt Room');
    expect(namedIn('rename it to \u201cDusk Lobby\u201d')).toBe('Dusk Lobby');
    expect(namedIn('rename to Plaster Light')).toBe('Plaster Light');
    expect(namedIn('please call this Low Sun Terrace')).toBe('Low Sun Terrace');
    expect(namedIn('Stone Hall')).toBeNull();
    expect(namedIn('make it warmer')).toBeNull();
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
      { type: 'inputs', place: 'a shore', pictures: [] },
      { type: 'started', id: 'j1', kind: 'make', since: 't0' },
      { type: 'finished', job: job({}) },
    );
    const s = reduce(landed, { type: 'edit-words', reading: R({ prompt: 'A dry basalt shelf.' }) });
    expect(s.versions).toHaveLength(2);
    expect(current(s)).toMatchObject({ reading: { prompt: 'A dry basalt shelf.' }, hash: H('a') });
    expect(reduce(landed, { type: 'edit-words', reading: R({ prompt: '  ' }) })).toBe(landed);
    // one take for the one picture, numbered among pictures, pointing at the newest words it wears
    expect(takesOf(s)).toEqual([{ n: 1, hash: H('a'), current: true }]);
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
    expect(unsaved(reduce(opened, { type: 'inputs', place: 'a shore', pictures: [] }), opened)).toBe(true);
  });
});

describe('the session', () => {
  it('survives a reload whole', () => {
    const s = run(
      EMPTY,
      { type: 'inputs', place: 'a shore', pictures: [H('a')] },
      { type: 'started', id: 'j1', kind: 'make', since: 't0' },
      { type: 'finished', job: job({}) },
      { type: 'started', id: 'j2', kind: 'change', ask: 'warmer', since: 't1' },
    );
    expect(deserialize(serialize(s))).toEqual(s);
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
    if (phase === 'working') expect(s.job).not.toBeNull();
    // only a landing adds a version, and only for the job being waited on
    if (s.versions.length !== before.versions.length && a.type === 'forget-record') {
      // taken back whole, and only with nothing in flight
      expect(before.job).toBeNull();
      expect(s.versions).toEqual([]);
    } else if (s.versions.length !== before.versions.length) {
      expect(['finished', 'edit-words']).toContain(a.type);
      if (a.type === 'finished') expect(before.job?.id).toBe(a.job.id);
      if (a.type === 'edit-words') expect(before.job).toBeNull();
      expect(s.versions.length).toBe(before.versions.length + 1);
    }
    // words change only by a landing, a put back, or the person's own hand
    if (current(s)?.reading !== current(before)?.reading)
      expect(['finished', 'put-back', 'edit-words', 'forget-record']).toContain(a.type);
    // the session round-trips
    expect(deserialize(serialize(s))).toEqual(s);
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
        {
          type: 'inputs',
          place: pick(['', 'a shore', 'a beach at dusk', 'x'.repeat(500)]),
          pictures: [H(pick(['a', 'b', 'c']))],
        },
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
        { type: 'forget-record' },
      ]);
      const next = reduce(s, a);
      check(next, s, a);
      s = next;
    }
  });
});

describe('a draft the wall keeps', () => {
  it('is anything read, drawn, drawing or failed; bare answers are not', () => {
    expect(keptAsDraft(EMPTY)).toBe(false);
    const given = reduce(EMPTY, { type: 'inputs', place: 'a shore', pictures: [] });
    expect(keptAsDraft(given)).toBe(false);
    const reading = reduce(given, { type: 'started', id: 'j1', kind: 'make', since: 't' });
    expect(keptAsDraft(reading)).toBe(true);
    const failed = reduce(reading, {
      type: 'finished',
      job: job({ status: 'failed', reading: null, hash: null, error: 'limit' }),
    });
    expect(keptAsDraft(failed)).toBe(true);
    const read = reduce(reading, { type: 'finished', job: job({ hash: null }) });
    expect(keptAsDraft(read)).toBe(true);
  });
});
