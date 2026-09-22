import type { Answer, Aside } from '../../conversation/question.js';
import { COPY } from './sceneCopy.js';
import { followUps, intentOf } from './sceneIntent.js';
import { optionOf, ROW_ORDER, type SceneRow, SUGGESTED_IDEA } from './sceneRows.js';
import { IN_THE_PLACE } from './sceneWorldRows.js';

/**
 * The questions a scene is set up by, and every way their answers change.
 *
 * The same model as the presenter's (`presenterQuestions`): answers keyed by
 * question id, the next question read off them every time and never counted,
 * and a conversation that reads forward, so changing an answer takes back
 * everything asked after it. Scaled to a place: one door, the pictures, a
 * shot or the rows, and nothing else.
 *
 * A sentence typed at the first question is a door of its own, and the rows
 * still stand behind it: only the ones it left open are asked (`sceneIntent`),
 * so a sentence that says the place, the light and the camera goes straight to
 * the reading (the camera it names becomes the place's camera tendency, never
 * a row), and one that says only "warm stone" is asked how it is lit.
 */

/**
 * How the place is given: pictures of it, one of the brand's own shots, the
 * rows, or a sentence typed at the first question.
 *
 * A shot is its own door and never a picture among the uploads: what it is
 * read for is different (the place only, never the product or the people in
 * it), and the two are kept apart so neither can leak into the other.
 */
export type Door = 'photos' | 'shot' | 'guided' | 'words';
export type Qid = 'source' | 'photos' | 'shot' | 'reuse' | SceneRow;

/** A row passed over on purpose, which is an answer and not a gap. */
export const PASSED = '__passed';

/** A row's answer: the option tapped, the words typed, or both (words qualify a tap). */
export interface Given {
  pick?: string;
  words?: string;
}

/** The shot a place is read from, and the scene it was made in, when it was made in one. */
export interface ShotAnswer {
  id: string;
  hash: string;
  scene?: { id: string; name: string };
}

export interface Answers {
  source?: { door: Door; text?: string };
  /** The pictures, and whether they were handed over (`done`) or are still being chosen. */
  photos?: { hashes: string[]; done: boolean };
  shot?: ShotAnswer;
  /** The shot was made in a scene, and a new one is read from it anyway. */
  reuse?: 'read';
  world?: Given;
  surface?: Given;
  light?: Given;
  signature?: Given;
}

interface Spec {
  id: Qid;
  applies: (a: Answers) => boolean;
}

const door = (a: Answers) => a.source?.door;

/** The rows a typed sentence left open, and so still asks. Never the camera. */
export const openAfterWords = (a: Answers): SceneRow[] =>
  door(a) === 'words' ? followUps(intentOf(a.source?.text ?? '')) : [];

export const SPECS: readonly Spec[] = [
  { id: 'source', applies: () => true },
  { id: 'photos', applies: (a) => door(a) === 'photos' },
  { id: 'shot', applies: (a) => door(a) === 'shot' },
  // a shot made in a scene already has one: using it is offered before reading another
  { id: 'reuse', applies: (a) => door(a) === 'shot' && !!a.shot?.scene },
  ...ROW_ORDER.map(
    (r): Spec => ({
      id: r,
      applies: (a) => door(a) === 'guided' || openAfterWords(a).includes(r),
    }),
  ),
];

const ORDER = SPECS.map((s) => s.id);
export const isRow = (id: string): id is SceneRow => (ROW_ORDER as readonly string[]).includes(id);
export const isQid = (id: string): id is Qid => (ORDER as string[]).includes(id);

const given = (g: Given | undefined) => !!g && (!!g.pick || !!g.words?.trim());

export function answered(id: Qid, a: Answers): boolean {
  if (id === 'source') return !!a.source;
  if (id === 'photos') return !!a.photos?.done && a.photos.hashes.length > 0;
  if (id === 'shot') return !!a.shot;
  if (id === 'reuse') return a.reuse === 'read';
  return given(a[id]);
}

