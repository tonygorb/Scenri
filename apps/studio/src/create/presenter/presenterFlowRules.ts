import {
  type Answer,
  type Aside,
  type NothingKind,
  type Question,
  type Turn,
  answersNothing,
  asideTurns,
  choiceFromText,
  isAsideTurn,
  openQuestionId,
} from '../../conversation/question.js';
import { type CreationState, UNSURE_LINE, asideEditAt, isAsideEdit } from './creationState.js';
import type { AsidePhase as Phase } from './presenterCopy.js';
import {
  ATTEST_TEXT,
  DOOR_WORDS,
  PROMPT,
  SOURCE_OPTIONS,
  STARTERS,
  UNSURE_PROMPT,
  gapsPrompt,
  photosHint,
  photosLine,
} from './presenterCopy.js';
import {
  AGE_OPTIONS,
  LOOK_COLOUR,
  LOOK_ROWS,
  LOOK_SAYS,
  LOOK_SAYS_PLACEHOLDER,
  WHO_OPTIONS,
  answerLabel,
  castFor,
  lookLine,
  lookSentence,
} from './presenterLook.js';
import {
  type Answers,
  type FlowContext,
  type Gap,
  type LookStep,
  PASSED,
  type Qid,
  type Source,
  type TraitQid,
  type TraitWhat,
  type WhereQid,
  answeredIn,
  descriptionGaps,
  inTableOrder,
  isLookQid,
  type LookQid,
  isQid,
  lookOf,
  nextQuestion,
  traitDetails,
  traitOfQid,
} from './presenterQuestions.js';
import { recordTurns } from './presenterRecordTurns.js';
import {
  readsAsPerson,
  type Age,
  type DraftLike,
  MAX_PHOTOS,
  type Steer,
  type StudioView,
  VIEW_NAME,
  castSentence,
  drawing,
  identityLocked,
} from './presenterStudioRules.js';
import { TRAITS, type TraitId, traitOf, traitSentence } from './presenterTraits.js';

/**
 * The creation conversation, as rules.
 *
 * A presenter is made in a short exchange: who are we creating, then the
 * rows or the sentence or the photographs, then anything else that is always
 * true of them, then the face, decided; then the set, built without a click;
 * then a name if none was given while it drew, and Save. Every Scenri line
 * is product copy; nothing asks a model for words.
 *
 * The transcript is `turnsFor()`, a pure function of the creation state and
 * of the server draft. No turn is stored and no rendered text is ever read
 * back: change the state and the transcript follows. Which questions exist
 * and what depends on what is `presenterQuestions`; this file only says how
 * each one looks and reads.
 */
export type { Source };
export { MAX_PHOTOS };
export {
  PROMPT,
  STARTERS,
  SOURCE_OPTIONS,
  ATTEST_TEXT,
  UNSURE_PROMPT,
  type AsidePhase,
  asideReply,
  readingWhat,
  gapsPrompt,
} from './presenterCopy.js';
export { descriptionGaps } from './presenterQuestions.js';
export {
  HAIR_COLOURS,
  HAIR_LENGTHS,
  SKIN_TONES,
  BUILDS,
  LOOK_STEPS,
  colourName,
  nearestSwatch,
} from './presenterLook.js';

export const needsFollowUp = (text: string): boolean => descriptionGaps(text).length > 0;

