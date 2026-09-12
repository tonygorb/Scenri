/**
 * The Question: one thing Scenri asks, and the shape of its answer.
 *
 * A conversational surface in Scenri is a transcript of turns, and the turns
 * a person can act on are questions. Five kinds: a sentence, one choice out of
 * a few (or several at once, or a few rows answered together), a row of
 * swatches, photographs, and a decision. Every question has a stable id, which
 * is what a flow keys its state on; nothing is ever keyed on a turn's position
 * or its words.
 *
 * This file is pure and knows no flow: the transcript renders it, a flow's
 * rules produce it, and the words a flow reads answers by are the flow's own.
 */
export type QuestionTone = 'alert' | 'warn';

export interface ChoiceOption {
  id: string;
  label: string;
  /** The picture on its card, when the question is answered by looking. */
  card?: string;
}

/** A row of choices inside one question: the row's label, its options, and what is picked. */
export interface ChoiceGroup {
  id: string;
  label: string;
  options: ChoiceOption[];
}

/** One thing to tap inside a row: a colour, a drawn figure, or a word. */
export interface Swatch {
  id: string;
  label: string;
  /** The colour it stands for, when it is a colour. */
  color?: string;
  /** The figure it stands for, when it is drawn: one cell of a sprite sheet the stylesheet names. */
  art?: { sheet: string; x: number; y: number };
}

/** A row inside a swatch question: what it is about, and what can be tapped. */
export interface SwatchRow {
  id: string;
  label: string;
  options: Swatch[];
  /** A colour of your own, kept as a hex string. */
  custom?: boolean;
}

interface QuestionBase {
  id: string;
  prompt: string;
  /** A quiet line under the prompt. */
  hint?: string;
  tone?: QuestionTone;
  /**
   * Ready words that fill the composer rather than answering: a few on the
   * chip, the whole phrase into the field, with the caret after it. A tap is
   * a way to start saying something, never the saying of it, so nothing is
   * committed and every one of them is editable before it is sent.
   */
  starters?: { label: string; text: string }[];
  /**
   * The question is open again from its answer. It shows with the answer in
   * it, offers a way to leave it as it was, and answering it is a change.
   */
  reopened?: boolean;
  /**
   * Words this answer already carries beside what was chosen, shown under the
   * controls. A block that lights a chip and shows nothing else is lying about
   * an answer that had words with it, and the hint line cannot say it: that
   * one belongs to the question rather than to the answer, and is deliberately
   * hidden once a question is open again.
   */
  note?: string;
}

export type Question =
  | (QuestionBase & {
      kind: 'text';
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
      /**
       * Several of the options at once, answered by the submit rather than by
       * the tap. A tap here is a choosing, not an answer: it has to be, or
       * picking a second one would be impossible.
       */
      multi?: boolean;
      /** A way to say it in words instead, which hands the answer to the composer. */
      describe?: string;
      /** A way to answer with a picture of the thing, in the same row as the words. */
      attach?: string;
      /** This question is being answered in words right now, so the way in stands lit. */
      saying?: boolean;
      /** The answer as it stands, when the question is open again: an option, several, or one per row. */
      given?: string | string[] | Record<string, string>;
      /** The answer as it stands is the way past, so the way past stands lit. */
      skipped?: boolean;
    })
  | (QuestionBase & {
      kind: 'swatches';
      /** What is being asked about, one row of it. */
      row: SwatchRow;
      /** A quiet way past this one. */
      skip?: string;
      /** A way to say it in words instead, which hands the answer to the composer. */
      describe?: string;
      /** Which figure the drawn options show, when a sheet draws more than one. */
      cast?: string;
      /** This step is being answered in words right now, so the way in stands lit. */
      saying?: boolean;
      /** The answer as it stands, when the step is open again. */
      given?: string;
      /** The answer as it stands is the way past, so the way past stands lit. */
      skipped?: boolean;
    })
  | (QuestionBase & {
      kind: 'photos';
      hashes: string[];
      max: number;
      busy: boolean;
      /** The likeness confirmation, when the flow asks for one. */
      attest?: { text: string; checked: boolean };
      submit: string;
      /** A quiet way back to describing someone instead, before any photo is filed. */
      back?: string;
    })
  | (QuestionBase & {
      kind: 'confirm';
      options: ChoiceOption[];
      /** No primary: every option is a quiet button (an aside rather than a decision). */
      quiet?: boolean;
      /**
       * The words the decision is about, set apart above the ask and copyable:
       * a sentence that is going somewhere else (a prompt, a brief) rather
       * than a line of talk.
       */
      quote?: string;
      /** A way to say something instead of deciding, which hands the composer this question. */
      describe?: string;
      /** A way to answer with a picture of the thing, in the same row as the words. */
      attach?: string;
      /** That way in is pressed right now, so it stands lit and pressing it again closes it. */
      saying?: boolean;
    });

