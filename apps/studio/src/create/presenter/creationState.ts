import type { Aside, NothingKind } from '../../conversation/question.js';

/** An aside being rewritten, named by when it was said. */
export type AsideEdit = `aside:${string}`;
export const isAsideEdit = (v: unknown): v is AsideEdit => typeof v === 'string' && v.startsWith('aside:');
export const asideEditAt = (v: AsideEdit): string => v.slice('aside:'.length);
import {
  type Answers,
  type FlowContext,
  type Given,
  NO_DRAFT,
  PASSED,
  type Qid,
  type RefQid,
  type TraitQid,
  applies,
  commit,
  isLookQid,
  isQid,
  saidOf,
  orderOf,
  nextQuestion,
  traitOfQid,
  type LookStep,
} from './presenterQuestions.js';
import { LOOK_ROWS } from './presenterLook.js';
import { type TraitId, traitOf } from './presenterTraits.js';

/**
 * The state of a presenter being made, and every way it changes.
 *
 * One structure, one reducer, no effects: a tap, a sentence, a pencil, a
 * picture uploaded, all of them are one action each, and each action leaves
 * the state whole. The transcript, the composer and the drawing are read off
 * it; none of them holds a piece of it.
 *
 * `answers` is the canonical record of what the person said, keyed by question
 * (see `presenterQuestions`). Everything else here is the conversation around
 * those answers: which one is being said again, which one is being answered
 * in words, what is in the composer, what was said that answered nothing.
 *
 * `revision` counts every change to the answers. Work that started under an
 * older revision (an upload, a draft being made) is stale, and the reducer
 * refuses it, so nothing that finished late can put an answer back that the
 * person already took away.
 */
export interface Unsure {
  said: string;
  q: string | null;
  at: string;
}

export interface CreationState {
  answers: Answers;
  revision: number;
  /** A question reopened from its answer, until it is saved or cancelled. The name lives on the draft. */
  editing: Qid | 'name' | AsideEdit | null;
  /**
   * The composer's target while a tap question is answered in words, or while
   * a detail is being added at the read-back. Null: the composer belongs to
   * whatever text question is open, or to the draft.
   */
  saying: Qid | 'keep' | null;
  /**
   * How many times a question has been handed to the line. The line takes the
   * keyboard each time it is opened, and opening the same question twice is
   * two openings: without this the second press handed it nothing new to react
   * to, and the caret stayed where it was.
   */
  says: number;
  text: string;
  /** A colour picked for a colour step, waiting on Send with any words beside it. */
  colour: { step: Qid; hex: string } | null;
  /**
   * A detail whose picture is being changed, and the picture it had when the
   * line was opened on it. A picture in the line is part of the answer being
   * written, like the words beside it: kept when the answer is given, and put
   * back as it was when the line closes without one.
   */
  composing: { id: RefQid; refs: string[] } | null;
  /** Sentences that answered nothing, each kept where it was said. */
  asides: Aside[];
  /** A sentence with nothing of a person in it, waiting to be drawn from anyway or replaced. */
  unsure: Unsure | null;
  /** "Save as is" was chosen once; the extras question is not asked again. */
  extrasDeclined: boolean;
  /** Uploads in flight. */
  uploading: number;
}

export const EMPTY_STATE: CreationState = {
  answers: {},
  revision: 0,
  editing: null,
  saying: null,
  says: 0,
  text: '',
  colour: null,
  composing: null,
  asides: [],
  unsure: null,
  extrasDeclined: false,
  uploading: 0,
};

/** A sentence with nothing of a person in it, once a proper one came: the record's word for it. */
export const UNSURE_LINE = 'That did not read as a description of someone.';

