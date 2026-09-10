import type { Aside } from '../../conversation/question.js';
import {
  type Answers,
  type FlowContext,
  NO_DRAFT,
  type Qid,
  type TraitQid,
  applies,
  commit,
  isQid,
  nextQuestion,
  traitOfQid,
} from './presenterQuestions.js';
import type { TraitId } from './presenterTraits.js';

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
  editing: Qid | 'name' | null;
  /**
   * The composer's target while a tap question is answered in words, or while
   * a detail is being added at the read-back. Null: the composer belongs to
   * whatever text question is open, or to the draft.
   */
  saying: Qid | 'keep' | null;
  text: string;
  /** A colour picked for a colour step, waiting on Send with any words beside it. */
  colour: { step: Qid; hex: string } | null;
  /**
   * A detail whose picture is being changed, and the picture it had when the
   * line was opened on it. A picture in the line is part of the answer being
   * written, like the words beside it: kept when the answer is given, and put
   * back as it was when the line closes without one.
   */
  composing: { id: TraitQid; refs: string[] } | null;
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
  | { type: 'edit'; id: Qid | 'name' }
  /**
   * A picture of a detail landed, or was taken off. One at a time: a detail
   * rides after the person in the engine's budget, so a second angle of the
   * same thing is dropped before it is drawn from, and a chip that promises
   * otherwise is a lie. Refused once the detail is no longer chosen.
   */
  | { type: 'ref'; id: TraitQid; hash: string; remove?: boolean }
  | { type: 'cancel-edit' }
  /** A tap question handed to the composer, or taken back from it. */
  | { type: 'say'; id: Qid | 'keep' | null }
  | { type: 'text'; text: string }
  | { type: 'colour'; hex: string | null }
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
  | { type: 'restore'; answers: Answers; revision: number };

const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);

/** The detail a question is about, when it is the half a picture belongs to. */
function pictureQid(id: Qid | 'keep' | 'name' | null): TraitQid | null {
  if (!id || id === 'keep' || id === 'name') return null;
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
  if (!now.words && !was.refs.length) {
    const rest = { ...s.answers };
    delete rest[was.id];
    return rest;
  }
  return { ...s.answers, [was.id]: { ...now, refs: was.refs } };
}

/** The asides that still have a question to stand under. */
function keptAsides(asides: Aside[], answers: Answers, ctx: FlowContext): Aside[] {
  return asides.filter((a) => !a.q || !isQid(a.q) || applies(a.q, answers, ctx));
}

/** The waiting sentence, folded into the record when something else was said. */
function settleUnsure(s: CreationState): CreationState {
  const w = s.unsure;
  if (!w) return s;
  const asides = s.asides.map((a) => (a.q === 'unsure' ? { ...a, q: w.q } : a));
  return { ...s, unsure: null, asides: [...asides, { said: w.said, reply: UNSURE_LINE, q: w.q, at: w.at }] };
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
        asides: keptAsides(settled.asides, answers, action.ctx),
        editing: null,
        saying: null,
        colour: null,
        // the answer was given: the picture that came with it stays
        composing: null,
        text: '',
      };
    }
    case 'edit':
      return {
        ...s,
        answers: restored(s),
        composing: opening(s, action.id),
        editing: action.id,
        saying: null,
        colour: null,
        text: '',
      };
    case 'cancel-edit':
      return { ...s, answers: restored(s), composing: null, editing: null, saying: null, colour: null, text: '' };
    case 'say': {
      const saying = s.saying === action.id ? null : action.id;
      return {
        ...s,
        answers: restored(s),
        composing: opening(s, saying),
        saying,
        colour: null,
        text: '',
      };
    }
    case 'text':
      return s.text === action.text ? s : { ...s, text: action.text };
    case 'colour':
      if (!action.hex) return { ...s, colour: null };
      // a colour belongs to the step it was picked on, and to this visit to it
      return s.saying && s.saying !== 'keep' ? { ...s, colour: { step: s.saying, hex: action.hex } } : s;
    case 'aside':
      return { ...s, asides: [...s.asides, action.aside], text: '' };
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
      const trait = action.id.slice('trait-'.length) as TraitId;
      if (!s.answers.traits?.includes(trait)) return s;
      const had = s.answers[action.id] ?? { refs: [] };
      const refs = action.remove ? had.refs.filter((h) => h !== action.hash) : [action.hash];
      if (refs.join() === had.refs.join()) return s;
      return { ...s, answers: { ...s.answers, [action.id]: { ...had, refs } }, revision: s.revision + 1 };
    }
    case 'extras-declined':
      return { ...s, extrasDeclined: true };
    case 'start-over':
      return { ...EMPTY_STATE, revision: s.revision + 1, text: action.text ?? '' };
    case 'restore':
      return { ...EMPTY_STATE, answers: action.answers, revision: action.revision };
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
 * What a reload gets back: the answers and their revision, nothing else. The
 * composer's half sentence, a question being said again, the chatter, all of
 * it is the moment, and the moment is over.
 */
const STORED = 2;

export function serialize(s: CreationState): string {
  return JSON.stringify({ v: STORED, answers: s.answers, revision: s.revision });
}

export function deserialize(raw: string | null): { answers: Answers; revision: number } | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as { v?: number; answers?: Record<string, unknown>; revision?: number };
    if (p.v !== STORED || !p.answers || typeof p.answers !== 'object') return null;
    const answers: Answers = {};
    // a question the table no longer has is forgotten, never carried
    for (const [k, v] of Object.entries(p.answers)) if (isQid(k)) (answers as Record<string, unknown>)[k] = v;
    return { answers, revision: typeof p.revision === 'number' ? p.revision : 0 };
  } catch {
    return null;
  }
}

export { NO_DRAFT };
