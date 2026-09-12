import { TRAITS, type TraitId, saysWhere, traitOf } from './presenterTraits.js';
import { saysAge, saysWho } from './presenterStudioRules.js';

/**
 * The questions a presenter is made from, as one table.
 *
 * This file is the whole of the setup workflow: which questions exist, when
 * each one is asked, what each one depends on, and what changing an answer
 * costs. Everything else (the words on screen, the blocks, the composer, the
 * drawing) reads this table and adds nothing to it. Another engineer can
 * answer "what does editing the hair colour take back?" from here alone.
 *
 * Answers are keyed by a stable question id and nothing is keyed on position:
 * the order of `SPECS` is the order the questions are asked in and the order
 * the transcript reads them back in, and reordering it moves no answer.
 *
 * Two ideas carry the model. `applies` says whether a question exists at all
 * given the other answers (the photos question exists only behind the photos
 * door; a tattoo's question exists only while a tattoo is chosen). `dependsOn`
 * says which answers this one was given in the light of, so that changing one
 * of those takes this one back (the follow-up to a description is answered
 * about that description). Everything not named here is independent: a hair
 * colour changed leaves the build where it was.
 */
export type Source = 'scratch' | 'photos';

export const LOOK_ORDER = ['who', 'age', 'hair', 'length', 'skin', 'build'] as const;
export type LookStep = (typeof LOOK_ORDER)[number];
export type LookQid = `look-${LookStep}`;
export type TraitQid = `trait-${TraitId}`;
export type WhereQid = `trait-${TraitId}-where`;
export type Qid = 'source' | 'photos' | LookQid | 'describe' | 'gaps' | 'traits' | TraitQid | WhereQid | 'keep';

/** The answers a picture can ride with: the chosen details, and anything else said at the last moment. */
export type RefQid = TraitQid | 'keep';

/**
 * Which door, and how the person behind it is given: tapped one row at a
 * time, described in a sentence after the door was chosen, or typed straight
 * at the first question, which is the same sentence with no door tapped first.
 */
export interface Door {
  door: Source;
  via: 'taps' | 'words' | 'typed';
}

/** The photographs so far. Answered once a draft has been made from them. */
export interface PhotosAnswer {
  hashes: string[];
  attested: boolean;
}

/**
 * What was said at a question that offers options: what was tapped, and their
 * own words about it.
 *
 * The two are kept apart on purpose. A chip is a base, and words beside it
 * qualify that base rather than replace it: somebody who taps Athletic and
 * then says "narrower shoulders" means both, and a single field could only
 * keep one of them. They are joined where a sentence is built and nowhere
 * else, which is what makes it impossible for the pick to end up inside the
 * words and be said twice.
 */
export interface Given {
  /** The option tapped, by id, which is the words an engine is given. A hex on a colour row, PASSED for the way past. */
  pick?: string;
  /** Their own words: the whole answer when nothing was tapped, a qualifier of the pick when something was. */
  words?: string;
}

/** One distinctive detail: what it looks like, and pictures of the thing itself. */
export interface TraitWhat extends Given {
  /** Pictures of the detail, never of a person. Kept while the trait is chosen. */
  refs: string[];
}

/** A step passed over: remembered, so it is asked once. */
export const PASSED = 'either';

/**
 * The whole of what was said at one question, for a compiler, a comparator or
 * a read-back. The way past says nothing, so it contributes nothing.
 */
export const saidOf = (v: Given | undefined): string =>
  [v?.pick === PASSED ? '' : v?.pick?.trim(), v?.words?.trim()].filter(Boolean).join(', ');

/**
 * Whether anything was said at all: a chip, words, or both.
 *
 * Not the same question as `saidOf`, and the difference is the way past. Skip
 * is an answer, and a real one, but it contributes nothing to the sentence, so
 * a question that counted answers by what they compile to asked the skipped
 * row again forever.
 */
export const wasGiven = (v: Given | undefined): boolean => !!(v?.pick || v?.words?.trim());

export type Values = {
  source: Door;
  photos: PhotosAnswer;
  describe: string;
  gaps: Record<string, string> | 'skipped';
  traits: TraitId[];
  /**
   * Anything the rows could not ask for, in their own words, with a picture of
   * it if there is one: the same shape as a detail, because that is what it is.
   */
  keep: TraitWhat;
} & { [K in LookQid]: Given } & { [K in TraitQid]: TraitWhat } & { [K in WhereQid]: Given };

export type Answers = { [K in Qid]?: Values[K] };

/** What the setup questions can see of the draft, once one exists. */
export interface FlowContext {
  draft: {
    source: 'synthetic' | 'photos';
    stage: string;
    keep?: string;
    views: { portrait: { status: string } };
  } | null;
  canGenerate: boolean;
}