export type Action =
  /** An answer, or several given together (a door and the sentence typed at it). */
  | { type: 'answer'; patch: Partial<Answers>; ctx: FlowContext }
  /** A question reopened from its answer. */
  | { type: 'edit'; id: Qid | 'name' | AsideEdit }
  /** An aside said again, in the same place: new words, and the answer to them. */
  | { type: 'amend-aside'; at: string; said: string; reply: string; kind: NothingKind; ctx: FlowContext }
  /** An aside that turned out to be an answer after all: it goes, the answer stays. */
  | { type: 'drop-aside'; at: string }
  /**
   * A picture of a detail landed, or was taken off. One at a time: a detail
   * rides after the person in the engine's budget, so a second angle of the
   * same thing is dropped before it is drawn from, and a chip that promises
   * otherwise is a lie. Refused once the detail is no longer chosen.
   */
  | { type: 'ref'; id: RefQid; hash: string; remove?: boolean }
  | { type: 'cancel-edit' }
  /** A tap question handed to the composer, or taken back from it. */
  | { type: 'say'; id: Qid | 'keep' | null }
  | { type: 'text'; text: string }
  /** A colour picked for a step. `step` is the step the control was shown for. */
  | { type: 'colour'; hex: string | null; step: Qid | 'keep' | null }
  | { type: 'aside'; aside: Aside }
  | { type: 'unsure'; unsure: Unsure }
  /** The waiting sentence is settled: kept in the record, with nothing drawn from it. */
  | { type: 'settle-unsure' }
  | { type: 'upload-begin' }
  /** A photograph landed. Refused when the photographs are no longer the question. */
  | { type: 'uploaded'; hash: string; max: number }
  | { type: 'upload-end' }
  | { type: 'remove-photo'; hash: string }
  | { type: 'attest'; checked: boolean }
  | { type: 'extras-declined' }
  /** Everything goes, except words to start the next person from. */
  | { type: 'start-over'; text?: string }
  /** What the session remembered, at a reload. */
  | { type: 'restore'; answers: Answers; revision: number; asides?: Aside[] };

const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);

/** The detail a question is about, when it is the half a picture belongs to. */
function pictureQid(id: Qid | 'keep' | 'name' | null): RefQid | null {
  if (!id || id === 'name') return null;
  // what is said at the last moment is a detail like any other, picture and all
  if (id === 'keep') return 'keep';
  const t = traitOfQid(id);
  return t && t.part === 'what' ? (`trait-${t.id}` as TraitQid) : null;
}

/** The line opens on a detail: what its picture is now is what a cancel puts back. */
function opening(s: CreationState, id: Qid | 'keep' | 'name' | null): CreationState['composing'] {
  const q = pictureQid(id);
  return q ? { id: q, refs: s.answers[q]?.refs ?? [] } : null;
}

/** The line closed without an answer: the picture it was given back as it was. */
function restored(s: CreationState): Answers {
  const was = s.composing;
  if (!was) return s.answers;
  const now = s.answers[was.id];
  if (!now || same(now.refs, was.refs)) return s.answers;
  // a detail that had nothing but the picture is simply not answered
  if (!saidOf(now) && !was.refs.length) {
    const rest = { ...s.answers };
    delete rest[was.id];
    return rest;
  }
  return { ...s.answers, [was.id]: { ...now, refs: was.refs } };
}

/**
 * What the line is given when an answer with options is reopened.
 *
 * Only for a question that offers options: the text questions rewrite their
 * words in their own bubble and have never needed the line. A colour of their
 * own goes back into the colour control, which is the only way back to it once
 * a colour row has been answered.
 */
function reopened(
  s: CreationState,
  id: Qid,
): { saying: Qid; text: string; colour: CreationState['colour'] } | undefined {
  if (!isLookQid(id) && !traitOfQid(id)) return undefined;
  const v = s.answers[id] as Given | undefined;
  if (!v) return undefined;
  return {
    saying: id,
    text: v.words ?? '',
    colour: v.pick?.startsWith('#') ? { step: id, hex: v.pick } : null,
  };
}

