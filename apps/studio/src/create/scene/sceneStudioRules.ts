import type { SceneReading, SceneStudioJob, SceneStudioJobKind } from '../../apiTypes.js';
import { COPY } from './sceneCopy.js';

/**
 * The scene studio's state, and everything the surface derives from it.
 *
 * Pure: no fetch, no storage, no clock. The hook owns the edges; this owns the
 * rules, and a random walk over `reduce` holds the invariants the break-it
 * phase names (`test/sceneStudioWalk.test.ts`).
 *
 * The model is three live states and nothing else:
 *   writing  the place is being given (the setup conversation owns that)
 *   working  one job is running: reading, changing, drawing
 *   review   a version stands: its words, and its picture once drawn
 * A failure is a line, not a state. There is no candidate-versus-approved
 * split: the version standing is the candidate until Use.
 */

/** Pictures a scene is read from. Style references are one to four everywhere that measured it. */
export const PICTURES_MAX = 4;
/** The person's words about the place, as the record stores them. */
export const PLACE_MAX = 400;
export const ASK_MAX = 400;
export const NAME_MAX = 60;

/**
 * How a version came to be, which is how the conversation tells it: the place
 * read, the words drawn for the first time, drawn again, changed by a sentence,
 * or written over by hand.
 */
export type VersionHow = 'read' | 'draw' | 'again' | 'change' | 'edit';

/** One version: the words and the picture drawn from them, always as a pair. */
export interface Version {
  reading: SceneReading;
  /** None when nothing could draw, or the draw was stopped or failed after the words landed. */
  hash: string | null;
  /** The sentence that made it, for a change. */
  ask?: string;
  coverage: string[];
  how: VersionHow;
}

/** The work in flight, and what it was started from, so its answer is checked against now. */
export interface JobRef {
  id: string;
  kind: SceneStudioJobKind;
  ask?: string;
  /** The inputs' revision when it started. A `make` answer from older inputs is refused. */
  inputsRev: number;
  /** The words landed before the picture: shown while it draws. */
  pending: SceneReading | null;
  coverage: string[];
  phase: SceneStudioJob['phase'];
  /** When the phase on the clock started. */
  since: string | null;
  /** Stop was pressed and its answer has not come back yet. */
  stopping?: boolean;
}

export interface StudioState {
  /** The person's own words about the place. The deciding word, stored as `instruction`. */
  place: string;
  pictures: string[];
  /** Bumps whenever the place or the pictures change. */
  inputsRev: number;
  /** The inputs' revision the standing words were read from; null before any reading. */
  readRev: number | null;
  /**
   * The inputs' revision a read was last started for. Kept with the session, so
   * the one read that starts on its own starts once per revision of what was
   * given, not once per mount: a read that was stopped, or that failed, used to
   * start again by itself after a reload or a Back.
   */
  readTried: number | null;
  versions: Version[];
  /** Index into `versions`; -1 before the first. */
  current: number;
  name: string;
  /** The person typed the name, so a new reading no longer suggests one. */
  named: boolean;
  job: JobRef | null;
  error: string | null;
}

export const EMPTY: StudioState = {
  place: '',
  pictures: [],
  inputsRev: 0,
  readRev: null,
  readTried: null,
  versions: [],
  current: -1,
  name: '',
  named: false,
  job: null,
  error: null,
};

/** A saved scene, opened in the studio: its words and its picture as version one, nothing spent. */
export function seeded(input: {
  place: string;
  pictures: string[];
  reading: SceneReading;
  hash: string | null;
  name: string;
}): StudioState {
  return {
    ...EMPTY,
    place: input.place,
    pictures: input.pictures,
    readRev: 0,
    versions: [{ reading: input.reading, hash: input.hash, coverage: [], how: 'read' }],
    current: 0,
    name: input.name,
    named: true,
  };
}