export const GAP_GROUPS: Record<Gap, { label: string; options: { id: string; label: string }[] }> = {
  who: { label: 'Who', options: WHO_OPTIONS },
  age: { label: 'Age', options: AGE_OPTIONS },
  build: {
    label: 'Build',
    options: ['slender', 'average', 'athletic', 'fuller'].map((b) => ({
      id: b,
      label: b.charAt(0).toUpperCase() + b.slice(1),
    })),
  },
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The follow-up's answer, as a sentence in the transcript. */
export function gapsLine(gaps: Answers['gaps']): string {
  if (!gaps || gaps === 'skipped') return 'Draw as is';
  return Object.values(gaps)
    .map((v) => cap(v))
    .join(', ');
}

/** The details chosen, said back as one line. */
export function traitsLine(ids: TraitId[]): string {
  const names = ids.map((id) => traitOf(id)?.label ?? id);
  if (!names.length) return 'Nothing distinctive';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** Which door a typed sentence at the first question names, if any. */
export const sourceFromText = (text: string): Source | null =>
  choiceFromText(text, SOURCE_OPTIONS, DOOR_WORDS) as Source | null;

/* ------------------------------------------------------------- compiling */

/** The sentence the engine is given: the rows as a person, or the description with the follow-up folded in. */
export function compileDirection(a: Answers): string {
  if (a.source?.via === 'taps') {
    const look = lookOf(a);
    // The row names a kind of person, and now carries any words typed into it.
    // Words that describe nobody are not a kind of person: they are something
    // about them, and `stepHolds` keeps them as that instead.
    return lookSentence(look.who && !readsAsPerson(look.who) ? { ...look, who: undefined } : look);
  }
  const said = (a.describe ?? '').trim();
  const picks = a.gaps && a.gaps !== 'skipped' ? a.gaps : {};
  const build = picks.build ? `${said.replace(/[.\s]+$/, '')}, ${picks.build} build` : said;
  return castSentence(
    { steer: (picks.who as Steer) ?? null, age: (picks.age as Age) ?? null, tone: null, hair: null },
    build,
  );
}

/**
 * Everything that stays the same about them, one thing at a time: the details
 * they chose and answered, in the table's order, and then anything else they
 * said at the last moment.
 */
export function keepItems(a: Answers): string[] {
  return compileItems(a).map((i) => i.words);
}

/**
 * What the draft will store of one item, to the character.
 *
 * Mirrors the server (`keepItemsOf` in `presenterDrafts.ts`), and has to: the
 * flow asks the draft to hold what the answers say and stops asking once it
 * does, so a cap only one side applies is a question that can never be
 * answered. `presenterKeepParity.test.ts` reads both files and fails if they
 * drift.
 */
const KEEP_ITEM_CHARS = 200;
const KEEP_ITEMS_MAX = 12;

/** One thing kept, as the draft stores it: what it is, and the pictures of it. */
export interface KeptItem {
  id: string;
  words: string;
  refs?: string[];
}

/**
 * Everything that stays the same about them, one item at a time.
 *
 * The list is the thing that travels. Joined into a sentence it used to be
 * cut to length wherever the cut landed, which took the last detail chosen
 * and severed the side off the one before it; and flattened into a map of
 * pictures, nothing said which picture was of which detail. Both problems are
 * the same problem, so both are fixed by the same shape.
 */
export function compileItems(a: Answers): KeptItem[] {
  const details = traitDetails(a);
  const item = (id: string, words: string, refs?: string[]): KeptItem => ({
    id,
    words: words.slice(0, KEEP_ITEM_CHARS),
    ...(refs?.length ? { refs: refs.slice(0, 4) } : {}),
  });
  const items: KeptItem[] = [];
  for (const id of inTableOrder(a.traits ?? [])) {
    const one = details[id];
    const words = one ? traitSentence(id, one) : '';
    if (words) items.push(item(id, words, one?.refs));
  }
  const said = (a.keep?.words ?? '').trim();
  if (said) items.push(item('said', said, a.keep?.refs));
  return items.slice(0, KEEP_ITEMS_MAX);
}

/**
 * The same, as one sentence, because that is what a prompt carries and what
 * the record's identity notes hold.
 */
export function compileKeep(a: Answers): string {
  return keepItems(a).join(', ');
}

/** And said as a person says it, with the last one joined by "and". */
export function keepLine(a: Answers): string {
  const items = keepItems(a);
  if (items.length < 2) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Whether a step can actually hold what was typed into it.
 *
 * A row takes words as well as taps, and some rows can carry any words at
 * all: a hair colour nobody named, a length said in their own way. Others
 * cannot. "Who are they?" compiles through a fixed set, so a sentence typed
 * at it was accepted, dropped on the floor by the compile, and the person was
 * told nothing: the read-back said "a person" and the thing they had told us
 * about them was gone.
 *
 * The test is the compile itself rather than a vocabulary per row, so a row
 * added tomorrow needs nothing written here: if the words are not in what the
 * answer compiles to, the answer could not hold them. Short words are ignored
 * because "a" and "in" appear in every sentence ever compiled.
 */
/**
 * A sentence about them, said as a thing they have.
 *
 * What is kept is read back as "and always X" and reaches a prompt as "who
 * also has X", so a whole clause typed in passing lands as "and always he has
 * a left prosthetic arm". The subject is dropped and the rest is theirs.
 */
export function asKept(text: string): string {
  const said = text.trim().replace(/[.\s]+$/, '');
  const bare = said.replace(/^(?:he|she|they|it)\s+(?:has|have|had|has got|have got|is|are|wears?|carries)\s+/i, '');
  return bare || said;
}

export function stepHolds(a: Answers, id: LookQid, value: string, typed: string): boolean {
  const said = typed
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
  if (!said.length) return true;
  const made = compileDirection({ ...a, [id]: value }).toLowerCase();
  return said.every((w) => made.includes(w));
}

/** The pictures of each detail, for the draft to draw them from. */
export function compileRefs(a: Answers): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [id, detail] of Object.entries(traitDetails(a))) if (detail?.refs?.length) out[id] = detail.refs;
  if (a.keep?.refs?.length) out.keep = a.keep.refs;
  return out;
}

/**
 * The answers a draft carries, for a page opened on it with none of its own:
 * another tab, a cleared session, a draft seeded from outside, answers left
 * over from a run that is over. The person is already being drawn, so the
 * setup reads as done, and every pencil still works.
 */
export function seedFromDraft(d: DraftLike): Answers {
  if (d.source === 'photos') {
    return {
      source: { door: 'photos', via: 'taps' },
      photos: { hashes: d.sources ?? [], attested: true },
      ...keptBack(d),
    };
  }
  // `gaps` is answered with the rest. A draft's own direction is settled,
  // however thin it reads, and the follow-up that asks what a thin description
  // left out would otherwise stand open over a draft that is ready to draw,
  // holding it there: the conversation asking to finish something that has
  // already begun.
  return {
    source: { door: 'scratch', via: 'typed' },
    describe: d.direction ?? '',
    gaps: 'skipped',
    traits: [],
    ...keptBack(d),
  };
}

/**
 * The details a draft holds, read back as the answers that made them.
 *
 * This is why an item carries the row it came from. Without it a resumed page
 * knew nothing of their glasses or their prosthetic limb, the flow saw answers
 * that disagreed with the draft, and the sync it sent to put that right wrote
 * the emptiness back: a person with six approved views came back from the
 * library with their details gone and their face redrawn. Read back this way
 * the answers already agree, so nothing is sent and nothing is redrawn.
 */
function keptBack(d: DraftLike): Partial<Answers> {
  const items = d.keepItems ?? [];
  if (!items.length) return {};
  const out: Partial<Answers> = {};
  const traits: TraitId[] = [];
  let said: { words: string; refs: string[] } | undefined;
  for (const item of items) {
    const row = TRAITS.find((t) => t.id === item.id);
    if (row) {
      traits.push(row.id);
      (out as Record<string, unknown>)[`trait-${row.id}`] = { words: item.words, refs: item.refs ?? [] };
      continue;
    }
    // Anything that did not come from a row is what they said themselves.
    said = {
      words: [said?.words, item.words].filter(Boolean).join(', '),
      refs: [...(said?.refs ?? []), ...(item.refs ?? [])],
    };
  }
  out.traits = traits;
  if (said) out.keep = said;
  return out;
}

/** What the setup questions can see of the draft. */
export const flowContext = (draft: DraftLike | null, canGenerate: boolean): FlowContext => ({
  draft: draft
    ? {
        source: draft.source,
        stage: draft.stage,
        keep: draft.keep,
        views: { portrait: { status: draft.views.portrait.status } },
      }
    : null,
  canGenerate,
});

/* -------------------------------------------------------------- answers */

/**
 * What a tap on a block means for the answers, or null when the block's
 * action is not an answer (a photograph added, a door stepped back from).
 */
export function answerPatch(qid: Qid, a: Answer, answers: Answers): Partial<Answers> | null {
  if (qid === 'source') return a.kind === 'choice' ? { source: { door: a.id as Source, via: 'taps' } } : null;
  if (isLookQid(qid)) {
    if (a.kind === 'swatches') return { [qid]: a.picks[qid.slice('look-'.length)] ?? Object.values(a.picks)[0] };
    if (a.kind === 'skip') return { [qid]: PASSED };
    return null;
  }
  if (qid === 'gaps') {
    if (a.kind === 'choices') return { gaps: a.picks };
    if (a.kind === 'skip') return { gaps: 'skipped' };
    return null;
  }
  if (qid === 'traits') {
    if (a.kind === 'choices') return { traits: TRAITS.map((t) => t.id).filter((id) => a.picks[id]) };
    if (a.kind === 'skip') return { traits: [] };
    return null;
  }
  const trait = traitOfQid(qid);
  if (trait && a.kind === 'choice') {
    if (trait.part === 'where') return { [qid]: a.id };
    const had = answers[`trait-${trait.id}`];
    return { [qid]: { words: a.id, refs: had?.refs ?? [] } };
  }
  return null;
}

/**
 * A detail answered by its picture alone: the words say exactly that, so a
 * prompt reads as a sentence and the picture it names rides beside it.
 */
export function attachedWords(id: TraitId, n: number): string {
  const label = traitOf(id)?.label.toLowerCase() ?? 'detail';
  return `the ${label} in the attached ${n === 1 ? 'picture' : 'pictures'}`;
}

/**
 * The line at the read-back and wherever else a last-moment detail is written:
 * the free hand over the rows, for what no question thought to ask.
 */
const KEEP_PLACEHOLDER = 'A scar, a ring, anything we missed';

/** The questions answered in a sentence typed into their own field, in place. */
export const TEXT_QIDS: ReadonlySet<Qid> = new Set<Qid>(['describe', 'keep']);

/**
 * The kinds that are conversation rather than an answer, whatever is asked.
 *
 * Every one of these is recognised by what it actually says: a greeting, a
 * question mark, a request to go somewhere, a real person's name. `vague` is
 * not among them, because `vague` only means "two words that do not describe a
 * whole person", and a step asking for a cut or a build is answered in two
 * words more often than not. "pony tail" and "buzz cut" describe nobody and
 * are exactly the right answer to "And the length?".
 */
const CONVERSATION: ReadonlySet<NothingKind> = new Set<NothingKind>([
  'likeness',
  'help',
  'question',
  'greeting',
  'ack',
  'nav',
  'intent',
  'go',
  'nonsense',
]);

/**
 * Whether this answer is the person's own words rather than something tapped.
 *
 * It decides how the answer is changed: words are rewritten where they stand,
 * and a tap reopens the row it was tapped from. Reopening a row under a typed
 * answer threw the words away and offered the chips that were not them in the
 * first place, which is the one case where a person most wants their sentence
 * back. There is no flag to read for this: an answer that is not one of the
 * question's own option ids was typed, and that is the whole test.
 */
export function answeredInWords(id: Qid | null, a: Answers): boolean {
  if (!id) return false;
  if (TEXT_QIDS.has(id)) return true;
  const notAnOption = (v: unknown, options: readonly { id: string }[]) =>
    typeof v === 'string' && !!v && !options.some((o) => o.id === v);
  if (isLookQid(id)) {
    const step = id.slice('look-'.length) as LookStep;
    return notAnOption(a[id], LOOK_ROWS[step].row.options);
  }
  const trait = traitOfQid(id);
  if (!trait) return false;
  const t = traitOf(trait.id);
  if (!t) return false;
  if (trait.part === 'where') return notAnOption(a[id as WhereQid], t.where?.options ?? []);
  return notAnOption((a[id as TraitQid] as TraitWhat | undefined)?.words, t.options);
}

/**
 * Whether these words answer this question, and what is wrong when they do not.
 *
 * One judgement, for both ways an answer can arrive: typed into the line, or
 * written again over an answer that already stands. It lived only in the send
 * path, so a question that refused "Lungo123" accepted the very same words the
 * moment they were written over an answer instead of typed under one. A rule
 * that only one of two doors enforces is not a rule.
 */
export function judgeAnswer(id: Qid, text: string, describes: (t: string) => boolean): NothingKind | null {
  const said = text.trim();
  if (!said) return 'vague';
  // A step, a detail, and the last word all ask for a short phrase about them.
  if (isLookQid(id) || id.startsWith('trait-') || id === 'keep') return notAnAnswerAtAStep(said, describes);
  // The door and the description ask for a person, in a sentence.
  if (id === 'describe' || id === 'source') return answersNothing(said, describes);
  return null;
}

/**
 * The voice a sentence that answered nothing is answered in.
 *
 * It is a function of what the sentence was aimed at, never of which branch
 * happened to catch it. Reading it off the branch is how a setup step came to
 * reply "say what should change: hair, age or build change the person" to
 * somebody four questions away from a picture: the step fell through to the
 * last case, and the last case was the one for a presenter already drawn.
 *
 * `drawn` is the floor under that: there is nothing to refine before a picture
 * exists, so setup cannot speak in the refine voice whatever else is wrong. It
 * means a face has been drawn, not approved: a candidate on the stage is very
 * much something to say "what should change" about.
 */
export function asidePhaseFor(target: Qid | 'keep' | null, open: string | null, drawn: boolean): Phase {
  if (target && isLookQid(target)) return 'look';
  if (target === 'keep' || target?.startsWith('trait-')) return 'detail';
  const id = target ?? open;
  if (id && isLookQid(id)) return 'look';
  if (id?.startsWith('trait-')) return 'detail';
  switch (id) {
    case 'source':
      return 'source';
    case 'describe':
    case 'gaps':
      return 'describe';
    case 'name':
      return 'name';
    case 'traits':
      return 'detail';
    default:
      return drawn ? 'refine' : 'describe';
  }
}

/**
 * The words this flow uses for its own topics.
 *
 * Naming the subject is not answering the question: "Hair" at "And the length?"
 * is somebody saying what they are looking at, and it was being taken as the
 * cut, because a bare capitalised word is allowed to be a name and a short
 * phrase is allowed to be an answer. Both of those are right in general and
 * wrong for exactly this list, which is small, closed and the app's own.
 */
const TOPICS = new Set([
  'who',
  'age',
  'hair',
  'colour',
  'color',
  'length',
  'cut',
  'skin',
  'build',
  'body',
  'name',
  'look',
  'style',
  'face',
  'person',
  'presenter',
  'glasses',
  'scar',
  'scars',
  'tattoo',
  'piercing',
  'makeup',
  'freckles',
  'prosthetic',
]);

/** What a sentence is, at a step that asks for a short phrase. Null when it answers it. */
/**
 * A word with a number stuck on the end: "lol3", "test1", "zzz999".
 *
 * Short answers have to be let through at a step, or "pony tail" and "kare" are
 * refused, and this shape comes through with them. It is what somebody types to
 * see what happens, and nothing a person calls a hair length or a build looks
 * like it. A number LEADING is left alone: "90s" and "50s bob" are real.
 */
const TRAILING_DIGITS = /^[a-z]{1,10}\d+$/i;

/** What a sentence is, at a step that asks for a short phrase. Null when it answers it. */
export const notAnAnswerAtAStep = (text: string, describes: (t: string) => boolean): NothingKind | null => {
  const said = text.trim();
  const bare = said.toLowerCase().replace(/[^a-z ]/g, '');
  if (TOPICS.has(bare) || TOPICS.has(bare.replace(/^(the|their|its|his|her)\s+/, ''))) return 'nonsense';
  const words = said.split(/\s+/).filter(Boolean);
  if (words.length <= 2 && words.some((w) => TRAILING_DIGITS.test(w))) return 'nonsense';
  const kind = answersNothing(text, describes);
  return kind && CONVERSATION.has(kind) ? kind : null;
};

/** What changing an answer costs, once a draft exists. */
export type EditCost = 'plain' | 'metadata' | 'redraw' | 'start-over';

export function editCost(id: Qid | 'name', draft: DraftLike | null): EditCost {
  if (id === 'name') return 'metadata';
  if (!draft) return 'plain';
  if (id === 'source' || id === 'photos') return 'start-over';
  return 'redraw';
}

/* ------------------------------------------------------------ questions */

function questionFor(id: Qid, state: CreationState, _ctx: FlowContext, reopened: boolean): Question {
  const a = state.answers;
  const base = reopened ? { reopened: true } : {};
  switch (id) {
    case 'source':
      return { id, kind: 'choice', prompt: PROMPT.source, options: SOURCE_OPTIONS, given: a.source?.door, ...base };
    case 'photos': {
      const p = a.photos ?? { hashes: [], attested: false };
      return {
        id,
        kind: 'photos',
        prompt: PROMPT.photos,
        hint: photosHint(p.hashes.length, MAX_PHOTOS),
        hashes: p.hashes,
        max: MAX_PHOTOS,
        busy: state.uploading > 0,
        attest: { text: ATTEST_TEXT, checked: p.attested },
        submit: 'Continue',
        back: 'Describe someone instead',
      };
    }
    case 'describe':
      return { id, kind: 'text', prompt: PROMPT.describe, starters: STARTERS };
    case 'gaps': {
      const gaps = descriptionGaps(a.describe ?? '');
      return {
        id,
        kind: 'choice',
        prompt: gapsPrompt(gaps.length),
        groups: gaps.map((g) => ({ id: g, ...GAP_GROUPS[g] })),
        submit: 'Continue',
        skip: 'Skip, draw as is',
        given: a.gaps && a.gaps !== 'skipped' ? a.gaps : undefined,
        ...base,
      };
    }
    case 'traits': {
      const photos = a.source?.door === 'photos';
      return {
        id,
        kind: 'choice',
        prompt: photos ? PROMPT.traitsPhotos : PROMPT.traits,
        multi: true,
        options: TRAITS.map((t) => ({ id: t.id, label: t.label })),
        submit: 'Continue',
        skip: photos ? 'Nothing to add' : 'Nothing else',
        given: a.traits,
        ...base,
      };
    }
    case 'keep':
      return { id, kind: 'text', prompt: PROMPT.keep };
  }
  if (isLookQid(id)) {
    const step = id.slice('look-'.length) as LookStep;
    const { row, prompt } = LOOK_ROWS[step];
    return {
      id,
      kind: 'swatches',
      prompt,
      hint: step === 'who' ? PROMPT.lookHint : undefined,
      row,
      cast: castFor(a['look-who']),
      skip: 'Skip',
      // Only the first row keeps a way in of its own, and it is not a way to
      // type: it leaves the rows behind and takes the whole person in one
      // sentence. Every other row's "describe it" chip opened a field that is
      // already open and already says it takes words, which is one room with
      // two doors and a person wondering what the difference is.
      describe: step === 'who' ? 'Describe them instead' : undefined,
      saying: state.saying === id,
      given: a[id],
      ...base,
    };
  }
  const trait = traitOfQid(id);
  const t = trait ? traitOf(trait.id) : undefined;
  if (trait && t && trait.part === 'where' && t.where) {
    return {
      id,
      kind: 'choice',
      prompt: t.where.ask,
      options: t.where.options.map((o) => ({ id: o.id, label: o.label })),
      saying: state.saying === id,
      given: a[id as `trait-${TraitId}-where`],
      ...base,
    };
  }
  if (trait && t) {
    const what = a[`trait-${trait.id}`];
    return {
      id,
      kind: 'choice',
      prompt: t.ask,
      hint: t.hint,
      options: t.options.map((o) => ({ id: o.id, label: o.label, card: o.card })),
      // the same way in as the plus beside the pill, where the question is
      attach: what?.refs.length ? 'Replace the reference' : 'Add a reference',
      saying: state.saying === id,
      given: what?.words,
      ...base,
    };
  }
  return { id, kind: 'text', prompt: '' };
}

/** The line a question was asked with, for its exchange. */
function askedLine(id: Qid, a: Answers): string {
  switch (id) {
    case 'source':
      return PROMPT.source;
    case 'photos':
      return PROMPT.photos;
    case 'describe':
      return a.source?.via === 'typed' ? PROMPT.source : PROMPT.describe;
    case 'gaps':
      return gapsPrompt(descriptionGaps(a.describe ?? '').length);
    case 'traits':
      return a.source?.door === 'photos' ? PROMPT.traitsPhotos : PROMPT.traits;
    case 'keep':
      return PROMPT.keep;
  }
  if (isLookQid(id)) return LOOK_ROWS[id.slice('look-'.length) as LookStep].prompt;
  const trait = traitOfQid(id);
  const t = trait ? traitOf(trait.id) : undefined;
  if (!trait || !t) return '';
  return trait.part === 'where' ? (t.where?.ask ?? '') : t.ask;
}

/** The answer as it reads in the transcript. */
function answerLine(id: Qid, a: Answers, draft: DraftLike | null): { text: string; photos?: string[] } {
  switch (id) {
    case 'source':
      return { text: a.source?.door === 'photos' ? 'Add photos' : 'Describe someone' };
    case 'photos': {
      const hashes = draft?.sources ?? a.photos?.hashes ?? [];
      return { text: photosLine(hashes.length), photos: hashes };
    }
    case 'describe':
      return { text: (a.describe ?? '').trim() };
    case 'gaps':
      return { text: gapsLine(a.gaps) };
    case 'traits':
      return { text: traitsLine(inTableOrder(a.traits ?? [])) };
    case 'keep':
      return { text: (a.keep?.words ?? '').trim(), photos: a.keep?.refs };
  }
  if (isLookQid(id)) {
    const step = id.slice('look-'.length) as LookStep;
    return { text: answerLabel(LOOK_ROWS[step].row, a[id] ?? '') };
  }
  const trait = traitOfQid(id);
  const t = trait ? traitOf(trait.id) : undefined;
  if (!trait || !t) return { text: '' };
  if (trait.part === 'where') {
    const v = a[id as `trait-${TraitId}-where`] ?? '';
    return { text: t.where?.options.find((o) => o.id === v)?.label ?? cap(v) };
  }
  const what = a[`trait-${trait.id}`];
  const words = what?.words ?? '';
  // the picture rides with the answer, the way the photographs do
  return {
    text: t.options.find((o) => o.id === words)?.label ?? cap(words),
    photos: what?.refs.length ? what.refs : undefined,
  };
}

/* ----------------------------------------------------------- transcript */

export interface FlowArgs {
  state: CreationState;
  draft: DraftLike | null;
  canGenerate: boolean;
  /** A request that never reached the engine, said once with a Retry. */
  failed?: string | null;
}

/**
 * The transcript, whole, from state. The last turn is the open question
 * when there is one; `activeQuestion()` reads it off.
 */
export function turnsFor(args: FlowArgs): Turn[] {
  const asides = args.state.asides;
  // Where an aside goes depends on which question is open, so the transcript
  // is shaped once without them to learn it.
  const openId = asides.length ? openQuestionId(shape(args, [], null)) : null;
  return shape(args, asides, openId);
}

const byAt = (x: { at: string }, y: { at: string }) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0);

