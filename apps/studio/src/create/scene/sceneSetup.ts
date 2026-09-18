import type { Answer, Aside } from '../../conversation/question.js';
import { optionOf, ROW_ORDER, ROWS, type SceneRow } from './sceneRows.js';

/**
 * The questions a scene is set up by, and every way their answers change.
 *
 * The same model as the presenter's (`presenterQuestions`): answers keyed by
 * question id, the next question read off them every time and never counted,
 * and a conversation that reads forward, so changing an answer takes back
 * everything asked after it. Scaled to a place: one door, the pictures or the
 * five rows, and nothing else.
 */

/** How the place is given: pictures of it, the five rows, or a sentence typed at the first question. */
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
  where?: Given;
  light?: Given;
  feeling?: Given;
  materials?: Given;
  figure?: Given;
}

interface Spec {
  id: Qid;
  applies: (a: Answers) => boolean;
}

const door = (a: Answers) => a.source?.door;

export const SPECS: readonly Spec[] = [
  { id: 'source', applies: () => true },
  { id: 'photos', applies: (a) => door(a) === 'photos' },
  ...ROW_ORDER.map((r): Spec => ({ id: r, applies: (a) => door(a) === 'guided' })),
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
  return SPECS.find((s) => s.applies(a) && !answered(s.id, a))?.id ?? null;
}

export const setupDone = (a: Answers): boolean => !!a.source && nextQuestion(a) === null;

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
    if (ans.kind === 'swatches')
      return { [id]: { pick: ans.picks[id] ?? Object.values(ans.picks)[0], ...(words ? { words } : {}) } };
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

/**
 * The place, as one sentence for the reader: what the person said, and the
 * deciding word over anything the reader might otherwise make of it. A sentence
 * typed at the first question is that sentence; the rows are joined the way a
 * person would say them; pictures need none, the reader reads them.
 */
export function compileDirection(a: Answers): string {
  if (a.source?.door === 'words') return (a.source.text ?? '').trim();
  if (a.source?.door !== 'guided') return '';
  const where = rowWords('where', a.where);
  const light = rowWords('light', a.light);
  const feeling = rowWords('feeling', a.feeling);
  const materials = rowWords('materials', a.materials);
  const figure = rowWords('figure', a.figure);
  const parts = [
    where ?? 'a place',
    light ? `in ${light}` : null,
    feeling,
    materials ? `made of ${materials}` : null,
    figure,
  ].filter(Boolean) as string[];
  const [lead, ...rest] = parts;
  const text = [lead, ...rest].join(', ').replace(/^, /, '');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
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
  /** Sentences that answered nothing, each kept where it was said. */
  asides: Aside[];
}

export const EMPTY_SETUP: SetupState = { answers: {}, revision: 0, editing: null, asides: [] };

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
      if (!differs(answers, s.answers)) return { ...s, editing: null };
      return { ...s, answers, revision: s.revision + 1, editing: null };
    }
    case 'photos': {
      if (s.answers.source?.door !== 'photos') return s;
      const hashes = [...new Set(act.hashes)].slice(0, 4);
      return { ...s, answers: { ...s.answers, photos: { hashes, done: false } }, revision: s.revision + 1 };
    }
    case 'edit':
      return answered(act.id, s.answers) ? { ...s, editing: act.id } : s;
    case 'cancel-edit':
      return { ...s, editing: null };
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
  return { answers: commit({}, a), revision: Number(o.revision) || 0, editing: null, asides };
}