export type QuestionKind = Question['kind'];

/** What a photos block can do; the flow owns the hashes and answers each. */
export type PhotosAction =
  | { type: 'add'; files: File[] }
  | { type: 'remove'; hash: string }
  | { type: 'attest'; checked: boolean }
  | { type: 'reject' }
  | { type: 'submit' }
  | { type: 'back' };

export type Answer =
  | { kind: 'text'; text: string }
  | { kind: 'choice'; id: string }
  | { kind: 'choices'; picks: Record<string, string> }
  | { kind: 'swatches'; picks: Record<string, string> }
  | { kind: 'skip' }
  | { kind: 'photos'; action: PhotosAction }
  | { kind: 'confirm'; id: string };

/** A turn in the transcript: yours, Scenri's, or a question. */
export type Turn =
  | {
      kind: 'you';
      id: string;
      text: string;
      photos?: string[];
      /** The answer can be changed from here. */
      editable?: boolean;
      /**
       * The answer is being rewritten in place: the bubble is a field with the
       * words already in it. Saving it is saying it again, which is what a
       * conversation does with a correction; cancelling changes nothing.
       */
      editing?: boolean;
    }
  | {
      kind: 'scenri';
      id: string;
      text: string;
      tone?: QuestionTone;
      /**
       * The line of a question already read and answered: it arrives with the
       * answer, takes no beat and plays no reveal. Nothing is being said to
       * the person again.
       */
      quiet?: boolean;
      /** A picture the line is about, shown small under it. */
      thumb?: string;
      /** The picture's name under it: the view and its number. */
      label?: string;
      /** The picture is the one on its view right now. */
      current?: boolean;
      /** The picture can be put back as it was, one to one. */
      restore?: { view: string; hash: string };
    }
  | { kind: 'question'; question: Question };

export const turnKey = (t: Turn): string => (t.kind === 'question' ? `q:${t.question.id}` : `${t.kind}:${t.id}`);

/**
 * How a deterministic line appears: word by word, each a beat after the
 * last, the whole line inside seven tenths of a second. A short question is
 * on screen almost at once; a long line is read as it arrives, never waited
 * for. The words are real text nodes, so a screen reader hears one sentence.
 */
/** The beat before a line arrives: the mark breathes and three dots stand where the words will. */
/**
 * The beat before a line: long enough to see who is speaking and that they are
 * composing, short enough that tapping through six questions never waits on it.
 *
 * It used to be seven hundred milliseconds, which read as theatre on a line the
 * flow already had in hand. Real waiting is a different thing and says so under
 * Scenri's own name (`Working`), for as long as it actually takes.
 */
export const THINK_MS = 320;
export const REVEAL_LEAD_MS = 180;
export const REVEAL_STEP_MS = 28;
export const REVEAL_MAX_MS = 700;

export function revealPlan(text: string): { words: string[]; step: number; total: number } {
  const words = text.split(/(\s+)/).filter((w) => w.length > 0);
  const spoken = words.filter((w) => !/^\s+$/.test(w)).length;
  const step = Math.min(REVEAL_STEP_MS, Math.floor(REVEAL_MAX_MS / Math.max(1, spoken)));
  return { words, step, total: THINK_MS + REVEAL_LEAD_MS + step * spoken + 160 };
}