export const NO_DRAFT: FlowContext = { draft: null, canGenerate: true };

interface Spec {
  id: Qid;
  /** Whether the question exists at all, given the other answers: an answer to one that does not is unsound. */
  applies: (a: Answers, ctx: FlowContext) => boolean;
  /**
   * Whether it is time to ask it. Order, not validity: a question not yet
   * ready keeps any answer it already has, so a sentence changed does not
   * take back what was said about the person after it.
   */
  ready?: (a: Answers, ctx: FlowContext) => boolean;
  /**
   * The answers this one was given in the light of. When one of them changes
   * (as `changed` decides), this answer is taken back.
   */
  dependsOn?: { on: Qid; changed?: (before: unknown, after: unknown) => boolean }[];
  /** The question never blocks: the flow goes on without an answer. */
  optional?: boolean;
  /**
   * Not taken back by a change earlier in the run.
   *
   * The order rule below is the semantic of this conversation and holds for
   * every question that is a reply: one given halfway up was given to a run
   * that no longer stands, so it is asked again. It has exactly one
   * exception, and `keep` is it. Nothing asks for what is in it, so there is
   * no question to ask again: a fact volunteered about the person would
   * simply be gone, and gone silently, which is how somebody could say "he
   * has a prosthetic left arm", watch it land in the conversation, change
   * their mind about a hair colour, and have it not be true of the presenter
   * any more. It still goes when it no longer applies.
   */
  sticky?: true;
}

const scratch = (a: Answers) => a.source?.door === 'scratch';
const taps = (a: Answers) => scratch(a) && a.source?.via === 'taps';
const words = (a: Answers) => scratch(a) && a.source?.via !== 'taps';
const photos = (a: Answers) => a.source?.door === 'photos';

const BUILD_WORDS =
  /\b(slim|slender|athletic|average|fuller|curvy|broad|lean|muscular|petite|stocky|heavy|thin|plus.size)\b/i;

export type Gap = 'who' | 'age' | 'build';

/**
 * What a description leaves out that a roll cannot guess. Who and age are
 * load-bearing: unsteered, the roll returns the same narrow default. Build
 * is asked only alongside them, when the sentence is short.
 */
export function descriptionGaps(text: string): Gap[] {
  const t = text.trim();
  const n = t.split(/\s+/).filter(Boolean).length;
  const gaps: Gap[] = [];
  if (!saysWho.test(t)) gaps.push('who');
  if (!saysAge.test(t)) gaps.push('age');
  if (gaps.length && !BUILD_WORDS.test(t) && n < 8) gaps.push('build');
  return gaps;
}

const lookDone = (a: Answers) => LOOK_ORDER.every((s) => a[`look-${s}`] !== undefined);
const gapsApply = (a: Answers) => words(a) && a.describe !== undefined && descriptionGaps(a.describe).length > 0;
const describeDone = (a: Answers) => words(a) && a.describe !== undefined && (!gapsApply(a) || a.gaps !== undefined);

/**
 * The photographs are asked what stays once, between the face and the rest of
 * the set: after the draft holds them and the face stands, before anything is
 * drawn from it. A draft that already carries the answer is not asked again.
 */
const photosMoment = (a: Answers, ctx: FlowContext) =>
  photos(a) &&
  !!ctx.draft &&
  ctx.draft.source === 'photos' &&
  ctx.canGenerate &&
  ctx.draft.stage !== 'analyzing' &&
  ctx.draft.views.portrait.status === 'approved' &&
  (a.traits !== undefined || !ctx.draft.keep?.trim());

/**
 * A described person is asked what else is always true of them before the
 * face is drawn, never after: once a draft holds the person, the moment has
 * passed, and a detail is then added from the chooser's own pencil.
 */
const traitsMoment = (a: Answers, ctx: FlowContext) =>
  taps(a) ? lookDone(a) : words(a) ? describeDone(a) : photosMoment(a, ctx);
/** A detail is about a person: one described, or one whose photographs a draft already holds. */
const traitsApply = (a: Answers, ctx: FlowContext) => scratch(a) || (photos(a) && !!ctx.draft);

const traitChosen = (id: TraitId) => (a: Answers) => !!a.traits?.includes(id);
const traitAnswered = (id: TraitId) => (a: Answers) => wasGiven(a[`trait-${id}`]);
const whereApplies = (id: TraitId) => (a: Answers) =>
  traitChosen(id)(a) && traitAnswered(id)(a) && !!traitOf(id)?.where && !saysWhere(saidOf(a[`trait-${id}`]));