/** True when this aside is the one being said again. */
const beingSaidAgain = (state: CreationState, x: Aside) =>
  isAsideEdit(state.editing) && asideEditAt(state.editing) === x.at;

function shape(args: FlowArgs, asides: Aside[], openId: string | null): Turn[] {
  const placed = new Set<Aside>();
  const T = build(args, asides, openId, placed);
  // A sentence with nothing of a person in it waits on its own question. What
  // was said follows the last turn, in order: before that question when it
  // came before, after it when it came after.
  const left = asides.filter((a) => !placed.has(a)).sort(byAt);
  const u = args.state.unsure;
  for (const a of left) if (!u || a.at < u.at) T.push(...asideTurns(a, beingSaidAgain(args.state, a)));
  if (u) {
    T.push({ kind: 'you', id: `unsure-${u.at}`, text: u.said, editable: false });
    T.push({
      kind: 'question',
      question: {
        id: 'unsure',
        kind: 'confirm',
        quiet: true,
        prompt: UNSURE_PROMPT,
        options: [{ id: 'use', label: 'Use it anyway' }],
      },
    });
    for (const a of left) if (a.at >= u.at) T.push(...asideTurns(a, beingSaidAgain(args.state, a)));
  }
  return T;
}

function build(
  { state, draft, canGenerate, failed }: FlowArgs,
  asides: Aside[],
  openId: string | null,
  placed: Set<Aside>,
) {
  const ctx = flowContext(draft, canGenerate);
  const a = state.answers;
  const lead: Turn[] = [{ kind: 'you', id: 'intent', text: 'Create a presenter' }];
  // the details the photographs were asked about belong after the read of them
  const after: Turn[] = [];
  const photosDoor = a.source?.door === 'photos';
  // What was said at a question, once it is answered, sits between its line and the answer.
  const attach = (into: Turn[], ids: string[], after = false) => {
    const mine = asides
      .filter((x) => !placed.has(x) && !!x.q && x.q !== openId && ids.includes(x.q) && !!x.after === after)
      .sort(byAt);
    for (const x of mine) {
      placed.add(x);
      into.push(...asideTurns(x, beingSaidAgain(state, x)));
    }
  };
  // An answer keeps the line it answered above it: the exchange is the record.
  const exchange = (into: Turn[], id: Qid) => {
    into.push({ kind: 'scenri', id: `asked-${id}`, text: askedLine(id, a), quiet: true });
    // A typed sentence answered the first question, so what was said there stays with it.
    attach(into, id === 'describe' && a.source?.via === 'typed' ? ['source', 'describe'] : [id]);
    const line = answerLine(id, a, draft);
    into.push({
      kind: 'you',
      id,
      text: line.text,
      photos: line.photos,
      editable: true,
      editing: (state.editing === id && answeredInWords(id, a)) || undefined,
    });
    // What was said after this was answered stands after it, which is where it
    // was said. A refused attempt to change an answer used to be filed above
    // the answer it failed to change.
    attach(into, [id], true);
  };
  for (const id of answeredIn(a, ctx)) {
    const into = photosDoor && draft && id !== 'source' && id !== 'photos' ? after : lead;
    // A question open again from its answer: its line stays exactly where it
    // was, and the block stands where the answer was, under it. Nothing above
    // the answer moves.
    if (state.editing === id && !answeredInWords(id, a)) {
      into.push({ kind: 'scenri', id: `asked-${id}`, text: askedLine(id, a), quiet: true });
      into.push({ kind: 'question', question: questionFor(id, state, ctx, true) });
      continue;
    }
    // the sentence typed at the first question is the door's answer too
    if (id === 'source' && a.source?.via === 'typed') continue;
    exchange(into, id);
  }
  /**
   * The question the conversation is on. It stands whether or not an answer is
   * being changed: taking it off the screen for the length of a change took a
   * block's worth of height out from under the reader, and a conversation
   * scrolled to the bottom went with it. It is still not answerable while a
   * change is open, which the transcript says by dimming it and standing its
   * controls down.
   */
  let open: Question | null = null;
  if (a.source?.door === 'scratch' && !canGenerate && !draft) {
    open = {
      id: 'noengine',
      kind: 'confirm',
      quiet: true,
      prompt: 'Describing someone needs image generation, which is not set up yet.',
      options: [
        { id: 'setup', label: 'Set up' },
        { id: 'photos', label: 'Add photos instead' },
      ],
    };
  } else {
    const next = nextQuestion(a, ctx);
    if (next) open = questionFor(next, state, ctx, false);
    else if (!draft && a.source?.door === 'scratch') {
      if (a.source.via === 'taps') {
        // The last word before anything is drawn: the whole person in one
        // sentence, set apart because it is the brief the picture is drawn
        // from, and the line under the transcript stands open for anything the
        // rows could not ask for.
        open = {
          id: 'agree',
          kind: 'confirm',
          prompt: PROMPT.agree,
          // The whole person, and everything that is always true of them: the
          // last word before anything is drawn says all of it, or a run of
          // questions reads as though nothing had been listening.
          quote: `${lookLine(lookOf(a))}${keepLine(a) ? `, and always ${keepLine(a)}` : ''}.`,
          options: [{ id: 'draw', label: 'Draw the presenter' }],
        };
      } else if (failed) {
        open = {
          id: 'retry',
          kind: 'confirm',
          tone: 'alert',
          prompt: `That did not go through: ${failed}. Nothing was drawn.`,
          options: [{ id: 'retry', label: 'Retry' }],
        };
      }
    }
  }
  if (!draft) {
    if (open) lead.push({ kind: 'question', question: open });
    return lead;
  }
  const record = recordTurns({
    draft,
    canGenerate,
    ui: { extrasDeclined: state.extrasDeclined, failed, editingName: state.editing === 'name' },
    afterCoverage: after,
    asides,
    openId,
    placed,
  });
  const T = [...lead, ...record];
  // A setup question is the one thing being asked: the record's own question
  // waits, and the setup's stands last, after everything that already happened.
  if (open && T[T.length - 1]?.kind === 'question') T.pop();
  if (open) T.push({ kind: 'question', question: open });
  return T;
}