/** How long the line takes to be whole, lead included. */
export const revealDuration = (text: string): number => revealPlan(text).total;

/** A grouped choice is complete when every row has a pick. */
export function groupsAnswered(groups: ChoiceGroup[], picks: Record<string, string>): boolean {
  return groups.every((g) => !!picks[g.id]);
}

/**
 * A typed sentence at a choice question: the option it names, if it names
 * one, by its label, its id, or the words the flow says stand for it. A
 * sentence that names none is not a choice at all, and the flow decides what
 * a free sentence means there.
 */
export function choiceFromText(
  text: string,
  options: ChoiceOption[],
  synonyms: Record<string, RegExp> = {},
): string | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const words = t.split(/\s+/);
  if (words.length > 6) return null;
  for (const o of options) {
    const label = o.label.toLowerCase();
    if (t === label || t === o.id.toLowerCase()) return o.id;
  }
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

/** Why a sentence is not an answer, so the reply can point back in the right words. */
export type NothingKind =
  | 'greeting'
  | 'ack'
  | 'question'
  | 'nav'
  | 'go'
  | 'help'
  | 'intent'
  | 'nonsense'
  | 'likeness'
  | 'vague';

const GREETING =
  /^(hi|hello|hey|heya|hiya|yo|hola|shalom|sup|good (morning|afternoon|evening)|thanks|thank you|thx|cheers)\b/i;
const ACK =
  /^(ok|okay|k|kk|sure|fine|yes|yeah|yep|yup|no|nope|nah|cool|nice|great|alright|right|hmm+|hm+|uh+|um+|oh|ah|wow|haha+|hehe+|lol|lmao|omg|meh|really|seriously|interesting|whatever)[\s!.,?]*$/i;
const QUESTION =
  /^(how|what|what's|whats|who|who's|whos|why|where|when|which|can|could|do|does|did|are|is|will|would|should|may|have|has|am|isn't|aren't|don't|doesn't)\b/i;
const NAV =
  /^(start over|start again|restart|reset|cancel|stop|quit|exit|go back|back|undo|never ?mind|forget it|close)\b/i;