/** Whether a detail was among the ones chosen, for the comparator below. */
const among = (v: unknown, id: TraitId) => Array.isArray(v) && (v as TraitId[]).includes(id);

const traitsDone = (a: Answers, ctx: FlowContext): boolean =>
  traitsMoment(a, ctx) &&
  a.traits !== undefined &&
  a.traits.every((id) => traitAnswered(id)(a) && (!whereApplies(id)(a) || a[`trait-${id}-where`] !== undefined));

const differs = (x: unknown, y: unknown) => JSON.stringify(x) !== JSON.stringify(y);

/** The questions, in the order they are asked. */
export const SPECS: readonly Spec[] = [
  { id: 'source', applies: () => true },
  { id: 'photos', applies: photos },
  ...LOOK_ORDER.map((s): Spec => ({ id: `look-${s}`, applies: taps })),
  { id: 'describe', applies: words },
  { id: 'gaps', applies: gapsApply, dependsOn: [{ on: 'describe' }] },
  { id: 'traits', applies: traitsApply, ready: traitsMoment },
  ...TRAITS.flatMap((t): Spec[] => [
    // A detail is answered about itself, so it survives the other details
    // changing: choosing one more says nothing about the glasses already
    // described. Declaring it here is what lifts it out of the order rule.
    {
      id: `trait-${t.id}`,
      applies: traitChosen(t.id),
      dependsOn: [{ on: 'traits', changed: (b, a) => among(b, t.id) !== among(a, t.id) }],
    },
    {
      id: `trait-${t.id}-where`,
      applies: whereApplies(t.id),
      // placed in the light of what it looks like, not of the pictures of it
      dependsOn: [
        {
          on: `trait-${t.id}`,
          changed: (b, a) => saidOf(b as TraitWhat | undefined) !== saidOf(a as TraitWhat | undefined),
        },
        { on: 'traits', changed: (b, a) => among(b, t.id) !== among(a, t.id) },
      ],
    },
  ]),
  // what else stays true of them, in their own words: never required
  { id: 'keep', applies: scratch, ready: traitsDone, optional: true, sticky: true },
];

const SPEC = new Map(SPECS.map((s) => [s.id, s]));

/**
 * Where a question stands in the run, for anything that has to reason about
 * "after". Unknown ids sort last, so a stray one is never treated as early.
 */
export const orderOf = (id: string): number => {
  const i = SPECS.findIndex((s) => s.id === id);
  return i < 0 ? SPECS.length : i;
};

export const specOf = (id: Qid): Spec => SPEC.get(id) as Spec;

export function applies(id: Qid, a: Answers, ctx: FlowContext): boolean {
  return specOf(id).applies(a, ctx);
}

/**
 * Whether a question has its answer. The photographs are answered by the draft
 * made from them, and a detail by its words: pictures alone are not an answer.
 */
export function answered(id: Qid, a: Answers, ctx: FlowContext): boolean {
  if (id === 'photos') return !!ctx.draft && ctx.draft.source === 'photos';
  const v = a[id];
  if (v === undefined) return false;
  // A question with options is answered by what was said at it, whichever
  // half said it: a chip, their own words, or both. An empty pair is not an
  // answer, and neither are pictures on their own.
  if (isLookQid(id) || isTraitQid(id)) return wasGiven(v as Given);
  return true;
}

/** The questions that exist and are answered, in the order they are asked. */
export function answeredIn(a: Answers, ctx: FlowContext): Qid[] {
  return SPECS.filter((s) => s.applies(a, ctx) && answered(s.id, a, ctx)).map((s) => s.id);
}

/**
 * The next thing to ask: the first question that exists, is required and has
 * no answer. Null when the setup is complete. Nothing counts up to it; it is
 * read off the answers every time, so no answer changed anywhere can leave
 * the conversation pointing at a question that is not there.
 */
export function nextQuestion(a: Answers, ctx: FlowContext): Qid | null {
  return (
    SPECS.find((s) => !s.optional && s.applies(a, ctx) && (s.ready?.(a, ctx) ?? true) && !answered(s.id, a, ctx))?.id ??
    null
  );
}

/** Whether a question may be asked now: it exists and its moment has come. */
export function askable(id: Qid, a: Answers, ctx: FlowContext): boolean {
  const s = specOf(id);
  return s.applies(a, ctx) && (s.ready?.(a, ctx) ?? true);
}

