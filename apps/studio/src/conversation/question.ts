/**
 * The Question: one thing Scenri asks, and the shape of its answer.
 *
 * A conversational surface in Scenri is a transcript of turns, and the turns
 * a person can act on are questions. Four kinds cover what the presenter
 * studio needs today: a sentence, one choice out of a few (optionally a few
 * rows of choices answered together), photographs, and a decision. Every
 * question has a stable id, which is what a flow keys its state on; nothing
 * is ever keyed on a turn's position or its words.
 *
 * This file is pure. The transcript renders it; a flow's rules produce it.
 */
export type QuestionTone = 'alert' | 'warn';

export interface ChoiceOption {
  id: string;
  label: string;
}

/** A row of choices inside one question: the row's label, its options, and what is picked. */
export interface ChoiceGroup {
  id: string;
  label: string;
  options: ChoiceOption[];
}

interface QuestionBase {
  id: string;
  prompt: string;
  /** A quiet line under the prompt. */
  hint?: string;
  tone?: QuestionTone;
}

export type Question =
  | (QuestionBase & {
      kind: 'text';
      /** Tappable sentences that fill the composer, for a blank-canvas question. */
      starters?: string[];
    })
  | (QuestionBase & {
      kind: 'choice';
      /** One tap answers, when there are no groups. */
      options?: ChoiceOption[];
      /** Several rows answered together with the submit button. */
      groups?: ChoiceGroup[];
      submit?: string;
      /** A second, quiet way out of a grouped question. */
      skip?: string;
    })
  | (QuestionBase & {
      kind: 'photos';
      hashes: string[];
      max: number;
      busy: boolean;
      /** The likeness confirmation, when the flow asks for one. */
      attest?: { text: string; checked: boolean };
      submit: string;
    })
  | (QuestionBase & {
      kind: 'confirm';
      options: ChoiceOption[];
      /** No primary: every option is a quiet button (an aside rather than a decision). */
      quiet?: boolean;
    });

export type QuestionKind = Question['kind'];

/** What a photos block can do; the flow owns the hashes and answers each. */
export type PhotosAction =
  | { type: 'add'; files: File[] }
  | { type: 'remove'; hash: string }
  | { type: 'attest'; checked: boolean }
  | { type: 'reject' }
  | { type: 'submit' };

export type Answer =
  | { kind: 'text'; text: string }
  | { kind: 'choice'; id: string }
  | { kind: 'choices'; picks: Record<string, string> }
  | { kind: 'skip' }
  | { kind: 'photos'; action: PhotosAction }
  | { kind: 'confirm'; id: string };

/** A turn in the transcript: yours, Scenri's, a question, or a folded stretch of setup. */
export type Turn =
  | {
      kind: 'you';
      id: string;
      text: string;
      photos?: string[];
      /** The answer can be changed from here. */
      editable?: boolean;
    }
  | { kind: 'scenri'; id: string; text: string; tone?: QuestionTone }
  | { kind: 'question'; question: Question }
  | { kind: 'summary'; id: string; text: string };

export const turnKey = (t: Turn): string => (t.kind === 'question' ? `q:${t.question.id}` : `${t.kind}:${t.id}`);

/**
 * How a deterministic line appears: word by word, each a beat after the
 * last, the whole line inside seven tenths of a second. A short question is
 * on screen almost at once; a long line is read as it arrives, never waited
 * for. The words are real text nodes, so a screen reader hears one sentence.
 */
export const REVEAL_LEAD_MS = 180;
export const REVEAL_STEP_MS = 28;
export const REVEAL_MAX_MS = 700;

export function revealPlan(text: string): { words: string[]; step: number; total: number } {
  const words = text.split(/(\s+)/).filter((w) => w.length > 0);
  const spoken = words.filter((w) => !/^\s+$/.test(w)).length;
  const step = Math.min(REVEAL_STEP_MS, Math.floor(REVEAL_MAX_MS / Math.max(1, spoken)));
  return { words, step, total: REVEAL_LEAD_MS + step * spoken + 160 };
}

/** How long the line takes to be whole, lead included. */
export const revealDuration = (text: string): number => revealPlan(text).total;