/** The questions answered, in the order they were asked. */
export const answeredIn = (a: Answers): Qid[] =>
  SPECS.filter((s) => s.applies(a) && answered(s.id, a)).map((s) => s.id);

/** The first question that exists and has no answer. Null when the place has been given. */
export function nextQuestion(a: Answers): Qid | null {
  return (
    SPECS.find((s) => {
      return s.applies(a) && !answered(s.id, a);
    })?.id ?? null
  );
}

/**
 * Whether the setup has said anything worth reading.
 *
 * Skipping every row is allowed, and it used to send the reader the two words
 * "A place." — a whole reading spent on nothing, and a scene drawn from it
 * that could be anywhere. A row passed is still an answer, so the questions
 * are over; there is simply nothing to read yet, and the line below is where
 * it comes from.
 */
export const saidSomething = (a: Answers): boolean => {
  if (a.source?.door === 'words') return !!a.source.text?.trim();
  if (a.source?.door === 'photos') return (a.photos?.hashes.length ?? 0) > 0;
  if (a.source?.door === 'shot') return !!a.shot;
  return ROW_ORDER.some((r) => rowWords(r, a[r]) !== null);
};

export const setupDone = (a: Answers): boolean => !!a.source && nextQuestion(a) === null && saidSomething(a);

const differs = (x: unknown, y: unknown) => JSON.stringify(x) !== JSON.stringify(y);

/**
 * The answers after a change: the new values, and everything asked after the
 * earliest one that changed taken back, to be asked again. Then any answer to
 * a question that no longer exists goes too.
 */
export function commit(a: Answers, patch: Partial<Answers>): Answers {
  const next: Answers = { ...a };
  const changed: Qid[] = [];
  for (const [k, v] of Object.entries(patch) as [Qid, unknown][]) {
    if (!differs(a[k], v)) continue;
    if (v === undefined) delete next[k];
    else (next as Record<string, unknown>)[k] = v;
    changed.push(k);
  }
  if (changed.length) {
    const first = Math.min(...changed.map((id) => ORDER.indexOf(id)));
    for (const id of ORDER) {
      if (ORDER.indexOf(id) <= first || id in patch) continue;
      delete next[id];
    }
  }
  for (const s of SPECS) if (next[s.id] !== undefined && !s.applies(next)) delete next[s.id];
  return next;
}

/** What an answer from the conversation means for the answers. Null when it means nothing here. */
export function answerPatch(id: Qid, ans: Answer, a: Answers): Partial<Answers> | null {
  if (id === 'source') {
    if (ans.kind !== 'choice') return null;
    if (ans.id === 'photos')
      return { source: { door: 'photos' }, photos: { hashes: a.photos?.hashes ?? [], done: false } };
    if (ans.id === 'guided') return { source: { door: 'guided' } };
    return null;
  }
  // Use the scene is not an answer: it leaves the conversation for that scene
  if (id === 'reuse') return ans.kind === 'choice' && ans.id === 'read' ? { reuse: 'read' } : null;
  if (isRow(id)) {
    // a tap is the base and words beside it qualify it, so a tap keeps the words
    const words = a[id]?.words;
    const pickOf =
      ans.kind === 'swatches'
        ? (ans.picks[id] ?? Object.values(ans.picks)[0])
        : ans.kind === 'choice'
          ? ans.id
          : undefined;
    if (pickOf) return { [id]: { pick: pickOf, ...(words ? { words } : {}) } };
    if (ans.kind === 'skip') return { [id]: { pick: PASSED, ...(words ? { words } : {}) } };
  }
  return null;
}

/* --------------------------------------------------------- the sentence */

/**
 * The signature, in words. Passing it is not "none": it asks the reading to
 * invent one for the place, because the idea is what separates a scene from
 * a place. A sentence that already carries one is never asked, so never here.
 */
