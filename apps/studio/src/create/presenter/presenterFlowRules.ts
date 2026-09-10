import {
  type Answer,
  type Aside,
  type Question,
  type Turn,
  asideTurns,
  choiceFromText,
  isAsideTurn,
  openQuestionId,
} from '../../conversation/question.js';
import { type CreationState, UNSURE_LINE } from './creationState.js';
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
  answeredIn,
  descriptionGaps,
  inTableOrder,
  isLookQid,
  isQid,
  lookOf,
  nextQuestion,
  traitDetails,
  traitOfQid,
} from './presenterQuestions.js';
import { recordTurns } from './presenterRecordTurns.js';
import {
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
import { TRAITS, type TraitId, keepSentence, traitOf } from './presenterTraits.js';

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
  asideReply,
  type AsidePhase,
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
  if (a.source?.via === 'taps') return lookSentence(lookOf(a));
  const said = (a.describe ?? '').trim();
  const picks = a.gaps && a.gaps !== 'skipped' ? a.gaps : {};
  const build = picks.build ? `${said.replace(/[.\s]+$/, '')}, ${picks.build} build` : said;
  return castSentence(
    { steer: (picks.who as Steer) ?? null, age: (picks.age as Age) ?? null, tone: null, hair: null },
    build,
  );
}

/**
 * Everything that stays the same about them, as one sentence: the details
 * they chose and answered, in the table's order, and then anything else they
 * said at the last moment. One sentence, because that is what a prompt
 * carries and what the record's identity notes hold.
 */
export function compileKeep(a: Answers): string {
  const details = keepSentence(traitDetails(a), inTableOrder(a.traits ?? []));
  const said = (a.keep ?? '').trim();
  return [details, said].filter(Boolean).join(', ');
}

/** The pictures of each detail, for the draft to draw them from. */
export function compileRefs(a: Answers): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [id, detail] of Object.entries(traitDetails(a))) if (detail?.refs?.length) out[id] = detail.refs;
  return out;
}

/**
 * The answers a draft carries, for a page opened on it with none of its own:
 * another tab, a cleared session, a draft seeded from outside. The person is
 * already drawn, so the setup reads as done, and every pencil still works.
 */
export function seedFromDraft(d: DraftLike): Answers {
  if (d.source === 'photos') {
    return { source: { door: 'photos', via: 'taps' }, photos: { hashes: d.sources ?? [], attested: true } };
  }
  return { source: { door: 'scratch', via: 'typed' }, describe: d.direction ?? '', traits: [] };
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

/** The questions answered in a sentence typed into their own field, in place. */
export const TEXT_QIDS: ReadonlySet<Qid> = new Set<Qid>(['describe', 'keep']);

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
      describe: step === 'who' ? 'Describe instead' : LOOK_SAYS[step],
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
      describe: 'Say where',
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
      describe: t.saying,
      attach: 'Add a reference',
      refs: what?.refs ?? [],
      attaching: state.uploading > 0,
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
      return { text: (a.keep ?? '').trim() };
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
  const words = a[`trait-${trait.id}`]?.words ?? '';
  return { text: t.options.find((o) => o.id === words)?.label ?? cap(words) };
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

function shape(args: FlowArgs, asides: Aside[], openId: string | null): Turn[] {
  const placed = new Set<Aside>();
  const T = build(args, asides, openId, placed);
  // A sentence with nothing of a person in it waits on its own question. What
  // was said follows the last turn, in order: before that question when it
  // came before, after it when it came after.
  const left = asides.filter((a) => !placed.has(a)).sort(byAt);
  const u = args.state.unsure;
  for (const a of left) if (!u || a.at < u.at) T.push(...asideTurns(a));
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
    for (const a of left) if (a.at >= u.at) T.push(...asideTurns(a));
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
  const attach = (into: Turn[], ids: string[]) => {
    const mine = asides.filter((x) => !placed.has(x) && !!x.q && x.q !== openId && ids.includes(x.q)).sort(byAt);
    for (const x of mine) {
      placed.add(x);
      into.push(...asideTurns(x));
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
      editing: (state.editing === id && TEXT_QIDS.has(id)) || undefined,
    });
  };
  for (const id of answeredIn(a, ctx)) {
    const into = photosDoor && draft && id !== 'source' && id !== 'photos' ? after : lead;
    // A question open again from its answer: its line stays exactly where it
    // was, and the block stands where the answer was, under it. Nothing above
    // the answer moves.
    if (state.editing === id && !TEXT_QIDS.has(id)) {
      into.push({ kind: 'scenri', id: `asked-${id}`, text: askedLine(id, a), quiet: true });
      into.push({ kind: 'question', question: questionFor(id, state, ctx, true) });
      continue;
    }
    // the sentence typed at the first question is the door's answer too
    if (id === 'source' && a.source?.via === 'typed') continue;
    exchange(into, id);
  }
  // one question at a time: while an answer is open again, nothing else asks
  const editingSetup = state.editing !== null && state.editing !== 'name';
  let open: Question | null = null;
  if (!editingSetup) {
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
          // sentence, and a way to add what the rows could not ask for.
          open = {
            id: 'agree',
            kind: 'confirm',
            prompt: `${lookLine(lookOf(a))}. Shall I draw them?`,
            options: [
              { id: 'draw', label: 'Draw them' },
              { id: 'add', label: a.keep?.trim() ? 'Add another' : 'Add a detail' },
            ],
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
  // One question at a time. A setup question, open or open again, is the one
  // thing being asked: the record's own question waits, and the open one
  // stands last, after everything that already happened.
  if ((editingSetup || open) && T[T.length - 1]?.kind === 'question') T.pop();
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

export function composerFor(
  q: Question | null,
  state: CreationState,
  d: DraftLike | null,
  selected: StudioView,
): ComposerFor {
  // an answer being rewritten has its own field; the composer waits
  if (state.editing !== null && (state.editing === 'name' || TEXT_QIDS.has(state.editing))) {
    return { ...QUIET, off: 'Finish the change above.' };
  }
  // A tap question handed to the composer: it takes that one question, and only that one.
  if (state.saying === 'keep') {
    return {
      placeholder: 'A tattoo, glasses, a scar: something always true of them',
      label: 'What should stay the same about them',
      action: 'Send',
    };
  }
  if (state.saying && isLookQid(state.saying)) {
    const step = state.saying.slice('look-'.length) as LookStep;
    return {
      placeholder: LOOK_SAYS_PLACEHOLDER[step] ?? 'In your words',
      label: 'Describe it',
      action: 'Send',
      color: LOOK_COLOUR.has(step),
    };
  }
  if (state.saying) {
    const trait = traitOfQid(state.saying);
    const t = trait ? traitOf(trait.id) : undefined;
    return {
      placeholder: trait?.part === 'where' ? 'Where it is, in your words' : (t?.refHint ?? 'What it looks like'),
      label: t?.saying ?? 'Describe it',
      action: 'Send',
    };
  }
  if (q) {
    // A question with things to tap owns the answer: the composer stands down
    // rather than competing with it, and says where the answer is.
    if (isLookQid(q.id) || q.id.startsWith('trait-')) return { ...QUIET, off: 'Tap one above.' };
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
      case 'agree':
      case 'traits':
        return { ...QUIET, off: 'Choose above.' };
      case 'gaps':
        return { ...QUIET, off: 'Pick above, or skip.' };
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
  if (d.stage === 'analyzing') return { ...QUIET, off: 'Reading the photos.' };
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
  return null;
}

export { UNSURE_LINE };