/** A grouped choice is complete when every row has a pick. */
export function groupsAnswered(groups: ChoiceGroup[], picks: Record<string, string>): boolean {
  return groups.every((g) => !!picks[g.id]);
}

/**
 * A typed sentence at a choice question: the option it names, if it names
 * one. "photos", "upload", "from my photos" pick the photos door; "describe",
 * "from scratch", "make someone up" pick the description door. A sentence
 * that names neither is not a choice at all, and the flow decides what a
 * free sentence means there (for the presenter, it is the description).
 */
export function choiceFromText(text: string, options: ChoiceOption[]): string | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const words = t.split(/\s+/);
  if (words.length > 6) return null;
  for (const o of options) {
    const label = o.label.toLowerCase();
    if (t === label || t === o.id.toLowerCase()) return o.id;
  }
  const synonyms: Record<string, RegExp> = {
    photos: /\b(photos?|pictures?|pics?|upload|images?|selfies?)\b/,
    scratch: /\b(scratch|describe|description|invent|make (someone|one|them) up|imagine|new person)\b/,
  };
  for (const o of options) {
    const re = synonyms[o.id];
    if (re?.test(t)) return o.id;
  }
  return null;
}

/** The transcript announces a finished turn once; while a reveal plays the words are already whole. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Words that describe a person: with any of these, a short sentence is an answer, not small talk. */
const DESCRIBES =
  /\b(wom[ae]n|m[ae]n|male|female|lady|girl|boy|guy|person|she|he|they|\d0s|\d\d|young|old|teen|adult|hair|bald|beard|skin|freckle|build|slim|slender|athletic|average|fuller|tall|short|eyes?|face|smile|presence|calm|warm|confident|elegant|blonde?|brunette|dark|light|tan|olive|brown|black|white|silver|grey|gray|red|curly|straight|wavy|photos?|pictures?|selfies?|uploads?|older|younger|taller|shorter|longer|slimmer|leaner|heavier|broader|bigger|smaller|thinner|thicker|softer|sharper|natural|scratch|describe)\b/i;

/**
 * A greeting, a thanks, a test, or a word or two that describes nobody:
 * not an answer to any question, and never a sentence to draw from. The
 * flow replies with the question again, in its own words.
 */
export function smallTalk(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (
    /^(hi|hello|hey|heya|hiya|yo|hola|shalom|sup|good (morning|afternoon|evening)|thanks|thank you|thx|cheers|ok|okay|k|sure|fine|yes|yeah|yep|no|nope|help|test|testing|what|why|how|\?+|\.+|!+)[\s!.,?]*$/i.test(
      t,
    )
  )
    return true;
  const words = t.split(/\s+/).filter(Boolean);
  // a bare capitalised word can be a name; one or two plain words that describe nobody cannot
  if (words.length === 1 && /^[A-Z][a-z]+$/.test(t)) return false;
  return words.length <= 2 && !DESCRIBES.test(t) && !/\d/.test(t);
}

/**
 * A sentence that answered nothing: small talk at a question, a sentence
 * the flow could only point back from, a question that was left. It stays
 * where it was said: under the question it interrupted while that is open,
 * between that question's line and its answer once answered, else in the
 * record by time. Nothing said later rewrites it.
 */
export interface Aside {
  said: string;
  reply: string;
  /** The question open when it was said, by id; null when none was. */
  q: string | null;
  /** When it was said, ISO: the key of its turns and its place in the record. */
  at: string;
}

export const asideTurns = (a: Aside): Turn[] => [
  { kind: 'you', id: `aside-said-${a.at}`, text: a.said, editable: false },
  { kind: 'scenri', id: `aside-reply-${a.at}`, text: a.reply },
];

/** An aside's turns are not an answer: the question before them is still the open one. */
export const isAsideTurn = (t: Turn): boolean => (t.kind === 'you' || t.kind === 'scenri') && t.id.startsWith('aside-');

/** The open question's id, read off the end of a transcript: the last question, whatever asides follow it. */
export function openQuestionId(turns: Turn[]): string | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t.kind === 'question') return t.question.id;
    if (!isAsideTurn(t)) return null;
  }
  return null;
}

export const nowIso = (): string => new Date().toISOString();