/**
 * The asides that still stand.
 *
 * Two ways one stops standing. Its question may no longer exist at all, which
 * is the `applies` half. Or the conversation may have been taken back past the
 * point where it was said, which is the same rule every answer obeys: a
 * sentence said at a question that has just been asked again was said in a run
 * that no longer happened, and leaving it behind floats it under a question it
 * was never a reply to.
 */
function keptAsides(asides: Aside[], answers: Answers, ctx: FlowContext, from?: number): Aside[] {
  return asides.filter((a) => {
    if (!a.q || !isQid(a.q)) return true;
    if (!applies(a.q, answers, ctx)) return false;
    // An attempt to change an answer stands in that answer's own bubble until
    // the question is answered again, and goes when it is: a correction in
    // progress is not a thing that was said to anybody, and leaving it behind
    // would put the words somebody thought better of under the answer they
    // replaced them with.
    if (a.edit && answers[a.q] !== undefined) return false;
    // said at the question being answered, or before it: it stands. Said after
    // it: that question is being asked again, so it does not.
    return from === undefined || orderOf(a.q) <= from;
  });
}

/**
 * The earliest question a change touches, in the run's own order.
 *
 * It does not ask whether anything was actually truncated. Going forward there
 * is nothing after the question being answered for an aside to be attached to,
 * so the rule costs nothing there; going back it is the whole point, and a
 * question that was reached past but never answered is reached past all the
 * same.
 */
function reachesBack(patch: Partial<Answers>): number | undefined {
  const ids = Object.keys(patch).filter((id) => isQid(id));
  return ids.length ? Math.min(...ids.map(orderOf)) : undefined;
}

/**
 * An aside, with an `at` nothing else is using.
 *
 * The `at` is the turn's identity, so two sentences sharing one are two turns
 * with one key: React reuses a node for a line it does not belong to, and the
 * wrong one animates, dims or opens for editing. Two can share it honestly, a
 * settled sentence carrying the time it was first said, and `nowIso` has only
 * millisecond resolution besides.
 */
function withFreeAt(asides: Aside[], a: Aside): Aside {
  if (!asides.some((x) => x.at === a.at)) return a;
  let n = 1;
  while (asides.some((x) => x.at === `${a.at}#${n}`)) n += 1;
  return { ...a, at: `${a.at}#${n}` };
}

/** The waiting sentence, folded into the record when something else was said. */
function settleUnsure(s: CreationState): CreationState {
  const w = s.unsure;
  if (!w) return s;
  const asides = s.asides.map((a) => (a.q === 'unsure' ? { ...a, q: w.q } : a));
  const settled = withFreeAt(asides, { said: w.said, reply: UNSURE_LINE, q: w.q, at: w.at });
  return { ...s, unsure: null, asides: [...asides, settled] };
}