/**
 * The answers after a change.
 *
 * The changed answers take their new values, and the conversation carries on
 * from there: everything asked after the earliest of them is taken back and
 * asked again. A conversation reads forward, so an answer changed halfway up
 * makes the rest of it a reply to a question that was not the one asked; the
 * only honest thing is to ask again from that point. It is also what a chat
 * does, and this is a chat.
 *
 * Then the two rules that outlive the order: an answer given in the light of a
 * changed one goes with it, and an answer to a question that no longer exists
 * goes too, until nothing else has to.
 */
export function commit(a: Answers, patch: Partial<Answers>, ctx: FlowContext): Answers {
  const next: Answers = { ...a };
  const changed = new Set<Qid>();
  const given = new Set(Object.keys(patch) as Qid[]);
  for (const [k, v] of Object.entries(patch) as [Qid, Values[Qid] | undefined][]) {
    if (!differs(a[k], v)) continue;
    if (v === undefined) delete next[k];
    else (next as Record<string, unknown>)[k] = v;
    changed.add(k);
  }
  // everything the conversation asked after the earliest thing that changed
  if (changed.size) {
    const order = SPECS.map((s) => s.id);
    const first = Math.min(...[...changed].map((id) => order.indexOf(id)));
    // What a question says it was answered in the light of is more specific
    // than where it sits, so a declaration wins over the order: the details
    // already described are not replies to the chooser, and taking one more
    // detail must not ask for all of them again. Read from the changes as
    // they stood before this pass, so the pass cannot widen its own reason.
    const already = new Set(changed);
    const declared = (s: Spec) => (s.dependsOn ?? []).some((d) => already.has(d.on));
    for (const s of SPECS) {
      if (order.indexOf(s.id) <= first || given.has(s.id) || next[s.id] === undefined || s.sticky) continue;
      if (declared(s)) continue;
      delete next[s.id];
      changed.add(s.id);
    }
  }
  let moved = true;
  while (moved) {
    moved = false;
    for (const s of SPECS) {
      if (next[s.id] === undefined) continue;
      const dependent =
        // An answer given in this very change is the change, never a casualty
        // of it: choosing a detail and answering it in one go must not take
        // the answer straight back out again. The order rule above already
        // says this about position; it has to hold for a declaration too.
        !given.has(s.id) &&
        (s.dependsOn ?? []).some((d) => changed.has(d.on) && (d.changed ? d.changed(a[d.on], next[d.on]) : true));
      if (dependent || !s.applies(next, ctx)) {
        delete next[s.id];
        changed.add(s.id);
        moved = true;
      }
    }
  }
  return next;
}

/** Every question that is answered but should not be: none, when the answers are sound. */
export function unsound(a: Answers, ctx: FlowContext): Qid[] {
  return (Object.keys(a) as Qid[]).filter((id) => {
    const s = SPEC.get(id);
    return !s?.applies(a, ctx);
  });
}

/** The details chosen and answered, as the table keeps them. */
export function traitDetails(
  a: Answers,
): Partial<Record<TraitId, { words?: string; where?: string; refs?: string[] }>> {
  const out: Partial<Record<TraitId, { words?: string; where?: string; refs?: string[] }>> = {};
  for (const id of a.traits ?? []) {
    const what = a[`trait-${id}`];
    if (!what) continue;
    // The two halves of each answer are joined here and nowhere else: what was
    // tapped, then their words about it.
    out[id] = {
      words: saidOf(what) || undefined,
      where: saidOf(a[`trait-${id}-where`]) || undefined,
      refs: what.refs.length ? what.refs : undefined,
    };
  }
  return out;
}

/** The look as answered, by row, for the sentence and the read-back. */
export function lookOf(a: Answers): Partial<Record<LookStep, Given>> {
  const out: Partial<Record<LookStep, Given>> = {};
  for (const s of LOOK_ORDER) {
    const v = a[`look-${s}`];
    if (v !== undefined) out[s] = v;
  }
  return out;
}

/** The chosen details in the table's order, whatever order they were tapped in. */
export const inTableOrder = (ids: TraitId[]): TraitId[] => TRAITS.map((t) => t.id).filter((id) => ids.includes(id));

export const isLookQid = (id: string): id is LookQid => id.startsWith('look-');
export const isTraitQid = (id: string): id is TraitQid | WhereQid => id.startsWith('trait-');
export const isQid = (id: string): id is Qid => SPEC.has(id as Qid);

/** The trait a detail question is about, and which half of it. */
export function traitOfQid(id: string): { id: TraitId; part: 'what' | 'where' } | null {
  if (!id.startsWith('trait-')) return null;
  const where = id.endsWith('-where');
  const t = (where ? id.slice('trait-'.length, -'-where'.length) : id.slice('trait-'.length)) as TraitId;
  return traitOf(t) ? { id: t, part: where ? 'where' : 'what' } : null;
}