export type Action =
  /** What the place was given as, from the setup: its sentence and its pictures. */
  | { type: 'inputs'; place: string; pictures: string[] }
  | { type: 'name'; text: string }
  | { type: 'started'; id: string; kind: SceneStudioJobKind; ask?: string; since: string }
  /** Stop was pressed for this job; its answer is on the way. */
  | { type: 'stopping'; id: string }
  | { type: 'progress'; job: SceneStudioJob }
  | { type: 'finished'; job: SceneStudioJob }
  | { type: 'lost'; id: string; error: string }
  | { type: 'put-back'; index: number }
  /** The words written over by hand: a new version with the same picture, nothing spent. */
  | { type: 'edit-words'; reading: SceneReading }
  /** The answers the pictures were drawn from changed; the conversation reads forward, so they go. */
  | { type: 'forget-record' }
  | { type: 'error'; text: string | null };

export const current = (s: StudioState): Version | null => s.versions[s.current] ?? null;

/** Whether anything has been drawn in this conversation. */
export const drawn = (s: StudioState): boolean => s.versions.some((v) => !!v.hash);

/**
 * The inputs revision that should be read now, on its own, or null.
 *
 * The one autonomous step the studio takes: a place given and not read yet is
 * read, once per revision of what was given. Never while work runs, never
 * again for a revision a read was already started for (`readTried`, kept with
 * the session), so a read that was stopped or failed asks rather than starting
 * over after a reload or a Back.
 */
export function readDue(s: StudioState, ready: boolean): number | null {
  if (!ready || s.job || s.inputsRev === 0) return null;
  if (s.readRev !== null && s.readRev === s.inputsRev) return null;
  if (s.readTried === s.inputsRev) return null;
  return s.inputsRev;
}

/** The words were read from inputs that have since changed. */
export const stale = (s: StudioState): boolean => s.readRev !== null && s.readRev !== s.inputsRev;

export type Phase = 'writing' | 'working' | 'review';

export function phaseOf(s: StudioState): Phase {
  if (s.job) return 'working';
  if (current(s) && !stale(s)) return 'review';
  return 'writing';
}