export function reduce(s: CreationState, action: Action): CreationState {
  switch (action.type) {
    case 'answer': {
      const answers = commit(s.answers, action.patch, action.ctx);
      const moved = !same(answers, s.answers);
      const settled = settleUnsure(s);
      return {
        ...settled,
        answers,
        revision: moved ? s.revision + 1 : s.revision,
        asides: keptAsides(settled.asides, answers, action.ctx, reachesBack(action.patch)),
        editing: null,
        saying: null,
        colour: null,
        // the answer was given: the picture that came with it stays
        composing: null,
        text: '',
      };
    }
    case 'edit': {
      // An answer reopened is reopened whole: the chip lights in its row, and
      // the words that ride with it go back into the line, with the colour
      // control holding a colour of their own. Handing the line the question
      // is what makes the line live at all while an answer is being changed,
      // and it is the only way a chip and words can be changed together. A
      // line that opened empty would also lose a qualifier to the first
      // keystroke, silently.
      const held = isAsideEdit(action.id) || action.id === 'name' ? undefined : reopened(s, action.id);
      return {
        ...s,
        answers: restored(s),
        composing: isAsideEdit(action.id) ? null : opening(s, action.id),
        editing: action.id,
        saying: held?.saying ?? null,
        says: held ? s.says + 1 : s.says,
        colour: held?.colour ?? null,
        text: held?.text ?? '',
      };
    }
    // One rule for every turn in this conversation: a turn said again is a turn
    // re-said, and what came after it was said in a conversation that no longer
    // happened. An answer truncates the answers under it; a sentence said in
    // passing truncates the sentences said after it. It never touches an
    // answer, because nothing was ever conditioned on chatter.
    // One rule for every turn in this conversation: a turn said again is a turn
    // re-said, and the conversation goes back to where it was said. A sentence
    // said in passing was said AT a question, so going back to it goes back to
    // that question: its answer, and everything after it, is from a run that no
    // longer happened, exactly as if the pencil on that answer had been pressed.
    // This used to leave the answers alone, on the grounds that nothing is ever
    // conditioned on chatter. What that produced was a sentence changed at a
    // question whose answer still stood underneath it, unchanged.
    case 'amend-aside': {
      const was = s.asides.find((a) => a.at === action.at);
      const q = was?.q && isQid(was.q) ? (was.q as Qid) : null;
      const answers = q && s.answers[q] !== undefined ? commit(s.answers, { [q]: undefined }, action.ctx) : s.answers;
      // Two orderings had to be made to agree here. The answers are taken back
      // by the run's order; the sentences used to be taken back by the clock.
      // They line up while the clock only ever moves forward, and the moment
      // anything does not, a sentence is left standing at a question that is
      // neither answered nor open. Both are applied.
      const kept = keptAsides(
        s.asides.filter((a) => a.at <= action.at),
        answers,
        action.ctx,
        q ? orderOf(q) : undefined,
      );
      return {
        ...s,
        answers,
        revision: answers === s.answers ? s.revision : s.revision + 1,
        editing: null,
        asides: kept.map((a) =>
          a.at === action.at
            ? { ...a, said: action.said, reply: action.reply, kind: action.kind, rev: (a.rev ?? 0) + 1 }
            : a,
        ),
      };
    }
    case 'drop-aside':
      return { ...s, editing: null, asides: s.asides.filter((a) => a.at < action.at) };
    case 'cancel-edit':
      return { ...s, answers: restored(s), composing: null, editing: null, saying: null, colour: null, text: '' };
    case 'say': {
      const saying = s.saying === action.id ? null : action.id;
      return {
        ...s,
        answers: restored(s),
        composing: opening(s, saying),
        saying,
        says: s.says + 1,
        colour: null,
        text: '',
      };
    }
    case 'text':
      return s.text === action.text ? s : { ...s, text: action.text };
    case 'colour':
      if (!action.hex) return { ...s, colour: null };
      // A colour belongs to the step it was picked on, and to this visit to it.
      // The step comes with the action: the control is shown for whatever step
      // is open, which is no longer the same thing as one handed over by hand.
      return action.step && action.step !== 'keep' ? { ...s, colour: { step: action.step, hex: action.hex } } : s;
    case 'aside': {
      // A sentence with no words in it is not a sentence. Nothing in the flow
      // sends one, but the codec refuses it on the way back in, and a state
      // that cannot survive its own reload is a state that should not exist.
      if (!action.aside.said.trim() || !action.aside.reply.trim()) return { ...s, text: '' };
      // Which side of the answer it stands on is a fact about the moment it was
      // said, so it is written down here rather than guessed at render time.
      const answered = !!action.aside.q && isQid(action.aside.q) && s.answers[action.aside.q] !== undefined;
      const said = answered ? { ...action.aside, after: true as const } : action.aside;
      return { ...s, asides: [...s.asides, withFreeAt(s.asides, said)], text: '' };
    }
    case 'unsure':
      return { ...settleUnsure(s), unsure: action.unsure, text: '' };
    case 'settle-unsure':
      return settleUnsure(s);
    case 'upload-begin':
      return { ...s, uploading: s.uploading + 1 };
    case 'upload-end':
      return { ...s, uploading: Math.max(0, s.uploading - 1) };
    case 'uploaded': {
      // a photograph that lands after the door changed is a photograph of nobody
      if (s.answers.source?.door !== 'photos') return s;
      const had = s.answers.photos ?? { hashes: [], attested: false };
      if (had.hashes.includes(action.hash) || had.hashes.length >= action.max) return s;
      return {
        ...s,
        answers: { ...s.answers, photos: { ...had, hashes: [...had.hashes, action.hash] } },
        revision: s.revision + 1,
      };
    }
    case 'remove-photo': {
      const had = s.answers.photos;
      if (!had?.hashes.includes(action.hash)) return s;
      return {
        ...s,
        answers: { ...s.answers, photos: { ...had, hashes: had.hashes.filter((h) => h !== action.hash) } },
        revision: s.revision + 1,
      };
    }
    case 'attest': {
      if (s.answers.source?.door !== 'photos') return s;
      const had = s.answers.photos ?? { hashes: [], attested: false };
      if (had.attested === action.checked) return s;
      return {
        ...s,
        answers: { ...s.answers, photos: { ...had, attested: action.checked } },
        revision: s.revision + 1,
      };
    }
    case 'ref': {
      // a detail's picture belongs to a detail that is still chosen; what is
      // said at the last moment belongs to nothing but itself
      if (action.id !== 'keep') {
        const trait = action.id.slice('trait-'.length) as TraitId;
        if (!s.answers.traits?.includes(trait)) return s;
      }
      const had = s.answers[action.id] ?? { refs: [] };
      // One picture per detail, replaced when another is chosen: a second angle
      // of the same thing is dropped before it is ever drawn from. What is said
      // at the last moment is not one detail but a list of them, so its
      // pictures gather, one per thing said.
      const refs = action.remove
        ? had.refs.filter((h) => h !== action.hash)
        : action.id === 'keep'
          ? [...had.refs.filter((h) => h !== action.hash), action.hash].slice(-4)
          : [action.hash];
      if (refs.join() === had.refs.join()) return s;
      return { ...s, answers: { ...s.answers, [action.id]: { ...had, refs } }, revision: s.revision + 1 };
    }
    case 'extras-declined':
      return { ...s, extrasDeclined: true };
    case 'start-over':
      return { ...EMPTY_STATE, revision: s.revision + 1, text: action.text ?? '' };
    case 'restore':
      return { ...EMPTY_STATE, answers: action.answers, revision: action.revision, asides: action.asides ?? [] };
  }
}