function ideaWords(g: Given | undefined): string | null {
  if (g?.pick === PASSED) return [SUGGESTED_IDEA, g.words?.trim()].filter(Boolean).join(', ');
  return rowWords('signature', g);
}

/** What a row says, in the words of the place's own sentence; null when it was passed. */
function rowWords(row: SceneRow, g: Given | undefined): string | null {
  if (!g) return null;
  const tapped = g.pick && g.pick !== PASSED ? optionOf(row, g.pick)?.words : undefined;
  const typed = g.words?.trim();
  if (tapped && typed) return `${tapped}, ${typed}`;
  return tapped ?? typed ?? null;
}

/**
 * The guard that keeps an idea part of the place, said once at the end of a
 * direction that has one. See IN_THE_PLACE.
 */
const guard = (idea: string | null): string => (idea ? `, ${IN_THE_PLACE}` : '');

/**
 * The place, as one sentence for the reader: what the person said, and the
 * deciding word over anything the reader might otherwise make of it. A sentence
 * typed at the first question is that sentence; the rows are joined the way a
 * person would say them; pictures need none, the reader reads them.
 *
 * A world chosen and then left alone is still only a starting direction. The
 * compiler says so, so two people who pick the same card and skip the rest
 * are not handing the reader the same ten frozen words.
 */
export function compileDirection(a: Answers): string {
  if (a.source?.door === 'words') {
    // The sentence first, as written: it is the deciding word. What the
    // follow-ups added comes after it, and a world's own light only when the
    // sentence did not already say how it is lit.
    const text = (a.source.text ?? '').trim();
    const world = rowWords('world', a.world);
    const light =
      rowWords('light', a.light) ?? (intentOf(text).light ? null : (optionOf('world', a.world?.pick)?.light ?? null));
    const idea = ideaWords(a.signature);
    const more = [world, rowWords('surface', a.surface), light, idea].filter(Boolean) as string[];
    if (!more.length) return text;
    return `${text.replace(/[.\s]+$/, '')}, ${more.join(', ')}${guard(idea)}.`;
  }
  if (a.source?.door !== 'guided') return '';
  const world = rowWords('world', a.world);
  // A world passed over its light question keeps the light its own card was
  // photographed in, so a place is never handed over with nothing said about
  // how it is lit.
  const light = rowWords('light', a.light) ?? optionOf('world', a.world?.pick)?.light ?? null;
  const idea = ideaWords(a.signature);
  const parts = [world ?? 'a place', rowWords('surface', a.surface), light, idea].filter(Boolean) as string[];
  const text = `${parts.join(', ').replace(/^./, (c) => c.toUpperCase())}${guard(idea)}.`;
  // Every guided direction is a starting point, never a picture to copy. The
  // cards only show what each choice means; the reading is told to keep the
  // choices and the person's own words and to invent the arrangement, so two
  // people who tap the same cards, with or without a few words of their own,
  // get two different places.
  if (!a.world?.pick) return text;
  return `${text.slice(0, -1)}. ${COPY.worldIsAStart}`;
}

/** The pictures handed over, for the reader: the uploads, or the one shot. */
export function picturesOf(a: Answers): string[] {
  if (a.source?.door === 'shot') return a.shot ? [a.shot.hash] : [];
  return a.source?.door === 'photos' && a.photos?.done ? a.photos.hashes : [];
}

/* ------------------------------------------------------------ the state */

export interface SetupState {
  answers: Answers;
  /** Counts every change to the answers; work started under an older one is stale. */
  revision: number;
  /** A question open again from its answer, until it is answered or left. */
  editing: Qid | null;
  /** The answers as they stood when it opened, put back if it is left. */
  held: Answers | null;
  /** Sentences that answered nothing, each kept where it was said. */
  asides: Aside[];
}

export const EMPTY_SETUP: SetupState = { answers: {}, revision: 0, editing: null, held: null, asides: [] };