/** The open question, read off the transcript: the last one asked, whatever was said after it. */
export function activeQuestion(turns: Turn[]): Question | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t.kind === 'question') return t.question;
    if (!isAsideTurn(t)) return null;
  }
  return null;
}

/* ------------------------------------------------------------- composer */

/**
 * The composer is the one place a sentence is typed, so it is always there.
 * When a sentence cannot be the answer (a choice to pick, photos to add, a
 * view still drawing) it is off, and `off` says why under the card.
 */
export interface ComposerFor {
  placeholder: string;
  label: string;
  action: string;
  off?: string;
  /** The answer is a colour: the composer carries the app's own colour control. */
  color?: boolean;
}

const QUIET: ComposerFor = { placeholder: 'Nothing to type yet', label: 'Message', action: 'Send' };

/**
 * A look step, asked in words.
 *
 * `handed` is whether the step was given to the composer on purpose, with the
 * Describe button, or is merely open with its chips still on screen. Both take
 * words; only the second has to say so without shouting over the chips, which
 * are still the faster answer and still the first one.
 */
const lookComposer = (step: LookStep, handed: boolean): ComposerFor => ({
  placeholder: handed
    ? (LOOK_SAYS_PLACEHOLDER[step] ?? 'In your words')
    : LOOK_COLOUR.has(step)
      ? 'Tap a swatch above, or say the colour'
      : 'Tap one above, or describe it',
  label: 'Describe it',
  action: 'Send',
  color: LOOK_COLOUR.has(step),
});

