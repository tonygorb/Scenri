import type { Answer, Aside } from '../../conversation/question.js';
import { COPY } from './sceneCopy.js';
import { followUps, intentOf } from './sceneIntent.js';
import { optionOf, ROW_ORDER, ROWS, type SceneRow } from './sceneRows.js';

/**
 * The questions a scene is set up by, and every way their answers change.
 *
 * The same model as the presenter's (`presenterQuestions`): answers keyed by
 * question id, the next question read off them every time and never counted,
 * and a conversation that reads forward, so changing an answer takes back
 * everything asked after it. Scaled to a place: one door, the pictures or the
 * rows, and nothing else.
 *
 * A sentence typed at the first question is a door of its own, and the rows
 * still stand behind it: only the ones it left open are asked (`sceneIntent`),
 * at most two, so a sentence that says the place, the light and the camera goes
 * straight to the reading, and one that says only "warm stone" is asked how it
 * is lit and how the subject lives in it.
 */

/** How the place is given: pictures of it, the four rows, or a sentence typed at the first question. */
export type Door = 'photos' | 'guided' | 'words';
export type Qid = 'source' | 'photos' | SceneRow;

/** A row passed over on purpose, which is an answer and not a gap. */
export const PASSED = '__passed';

/** A row's answer: the option tapped, the words typed, or both (words qualify a tap). */
export interface Given {
  pick?: string;
  words?: string;
}

export interface Answers {
  source?: { door: Door; text?: string };
  /** The pictures, and whether they were handed over (`done`) or are still being chosen. */
  photos?: { hashes: string[]; done: boolean };
  world?: Given;
  light?: Given;
  stage?: Given;
  shot?: Given;
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
  return given(a[id]);
}

/** The questions answered, in the order they were asked. */
export const answeredIn = (a: Answers): Qid[] =>
  SPECS.filter((s) => s.applies(a) && answered(s.id, a)).map((s) => s.id);

/** The first question that exists and has no answer. Null when the place has been given. */
export function nextQuestion(a: Answers): Qid | null {
  return (
    SPECS.find((s) => {
      if (!s.applies(a) || answered(s.id, a)) return false;
      // Staging is how the subject sits and how it is seen. The camera is
      // not a second question, and it is not a silent answer in the thread.
      if (s.id === 'shot' && given(a.stage)) return false;
      return true;
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

/** What a row says, in the words of the place's own sentence; null when it was passed. */
function rowWords(row: SceneRow, g: Given | undefined): string | null {
  if (!g) return null;
  const tapped = g.pick && g.pick !== PASSED ? optionOf(row, g.pick)?.words : undefined;
  const typed = g.words?.trim();
  if (tapped && typed) return `${tapped}, ${typed}`;
  return tapped ?? typed ?? null;
}

/** A row answered by a tap or by words, not passed over. */
const chosen = (g: Given | undefined): boolean => !!g && g.pick !== PASSED && (!!g.pick || !!g.words?.trim());

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
    const more = [world, light, rowWords('stage', a.stage)].filter(Boolean) as string[];
    return more.length ? `${text.replace(/[.\s]+$/, '')}, ${more.join(', ')}.` : text;
  }
  if (a.source?.door !== 'guided') return '';
  const world = rowWords('world', a.world);
  // A world passed over its light question keeps the light its own card was
  // photographed in, so a place is never handed over with nothing said about
  // how it is lit.
  const light = rowWords('light', a.light) ?? optionOf('world', a.world?.pick)?.light ?? null;
  const stage = rowWords('stage', a.stage);
  const impliedShot = optionOf('stage', a.stage?.pick)?.shot;
  // A staging pick that already is a camera must not say the same view twice.
  const shot = impliedShot && a.shot?.pick === impliedShot && !a.shot.words ? null : rowWords('shot', a.shot);
  const parts = [world ?? 'a place', light, stage, shot].filter(Boolean) as string[];
  const text = `${parts.join(', ').replace(/^./, (c) => c.toUpperCase())}.`;
  const personalised = chosen(a.light) || chosen(a.stage) || chosen(a.shot) || !!a.world?.words?.trim();
  if (personalised || !a.world?.pick) return text;
  return `${text.slice(0, -1)}. ${COPY.worldIsAStart}`;
}

/** The pictures handed over, for the reader. */
export const picturesOf = (a: Answers): string[] =>
  a.source?.door === 'photos' && a.photos?.done ? a.photos.hashes : [];

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

/** Read back from storage, checked rather than trusted. */
export function deserializeSetup(raw: unknown): SetupState | null {
  const o = raw as any;
  if (!o || typeof o !== 'object' || typeof o.answers !== 'object' || !o.answers) return null;
  const a: Answers = {};
  const src = o.answers.source;
  if (src && ['photos', 'guided', 'words'].includes(src.door))
    a.source = { door: src.door, ...(typeof src.text === 'string' ? { text: src.text.slice(0, 400) } : {}) };
  const ph = o.answers.photos;
  if (ph && Array.isArray(ph.hashes))
    a.photos = { hashes: ph.hashes.filter((h: unknown) => typeof h === 'string').slice(0, 4), done: !!ph.done };
  for (const r of ROW_ORDER) {
    const g = o.answers[r];
    if (!g || typeof g !== 'object') continue;
    const pick =
      typeof g.pick === 'string' && (g.pick === PASSED || ROWS[r].options.some((x) => x.id === g.pick))
        ? g.pick
        : undefined;
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