const GO =
  /^(skip|next|continue|go|go on|proceed|generate|draw|render|build|show me|show|try|do it|let'?s go|begin|start)\b/i;
const HELP =
  /^(help|help me|how does this work|what do i do|what should i (write|say|type)|instructions|\?+)[\s!.,?]*$/i;
const INTENT =
  /\b(presenters?|avatars?|characters?|Scenri|create|creating|generate|generating|images?|pictures?|shoot|campaign|brand|product)\b/i;
const NONSENSE =
  /^(test|testing|blah|lorem|ipsum|foo|bar|baz|dummy|sample|placeholder|xxx+|abc|asdf\w*|qwer\w*|zxcv\w*|hjkl|jkl|sdfg?|dfgh?|fghj?|bull\w*|shit\w*|crap|fuck\w*|damn|wtf|stfu|bs|rofl|lol+|lmao+|haha\w*|hehe\w*|meh|idk|nvm)$/i;
const NO_VOWEL = /^[b-df-hj-np-tv-xz]{3,}$/i;
const REPEAT = /(.)\1{3,}/;
const LIKENESS =
  /\b(like|as|resembling|resembles|similar to|looks? like|looking like)\s+([A-Z][a-z]+)(?:\s+[A-Z][a-z]+)*\b/;
const REGION =
  /^(mediterranean|asian|east|south|southeast|indian|chinese|japanese|korean|african|black|white|nordic|scandinavian|latin|latina|latino|hispanic|arab|arabic|middle|eastern|european|caucasian|israeli|jewish|irish|italian|french|spanish|greek|turkish|persian|brazilian|mexican|american|british|german|dutch|russian|polish|thai|vietnamese|filipino|filipina|nigerian|ethiopian|moroccan|egyptian|australian|canadian|swedish|norwegian|danish|finnish|portuguese|indonesian|pakistani|iranian|lebanese|slavic|celtic|west|north|central)$/i;

/**
 * What a sentence that answers nothing is: a greeting, a nod, a question to
 * Scenri, a way out, a push to go, a call for help, the task restated, noise,
 * a named person to copy, or a word or two that answers nobody. Null for
 * anything that could be an answer. `describes` is the flow's own test for
 * what counts as one at the question at hand; a sentence that describes is
 * never nothing, except when it names a real person to copy.
 */
export function answersNothing(text: string, describes: (t: string) => boolean): NothingKind | null {
  const t = text.trim();
  if (!t) return null;
  const like = LIKENESS.exec(t);
  if (like && !REGION.test(like[2])) return 'likeness';
  if (describes(t)) return null;
  // no letters in any script is noise; a name or a sentence in Hebrew, Arabic
  // or anything else is not
  if (!/\p{L}/u.test(t)) return HELP.test(t) ? 'help' : 'nonsense';
  const words = t.split(/\s+/).filter(Boolean);
  const n = words.length;
  if (HELP.test(t)) return 'help';
  if (GREETING.test(t) && n <= 4) return 'greeting';
  if (ACK.test(t)) return 'ack';
  // Every test reads the letters alone. "zzz999" is the same mash as "zzz" and
  // used to pass, because the digits stopped it looking like a run of
  // consonants; a real short answer has vowels in it and is untouched.
  const bare = (w: string) => w.replace(/[^a-z]/gi, '');
  if (n <= 8 && words.some((w) => NONSENSE.test(bare(w)) || NO_VOWEL.test(bare(w)) || REPEAT.test(bare(w) || w))) {
    return 'nonsense';
  }
  if (QUESTION.test(t) || /\?\s*$/.test(t)) return 'question';
  if (NAV.test(t) && n <= 4) return 'nav';
  if (INTENT.test(t) && n <= 10) return 'intent';
  if (GO.test(t) && n <= 4) return 'go';
  // a bare capitalised word can be a name; one or two plain words that describe nobody cannot
  if (n === 1 && /^[A-Z][a-z]+$/.test(t)) return null;
  return n <= 2 ? 'vague' : null;
}

/** True for anything that is not an answer. */
export const smallTalk = (text: string, describes: (t: string) => boolean): boolean =>
  answersNothing(text, describes) !== null;

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
  /**
   * True when its question already had an answer when this was said.
   *
   * It decides which side of that answer it stands on. An aside said while a
   * question is open interrupted it, and belongs between the question and the
   * answer that eventually came. One said afterwards is a refused attempt to
   * change that answer, and putting it above read backwards: three rejections
   * and then the accepted answer, in the order nothing happened in.
   */
  after?: true;
  /**
   * What was wrong with it, when something was.
   *
   * It is what decides whether the next reply is a repeat: the same complaint
   * twice at the same question earns a different answer, three different
   * complaints do not. Counting bounces instead of counting *the same* bounce
   * made the third stray sentence at a question lose the specific reply it had
   * earned, whatever it said.
   */
  kind?: NothingKind;
  /**
   * How many times it has been said again.
   *
   * It rides in the reply's turn id, so a reply to new words is a new line to
   * whatever is watching the transcript: it arrives the way every other line
   * arrives, written out, rather than changing under the reader's eye. The
   * words themselves keep their id, because they were rewritten in place and
   * never went anywhere.
   */
  rev?: number;
}

/** The id an aside's own words answer to, for editing and for its key. */
export const asideTurnId = (at: string): string => `aside-said-${at}`;
/** The `at` back out of that id, or null when the id is not an aside's. */
export const asideAtOf = (turnId: string): string | null =>
  turnId.startsWith('aside-said-') ? turnId.slice('aside-said-'.length) : null;

export const asideTurns = (a: Aside, editing = false): Turn[] => [
  // Words a person typed are words a person can change, wherever they landed.
  // An aside is not an answer, but it is still theirs.
  { kind: 'you', id: asideTurnId(a.at), text: a.said, editable: true, editing: editing || undefined },
  { kind: 'scenri', id: `aside-reply-${a.at}${a.rev ? `-${a.rev}` : ''}`, text: a.reply },
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