export function reduce(s: StudioState, a: Action): StudioState {
  switch (a.type) {
    case 'inputs': {
      const place = a.place.slice(0, PLACE_MAX);
      const pictures = [...new Set(a.pictures)].slice(0, PICTURES_MAX);
      if (place === s.place && pictures.join() === s.pictures.join()) return s;
      return { ...s, place, pictures, inputsRev: s.inputsRev + 1 };
    }
    case 'name':
      return { ...s, name: a.text.slice(0, NAME_MAX), named: true };
    case 'started':
      // One press is one act: a second start while one runs is refused here
      // too, not only by the disabled button.
      if (s.job) return s;
      return {
        ...s,
        job: {
          id: a.id,
          kind: a.kind,
          ask: a.ask,
          inputsRev: s.inputsRev,
          pending: null,
          coverage: [],
          phase: a.kind === 'again' ? 'drawing' : a.kind === 'change' ? 'changing' : 'reading',
          since: a.since,
        },
        readTried: a.kind === 'make' ? s.inputsRev : s.readTried,
        error: null,
      };
    case 'stopping':
      if (!s.job || s.job.id !== a.id || s.job.stopping) return s;
      return { ...s, job: { ...s.job, stopping: true } };
    case 'progress': {
      if (!s.job || s.job.id !== a.job.id) return s;
      const job = {
        ...s.job,
        pending: a.job.reading ?? s.job.pending,
        coverage: a.job.coverage ?? s.job.coverage,
        phase: a.job.phase,
        since: a.job.phaseAt ?? s.job.since,
      };
      return suggestName({ ...s, job }, job.pending);
    }
    case 'finished': {
      // An answer for work this conversation is no longer waiting on is not
      // this conversation's: a reload, a Stop, a second tab.
      if (!s.job || s.job.id !== a.job.id) return s;
      const ref = s.job;
      const j = a.job;
      const base = { ...s, job: null };
      // The taps moved while this read ran: keep the brief they are on now.
      if (ref.kind === 'make' && ref.inputsRev !== s.inputsRev) return base;
      const reading = j.reading ?? (ref.kind === 'again' ? (current(s)?.reading ?? null) : null);
      const failed = j.status === 'failed' ? (j.error ?? COPY.failed) : null;
      // Stop is not a fault: if nothing landed, the conversation has to stay
      // open with a way back on. A cancelled draw that already has words keeps
      // those words; a cancelled read or a cancelled Try again keeps the stage
      // as it was and asks again.
      if (j.status === 'cancelled') {
        if (!reading) return { ...base, error: ref.kind === 'make' ? COPY.stoppedRead : COPY.stopped };
        if (ref.kind === 'again' && !j.hash) return { ...base, error: COPY.stoppedDraw };
      }
      // A change stopped while it drew: the words it read stand as their own
      // version, and the line says the picture did not come.
      const stoppedMid = j.status === 'cancelled' && ref.kind === 'change' && !j.hash;
      // Nothing landed that can stand: the words stay as they were, and so does
      // the version on the stage.
      if (!reading || (ref.kind === 'again' && !j.hash)) return { ...base, error: failed };
      const how: VersionHow =
        ref.kind === 'make'
          ? 'read'
          : ref.kind === 'change'
            ? 'change'
            : s.versions.some((x) => x.hash)
              ? 'again'
              : 'draw';
      const version: Version = {
        reading,
        hash: j.hash,
        ask: ref.kind === 'change' ? ref.ask : undefined,
        coverage: j.coverage?.length ? j.coverage : ref.kind === 'again' ? (current(s)?.coverage ?? []) : [],
        how,
      };
      const standing = current(s);
      const replaceDraft = ref.kind === 'make' && !j.hash && standing && !standing.hash && standing.how === 'read';
      const versions = replaceDraft
        ? s.versions.map((v, i) => (i === s.current ? version : v))
        : [...s.versions, version];
      const next: StudioState = {
        ...base,
        versions,
        current: replaceDraft ? s.current : versions.length - 1,
        // a make reads the inputs as they stood when it started; the other two keep the reading's own age
        readRev: ref.kind === 'make' ? ref.inputsRev : s.readRev,
        error: stoppedMid ? COPY.stoppedChange : failed,
      };
      return suggestName(next, reading);
    }
    case 'lost':
      if (!s.job || s.job.id !== a.id) return s;
      return { ...s, job: null, error: a.error };
    case 'put-back':
      if (s.job || !s.versions[a.index]) return s;
      return { ...s, current: a.index };
    case 'forget-record':
      if (s.job || !s.versions.length) return s;
      return { ...s, versions: [], current: -1, error: null };
    case 'edit-words': {
      const v = current(s);
      if (s.job || !v || !a.reading.prompt.trim()) return s;
      if (JSON.stringify(a.reading) === JSON.stringify(v.reading)) return s;
      const versions = [
        ...s.versions,
        { reading: a.reading, hash: v.hash, coverage: v.coverage, how: 'edit' as const },
      ];
      return { ...s, versions, current: versions.length - 1 };
    }
    case 'error':
      return { ...s, error: a.text };
  }
}

/** The reading's name, until the person gives their own. */
function suggestName(s: StudioState, reading: SceneReading | null): StudioState {
  if (s.named || !reading?.name) return s;
  return { ...s, name: reading.name.slice(0, NAME_MAX) };
}

/* ------------------------------------------------------------ the surface */

/** What this machine can do, as the flow needs to know it. */
export interface Caps {
  canRead: boolean;
  canDraw: boolean;
}

/**
 * Whether Use is open, and why not.
 *
 * Open once words stand. While a picture is still drawing from words that
 * have landed, Use saves those words now and the picture lands on the card
 * when it is done: nobody has to wait for a preview they did not need.
 */
export function offerOf(s: StudioState): { can: boolean; why: string | null; words: SceneReading | null } {
  const words = s.job ? (s.job.phase === 'drawing' ? s.job.pending : null) : (current(s)?.reading ?? null);
  if (!words) return { can: false, why: s.job ? COPY.stillReading : null, words: null };
  if (!s.job && stale(s)) return { can: false, why: COPY.stillReading, words };
  if (!s.name.trim()) return { can: false, why: COPY.nameIt, words };
  return { can: true, why: null, words };
}

/** What the stage pill says while it works. */
export const doingLine = (s: StudioState): string | undefined =>
  s.job
    ? s.job.phase === 'changing'
      ? COPY.changing
      : s.job.phase === 'drawing'
        ? COPY.drawing
        : s.pictures.length
          ? COPY.readingPhotos
          : COPY.reading
    : undefined;