/**
 * Nothing stands between the answers and the drawing: every required question
 * is answered, none is being said again, none is half-said in the composer.
 */
export function readyToDraw(s: CreationState, ctx: FlowContext): boolean {
  return nextQuestion(s.answers, ctx) === null && !s.editing && !s.saying;
}

/* ---------------------------------------------------------- persistence */

/**
 * What a reload gets back: the answers, their revision, and everything that was
 * said beside them.
 *
 * The asides used to be left out on the grounds that chatter is the moment and
 * the moment is over. It is not: a person who typed something and was answered
 * came back to a conversation that had forgotten both halves, which reads as
 * the app having lost their words rather than having replied to them. The
 * composer's half sentence and a question being said again are still the
 * moment, and those are still dropped.
 */
const STORED = 5;
/** The most that is carried: a long sitting is a long conversation, not a log. */
const ASIDES_MAX = 40;

export function serialize(s: CreationState): string {
  return JSON.stringify({
    v: STORED,
    answers: s.answers,
    revision: s.revision,
    asides: s.asides.slice(-ASIDES_MAX),
  });
}

/** One aside off storage, or null: every field is read, nothing is assumed. */
function asideFrom(v: unknown): Aside | null {
  if (!v || typeof v !== 'object') return null;
  const a = v as Record<string, unknown>;
  if (typeof a.said !== 'string' || typeof a.reply !== 'string' || typeof a.at !== 'string') return null;
  if (!a.said.trim() || !a.reply.trim()) return null;
  const q = typeof a.q === 'string' ? a.q : null;
  const rev = typeof a.rev === 'number' && a.rev > 0 ? a.rev : undefined;
  const kind = typeof a.kind === 'string' ? (a.kind as Aside['kind']) : undefined;
  const after = a.after === true ? true : undefined;
  const edit = a.edit === true ? true : undefined;
  return {
    said: a.said,
    reply: a.reply,
    q,
    at: a.at,
    ...(rev ? { rev } : {}),
    ...(kind ? { kind } : {}),
    ...(after ? { after } : {}),
    ...(edit ? { edit } : {}),
  };
}