export type SetupAction =
  | { type: 'answer'; patch: Partial<Answers> }
  /** The pictures being chosen at the open question, before they are handed over. */
  | { type: 'photos'; hashes: string[] }
  | { type: 'edit'; id: Qid }
  | { type: 'cancel-edit' }
  | { type: 'aside'; aside: Aside };

export function reduceSetup(s: SetupState, act: SetupAction): SetupState {
  switch (act.type) {
    case 'answer': {
      const answers = commit(s.answers, act.patch);
      if (!differs(answers, s.answers)) return { ...s, editing: null, held: null };
      return { ...s, answers, revision: s.revision + 1, editing: null, held: null };
    }
    case 'photos': {
      if (s.answers.source?.door !== 'photos') return s;
      const hashes = [...new Set(act.hashes)].slice(0, 4);
      // reopened, the pictures are still the answer where they stand until they are handed over again
      const done = s.editing === 'photos';
      return { ...s, answers: { ...s.answers, photos: { hashes, done } }, revision: s.revision + 1 };
    }
    case 'edit':
      return answered(act.id, s.answers) ? { ...s, editing: act.id, held: s.answers } : s;
    case 'cancel-edit':
      if (!s.held || !differs(s.held, s.answers)) return { ...s, editing: null, held: null };
      return { ...s, answers: s.held, revision: s.revision + 1, editing: null, held: null };
    case 'aside':
      return { ...s, asides: [...s.asides, act.aside].slice(-40) };
  }
}

export const serializeSetup = (s: SetupState): unknown => ({
  answers: s.answers,
  revision: s.revision,
  asides: s.asides,
});

const HASH = /^[a-f0-9]{32}$/;
const ID = /^[\w.:-]{1,80}$/;

/** Read back from storage, checked rather than trusted. */
export function deserializeSetup(raw: unknown): SetupState | null {
  const o = raw as any;
  if (!o || typeof o !== 'object' || typeof o.answers !== 'object' || !o.answers) return null;
  const a: Answers = {};
  const src = o.answers.source;
  if (src && ['photos', 'shot', 'guided', 'words'].includes(src.door))
    a.source = { door: src.door, ...(typeof src.text === 'string' ? { text: src.text.slice(0, 400) } : {}) };
  const ph = o.answers.photos;
  if (ph && Array.isArray(ph.hashes))
    a.photos = { hashes: ph.hashes.filter((h: unknown) => typeof h === 'string').slice(0, 4), done: !!ph.done };
  const sh = o.answers.shot;
  if (sh && typeof sh.id === 'string' && ID.test(sh.id) && typeof sh.hash === 'string' && HASH.test(sh.hash)) {
    const sc = sh.scene;
    const scene =
      sc && typeof sc.id === 'string' && ID.test(sc.id) && typeof sc.name === 'string'
        ? { id: sc.id, name: sc.name.slice(0, 120) }
        : undefined;
    a.shot = { id: sh.id, hash: sh.hash, ...(scene ? { scene } : {}) };
  }
  if (o.answers.reuse === 'read') a.reuse = 'read';
  for (const r of ROW_ORDER) {
    const g = o.answers[r];
    if (!g || typeof g !== 'object') continue;
    const pick =
      // one of the row's own options, the general ones or the tapped world's
      typeof g.pick === 'string' && (g.pick === PASSED || !!optionOf(r, g.pick)) ? g.pick : undefined;
    const words = typeof g.words === 'string' ? g.words.slice(0, 200) : undefined;
    if (pick || words) a[r] = { ...(pick ? { pick } : {}), ...(words ? { words } : {}) };
  }
  const asides: Aside[] = Array.isArray(o.asides)
    ? o.asides
        .filter((x: any) => x && typeof x.said === 'string' && typeof x.reply === 'string' && typeof x.at === 'string')
        .map((x: any) => ({ said: x.said, reply: x.reply, at: x.at, q: typeof x.q === 'string' ? x.q : null }))
    : [];
  return { answers: commit({}, a), revision: Number(o.revision) || 0, editing: null, held: null, asides };
}