/**
 * The pictures the versions wore, for the control on the stage.
 *
 * One take per picture: words written over by hand keep the picture they were
 * written under, so two versions can share one, and the take points at the
 * latest of them. A version with no picture has nothing to step to.
 */
export function takesOf(s: StudioState): { n: number; hash: string; current: boolean }[] {
  const last = new Map<string, number>();
  s.versions.forEach((v, i) => {
    if (v.hash) last.set(v.hash, i);
  });
  const at = current(s)?.hash ?? null;
  return [...last.entries()].sort((a, b) => a[1] - b[1]).map(([hash], k) => ({ n: k + 1, hash, current: hash === at }));
}

/** A picture's number among the pictures, which is how a person counts them. */
export const pictureNumber = (s: StudioState, index: number): number =>
  s.versions.slice(0, index + 1).filter((v) => !!v.hash).length;

/** The version a picture belongs to, for Put back: the latest one that wears it. */
export const versionOfHash = (s: StudioState, hash: string): number => s.versions.map((v) => v.hash).lastIndexOf(hash);

/** The words to show: the ones landing while a picture draws, else the ones standing. */
export function shownReading(s: StudioState): SceneReading | null {
  return s.job?.pending ?? current(s)?.reading ?? null;
}

/** The reading as a person reads it: the place, then the light, the camera, and the figure if there is one. */
export function readingLines(r: SceneReading): { label: string; text: string }[] {
  const lines = [{ label: COPY.placeLabel, text: r.prompt }];
  if (r.lighting) lines.push({ label: COPY.lightLabel, text: r.lighting });
  if (r.camera) lines.push({ label: COPY.cameraLabel, text: r.camera });
  if (r.figure)
    lines.push({
      label: COPY.figureLabel,
      text: r.figureTreatment ? `${trimStop(r.figure)}, ${trimStop(r.figureTreatment)}.` : r.figure,
    });
  return lines;
}

const trimStop = (t: string) => t.replace(/[.\s]+$/, '');

/* ---------------------------------------------------------- the one line */

/**
 * Casting and merchandise. A figure, a crowd far off, a table dressed for two
 * are the scene's own words (a position, ambient presence) and go through; a
 * presenter, a model or the brand's product is an identity, which a scene must
 * never carry.
 */
const CAST = /\b(presenters?|models?|influencers?|celebrit(y|ies)|actors?|actress(es)?)\b/i;
const PRODUCT =
  /\b(my|our|the|a|an)\s+(\w+\s+)?(products?|bottles?|serum|perfume|shoes?|bag|jar|packaging|package|logos?|brand|brand name|wordmark)\b/i;