/** The options a question offers, for reading an answer written before they were kept apart. */
function optionsOf(id: Qid): readonly { id: string }[] {
  if (isLookQid(id)) return LOOK_ROWS[id.slice('look-'.length) as LookStep].row.options;
  const part = traitOfQid(id);
  const trait = part && traitOf(part.id);
  if (!trait) return [];
  return part.part === 'where' ? (trait.where?.options ?? []) : trait.options;
}

/**
 * One stored string, read as the chip it names or as the words it is.
 *
 * This is the reading the old code made on every render to decide how an
 * answer should be reopened. Making it once, here, is the whole of the
 * upgrade: a string that is one of the question's own option ids was a tap,
 * the way past and a colour of one's own were taps too, and anything else was
 * somebody typing. Both halves compile to the sentence they always compiled
 * to, so a draft resumed this way is not out of step with what it holds.
 */
function asGiven(id: Qid, v: string): Given {
  if (v === PASSED || /^#[0-9a-f]{6}$/i.test(v)) return { pick: v };
  return optionsOf(id).some((o) => o.id === v) ? { pick: v } : { words: v };
}

/** One answer off storage, in the shape this version keeps. */
function upgrade(id: Qid, v: unknown): unknown {
  if (id === 'keep') return typeof v === 'string' ? { words: v, refs: [] } : v;
  if (typeof v === 'string' && (isLookQid(id) || !!traitOfQid(id))) return asGiven(id, v);
  const part = traitOfQid(id);
  if (part?.part === 'what' && v && typeof v === 'object') {
    const had = v as { words?: unknown; pick?: unknown; refs?: unknown };
    const refs = Array.isArray(had.refs) ? (had.refs as string[]) : [];
    if (had.pick !== undefined || typeof had.words !== 'string') return { ...had, refs };
    return { ...asGiven(id, had.words), refs };
  }
  return v;
}

export function deserialize(raw: string | null): { answers: Answers; revision: number; asides: Aside[] } | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as {
      v?: number;
      answers?: Record<string, unknown>;
      revision?: number;
      asides?: unknown;
    };
    // v2 wrote the last-moment detail as bare words; it carries a picture now.
    // v3 kept no asides, and reads back with none rather than being thrown away.
    // v4 kept one field per option question and worked out afterwards whether
    // it held a chip or somebody's own words; `upgrade` below makes that same
    // reading once, on the way in, and writes it down.
    if ((p.v !== STORED && p.v !== 4 && p.v !== 3 && p.v !== 2) || !p.answers || typeof p.answers !== 'object')
      return null;
    const answers: Answers = {};
    // a question the table no longer has is forgotten, never carried
    for (const [k, v] of Object.entries(p.answers)) {
      if (!isQid(k)) continue;
      (answers as Record<string, unknown>)[k] = upgrade(k, v);
    }
    const asides = (Array.isArray(p.asides) ? p.asides : [])
      .map(asideFrom)
      .filter((a): a is Aside => a !== null)
      .slice(-ASIDES_MAX);
    return { answers, revision: typeof p.revision === 'number' ? p.revision : 0, asides };
  } catch {
    return null;
  }
}

export { NO_DRAFT };