/** A detail, asked in words: what it looks like, or where it is. */
function traitComposer(qid: string, handed: boolean): ComposerFor {
  const trait = traitOfQid(qid);
  const t = trait ? traitOf(trait.id) : undefined;
  // the words, not the picture: what to attach is said on the way in
  const said = trait?.part === 'where' ? 'Where it is, in your words' : (t?.saying ?? 'What it looks like');
  const beside =
    trait?.part === 'where'
      ? 'Tap one above, or say where it is'
      : `Tap one above, or ${(t?.saying ?? 'describe it').toLowerCase()}`;
  return { placeholder: handed ? said : beside, label: t?.saying ?? 'Describe it', action: 'Send' };
}

export function composerFor(
  q: Question | null,
  state: CreationState,
  d: DraftLike | null,
  selected: StudioView,
): ComposerFor {
  // an answer or an aside being rewritten has its own field; the composer waits
  if (
    state.editing !== null &&
    (state.editing === 'name' || isAsideEdit(state.editing) || answeredInWords(state.editing, state.answers))
  ) {
    return { ...QUIET, off: 'Finish the change above.' };
  }
  // A tap question handed to the composer: it takes that one question, and only that one.
  if (state.saying === 'keep') {
    return { placeholder: KEEP_PLACEHOLDER, label: 'What should stay the same about them', action: 'Send' };
  }
  if (state.saying && isLookQid(state.saying)) {
    return lookComposer(state.saying.slice('look-'.length) as LookStep, true);
  }
  if (state.saying) return traitComposer(state.saying, true);
  // An answer is being changed above, in its own block: the line waits for it
  // rather than offering to answer a question that is not the one on the floor.
  if (state.editing !== null) return { ...QUIET, off: 'Finish the change above.' };
  if (q) {
    // A question with things to tap is still a question, and a sentence is
    // still an answer to it. The composer used to stand down here and point at
    // the chips, which made the one place a person types the one place they
    // could not: what is typed is simply the custom answer to what is open.
    if (isLookQid(q.id)) return lookComposer(q.id.slice('look-'.length) as LookStep, false);
    if (q.id.startsWith('trait-')) return traitComposer(q.id, false);
    switch (q.id) {
      case 'source':
        return { placeholder: 'Describe them, or choose above', label: 'Describe them', action: 'Send' };
      case 'describe':
      case 'unsure':
        return { placeholder: 'Describe them', label: 'Describe them', action: 'Send' };
      case 'name':
        return { placeholder: 'Their name', label: 'Their name', action: 'Send' };
      case 'identity':
        return {
          placeholder: 'What should change? Shorter hair, older',
          label: 'What should change',
          action: 'Refine',
        };
      // The last word is a decision with a door left open: what the rows could
      // not ask for is said here, in words or in a picture, and it joins what
      // is always true of them.
      case 'agree':
        return {
          placeholder: KEEP_PLACEHOLDER,
          label: 'Anything else that is always true of them',
          action: 'Send',
        };
      // Not one of the rows, then: a detail said in a sentence is exactly what
      // else is always true of them, so it is taken as that.
      case 'traits':
        return {
          placeholder: 'Tap any above, or say it in your own words',
          label: 'Anything else that is always true of them',
          action: 'Send',
        };
      // What the description was missing, said rather than tapped. It joins the
      // description, and the question closes itself if the words filled it.
      case 'gaps':
        return {
          placeholder: 'Tap one above, or say it in your own words',
          label: 'Fill in what is missing',
          action: 'Send',
        };
      case 'photos':
        return { ...QUIET, off: 'Add their photos above.' };
      case 'noengine':
        return { ...QUIET, off: 'Set up image generation, or add photos.' };
      case 'blind':
        return { ...QUIET, off: 'Decide above.' };
      case 'retry':
        return { ...QUIET, off: 'Retry above.' };
    }
  }
  if (!d) return { ...QUIET, off: 'Starting the draft.' };
  if (d.stage === 'analyzing')
    return { ...QUIET, off: `Reading ${d.source === 'photos' ? 'the photos' : 'the face'}.` };
  if (drawing(d)) {
    // the stage says what is being drawn and for how long; saying it again
    // under the composer is the same sentence twice
    const off = '';
    return identityLocked(d)
      ? { placeholder: composerPlaceholder(selected, d), label: 'What should change', action: 'Refine', off }
      : { ...QUIET, off };
  }
  if (!identityLocked(d)) return { ...QUIET, off: 'The face comes first.' };
  return { placeholder: composerPlaceholder(selected, d), label: 'What should change', action: 'Refine' };
}

function composerPlaceholder(selected: StudioView, d: DraftLike): string {
  const who = d.name?.trim() || 'them';
  return selected === 'portrait' ? `What should change about ${who}?` : `Change this view: ${VIEW_NAME[selected]}`;
}

/** The setup question a typed sentence goes to: the one being said in words, else the open text question. */
export function sentenceTarget(state: CreationState, open: Question | null): Qid | 'keep' | null {
  if (state.saying) return state.saying;
  if (open && isQid(open.id) && (open.id === 'source' || open.id === 'describe')) return open.id;
  // An open step or detail takes words without being handed over first: typing
  // is the same custom answer the Describe button opens, and the only one a
  // person reaches for when none of the chips is them.
  if (open && isQid(open.id) && (isLookQid(open.id) || open.id.startsWith('trait-'))) return open.id;
  // the read-back's line is open the whole time: what is typed there is what
  // else is always true of them
  if (open?.id === 'agree') return 'keep';
  return null;
}

export { UNSURE_LINE };