const ADD = /\b(add|put|place|include|show|feature|with|holding|wearing|sitting|standing)\b/i;
const NEGATED = /\b(no|without|remove|removing|empty|nobody|none|take out|get rid of|less)\b/i;
const NAVIGATE = /^\s*(undo|go back|revert|back to|previous|the (first|last|previous|old|earlier) (one|version))\b/i;
const CHATTER = /^\s*(hi|hello|hey|thanks|thank you|ok|okay|cool|nice|great|good|wow|yes|no)\b[\s!.]*$/i;
const RENAME =
  /^(?:please\s+)?(?:(?:call|name)\s+(?:it|this|the\s+scene)|rename(?:\s+(?:it|this|the\s+scene))?)\s+(?:to\s+|as\s+)?["'\u201c\u2018]?(.+?)["'\u201d\u2019]?[.!]?$/i;

/** The name in a sentence that names the scene ("call it Stone Hall"), or null. */
export const namedIn = (text: string): string | null => RENAME.exec(text.trim())?.[1]?.trim() || null;

/**
 * What a sentence in the change line is, before anything is spent on it.
 *
 * A scene is a place and its light. A sentence asking to put someone or
 * something in it belongs to Create, where people and products are attached
 * with their own identities; drawing it here would teach the scene a person
 * or a product it must never carry. A request to go back is Put back, which
 * spends nothing. A question or a greeting gets one line, never a draw. A
 * sentence that names it names it. What is left is a change.
 */
export function readAsk(
  text: string,
): { kind: 'change' } | { kind: 'rename'; name: string } | { kind: 'refuse' | 'navigate' | 'chatter'; say: string } {
  const t = text.trim();
  const name = namedIn(t);
  if (name) return { kind: 'rename', name };
  if (NAVIGATE.test(t)) return { kind: 'navigate', say: COPY.usePutBack };
  if (CHATTER.test(t) || (/\?\s*$/.test(t) && !/\b(make|can you|could you|try)\b/i.test(t)))
    return { kind: 'chatter', say: COPY.sayAChange };
  if ((CAST.test(t) || PRODUCT.test(t)) && ADD.test(t) && !NEGATED.test(t))
    return { kind: 'refuse', say: COPY.notInAScene };
  return { kind: 'change' };
}

/** The same sentence as the one that made the standing version is Try again, not a second change. */
export const repeatsLastAsk = (s: StudioState, ask: string): boolean =>
  !!current(s)?.ask && current(s)!.ask!.trim().toLowerCase() === ask.trim().toLowerCase();

/** Whether leaving now would throw away something the person made. */
export const unsaved = (s: StudioState, seededFrom: StudioState | null): boolean => {
  if (seededFrom)
    return (
      s.versions.length > seededFrom.versions.length ||
      s.current !== seededFrom.current ||
      s.place !== seededFrom.place ||
      s.pictures.join() !== seededFrom.pictures.join() ||
      s.name !== seededFrom.name ||
      !!s.job
    );
  return !!(s.place.trim() || s.pictures.length || s.versions.length || s.job);
};

/* ------------------------------------------------------------ the session */

const STORED = 1;

/**
 * The versions and the work, as a reload finds them. The job goes in so a
 * reload re-attaches to the work rather than starting it again.
 */
export function serialize(s: StudioState): string {
  return JSON.stringify({ v: STORED, ...s });
}

/** Read back, every field checked, anything malformed dropped rather than trusted. */
export function deserialize(raw: string | null): StudioState | null {
  if (!raw) return null;
  let o: any;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!o || o.v !== STORED) return null;
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const isReading = (r: any): r is SceneReading => !!r && typeof r.prompt === 'string' && typeof r.name === 'string';
  const versions: Version[] = Array.isArray(o.versions)
    ? o.versions
        .filter((v: any) => v && isReading(v.reading))
        .map((v: any) => ({
          reading: v.reading,
          hash: typeof v.hash === 'string' ? v.hash : null,
          ask: typeof v.ask === 'string' ? v.ask : undefined,
          coverage: strs(v.coverage),
          how: ['read', 'draw', 'again', 'change', 'edit'].includes(v.how) ? v.how : v.hash ? 'draw' : 'read',
        }))
    : [];
  const job: JobRef | null =
    o.job && typeof o.job.id === 'string' && ['make', 'again', 'change'].includes(o.job.kind)
      ? {
          id: o.job.id,
          kind: o.job.kind,
          ask: typeof o.job.ask === 'string' ? o.job.ask : undefined,
          inputsRev: Number(o.job.inputsRev) || 0,
          pending: isReading(o.job.pending) ? o.job.pending : null,
          coverage: strs(o.job.coverage),
          phase: ['reading', 'changing', 'drawing'].includes(o.job.phase) ? o.job.phase : null,
          since: typeof o.job.since === 'string' ? o.job.since : null,
          ...(o.job.stopping === true ? { stopping: true } : {}),
        }
      : null;
  const cur =
    Number.isInteger(o.current) && o.current >= -1 && o.current < versions.length ? o.current : versions.length - 1;
  return {
    place: typeof o.place === 'string' ? o.place.slice(0, PLACE_MAX) : '',
    pictures: strs(o.pictures).slice(0, PICTURES_MAX),
    inputsRev: Number(o.inputsRev) || 0,
    readRev: o.readRev === null || o.readRev === undefined ? null : Number(o.readRev),
    readTried: o.readTried === null || o.readTried === undefined ? null : Number(o.readTried),
    versions,
    current: cur,
    name: typeof o.name === 'string' ? o.name.slice(0, NAME_MAX) : '',
    named: !!o.named,
    job,
    error: typeof o.error === 'string' ? o.error : null,
  };
}
