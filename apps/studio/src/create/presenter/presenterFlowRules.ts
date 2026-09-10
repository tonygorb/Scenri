import type { Question, Swatch, SwatchRow, Turn } from '../../conversation/question.js';
import {
  type Aside,
  type NothingKind,
  asideTurns,
  choiceFromText,
  isAsideTurn,
  openQuestionId,
} from '../../conversation/question.js';
import {
  type Age,
  EXTRA_VIEWS,
  type DraftDecision,
  type DraftLike,
  type DraftResult,
  type Steer,
  type StudioView,
  VIEW_LABEL,
  VIEW_NAME,
  allApproved,
  castSentence,
  coverageLine,
  drawing,
  identityLocked,
  saysAge,
  saysWho,
} from './presenterStudioRules.js';

/**
 * The creation conversation, as rules.
 *
 * A presenter is made in a short exchange: who are we creating, then the
 * sentence or the photographs, one follow-up at most when the sentence
 * leaves out what a roll cannot guess, then the face, decided; then the
 * set, built without a click; then a name if none was given while it drew,
 * and Save. Every Scenri line is product copy from here; nothing asks a
 * model for words.
 *
 * The transcript is `turnsFor()`, a function of the setup before a draft
 * exists and of the server draft after. No turn is stored and no rendered
 * text is ever read back: change the state and the transcript follows.
 */
export type Source = 'scratch' | 'photos';

/** What is known before the server holds a draft. */
export interface Setup {
  source: Source | null;
  description: string;
  /** The look, tapped rather than typed: colours and words by row, `'skipped'`, or null. */
  look?: Record<string, string> | 'skipped' | null;
  /** The follow-up's picks, `'skipped'`, or null while unanswered. */
  gaps: Record<string, string> | 'skipped' | null;
  /** The follow-up was shown; it is shown at most once. */
  gapsAsked: boolean;
  photoHashes: string[];
  attested: boolean;
  uploading: boolean;
  /** The description was typed at the first question, so no door was chosen. */
  typed?: boolean;
}

export const EMPTY_SETUP: Setup = {
  source: null,
  description: '',
  look: null,
  gaps: null,
  gapsAsked: false,
  photoHashes: [],
  attested: false,
  uploading: false,
};

/** What the page holds beside the draft: the folded setup, and the extras decision. */
export interface FlowUi {
  collapsed: boolean;
  /** "Save as is" was chosen once; the extras question is not asked again. */
  extrasDeclined: boolean;
  /** An answered question asked again from its pencil: the name, or the description. */
  reasking: 'name' | 'describe' | null;
  /** A draw request that never reached the engine, said once with a Retry. */
  failed?: string | null;
  /** Sentences that answered nothing, each kept where it was said. */
  asides?: Aside[];
  /** The answer being said again, in the place it was said. */
  editing?: string | null;
  /** The one step being answered in words rather than tapped. */
  saying?: string | null;
  /** A sentence with nothing of a person in it, waiting to be drawn from anyway or replaced. */
  unsure?: { said: string; q: string | null; at: string } | null;
}

export const MAX_PHOTOS = 4;

export const SOURCE_OPTIONS = [
  { id: 'photos', label: 'Add photos' },
  { id: 'scratch', label: 'Describe someone' },
];

/**
 * Five ready answers to the question as it is asked: who, age, skin, hair,
 * build and presence, in one sentence. A few words on the chip, the whole
 * sentence on hover and into the composer.
 */
export const STARTERS = [
  {
    label: 'Late 30s, warm',
    text: 'A woman in her late 30s, Mediterranean, olive skin, dark shoulder-length hair, slim build, warm and composed.',
  },
  {
    label: 'Early 20s, bright',
    text: 'A man in his early 20s, fair skin with freckles, short blond hair, athletic build, bright and easygoing.',
  },
  {
    label: 'Mid 40s, quiet',
    text: 'A man in his mid 40s, East Asian, close-cropped black hair, lean build, quietly confident.',
  },
  {
    label: 'Late 20s, easy',
    text: 'A woman in her late 20s, deep brown skin, natural curls, tall and graceful, with an easy laugh.',
  },
  {
    label: 'Sixties, calm',
    text: 'A woman in her early sixties, light skin, silver hair in a soft bob, broad build, calm and assured.',
  },
];

export const ATTEST_TEXT = "I have permission to use this person's likeness.";

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
  const words = t.split(/\s+/).filter(Boolean).length;
  const gaps: Gap[] = [];
  if (!saysWho.test(t)) gaps.push('who');
  if (!saysAge.test(t)) gaps.push('age');
  if (gaps.length && !BUILD_WORDS.test(t) && words < 8) gaps.push('build');
  return gaps;
}

export const needsFollowUp = (text: string): boolean => descriptionGaps(text).length > 0;

const GAP_GROUPS: Record<Gap, { label: string; options: { id: string; label: string }[] }> = {
  who: {
    label: 'Who',
    options: [
      { id: 'woman', label: 'Woman' },
      { id: 'man', label: 'Man' },
      { id: 'androgynous', label: 'Androgynous' },
    ],
  },
  age: {
    label: 'Age',
    options: ['20s', '30s', '40s', '50s', '60+'].map((a) => ({ id: a, label: a })),
  },
  build: {
    label: 'Build',
    options: ['slender', 'average', 'athletic', 'fuller'].map((b) => ({
      id: b,
      label: b.charAt(0).toUpperCase() + b.slice(1),
    })),
  },
};

/**
 * The look, as things to tap rather than words to find: hair by colour and by
 * length, skin by tone, each a swatch of the colour it stands for. A colour of
 * your own is allowed on both rows, and is read back as the nearest name we
 * have a word for, because a hex code means nothing to a model.
 */
export const HAIR_COLOURS: Swatch[] = [
  { id: 'black', label: 'Black', color: '#15120f' },
  { id: 'dark brown', label: 'Dark brown', color: '#3b2418' },
  { id: 'brown', label: 'Brown', color: '#6b4630' },
  { id: 'auburn', label: 'Auburn', color: '#8c3b26' },
  { id: 'ginger', label: 'Ginger', color: '#c2622a' },
  { id: 'blonde', label: 'Blonde', color: '#d8ac63' },
  { id: 'platinum blonde', label: 'Platinum', color: '#e9e1d0' },
  { id: 'grey', label: 'Grey', color: '#9b9b99' },
  { id: 'white', label: 'White', color: '#f0efed' },
];

export const HAIR_LENGTHS: Swatch[] = [
  { id: 'buzzed', label: 'Buzzed' },
  { id: 'cropped', label: 'Cropped' },
  { id: 'short', label: 'Short' },
  { id: 'chin-length', label: 'Chin' },
  { id: 'shoulder-length', label: 'Shoulder' },
  { id: 'long', label: 'Long' },
];

export const SKIN_TONES: Swatch[] = [
  { id: 'porcelain', label: 'Porcelain', color: '#f4e0d4' },
  { id: 'fair', label: 'Fair', color: '#edcdb6' },
  { id: 'light olive', label: 'Light olive', color: '#ddb894' },
  { id: 'olive', label: 'Olive', color: '#c2935f' },
  { id: 'tan', label: 'Tan', color: '#a9713f' },
  { id: 'brown', label: 'Brown', color: '#7c4f2c' },
  { id: 'deep brown', label: 'Deep brown', color: '#57351d' },
  { id: 'deep', label: 'Deep', color: '#3a2114' },
];

/**
 * The look, one question at a time. Each is a single row answered by one tap,
 * so nothing is a form: the block asks, you tap, the next one comes. Length and
 * build are drawn rather than named, because a shape is read faster than the
 * word for it.
 */
/**
 * Nine builds, read left to right and top to bottom as a spectrum from the
 * slightest to the most compact. Every one is a word a person would use about
 * themselves; none is clinical, and none is a near-copy of its neighbour.
 */
export const BUILDS: Swatch[] = [
  { id: 'slight', label: 'Slight', art: 'build' },
  { id: 'lean', label: 'Lean', art: 'build' },
  { id: 'average', label: 'Average', art: 'build' },
  { id: 'athletic', label: 'Athletic', art: 'build' },
  { id: 'muscular', label: 'Muscular', art: 'build' },
  { id: 'curvy', label: 'Curvy', art: 'build' },
  { id: 'broad', label: 'Broad', art: 'build' },
  { id: 'full', label: 'Full', art: 'build' },
  { id: 'stocky', label: 'Stocky', art: 'build' },
];

export const LOOK_STEPS: { row: SwatchRow; prompt: string }[] = [
  { row: { id: 'who', label: 'Who', options: GAP_GROUPS.who.options }, prompt: 'Who are we making?' },
  { row: { id: 'age', label: 'Age', options: GAP_GROUPS.age.options }, prompt: 'Roughly what age?' },
  { row: { id: 'hair', label: 'Hair', options: HAIR_COLOURS, custom: true }, prompt: 'What colour is their hair?' },
  {
    row: { id: 'length', label: 'Length', options: HAIR_LENGTHS.map((o) => ({ ...o, art: 'hair' as const })) },
    prompt: 'How long is it?',
  },
  { row: { id: 'skin', label: 'Skin', options: SKIN_TONES, custom: true }, prompt: 'What is their skin tone?' },
  { row: { id: 'build', label: 'Build', options: BUILDS }, prompt: 'And their build?' },
];

/** The step before this one, so any answer can be taken back from where you are. */
export function stepBefore(id: string): string | null {
  const at = LOOK_STEPS.findIndex((s) => s.row.id === id);
  return at > 0 ? LOOK_STEPS[at - 1].row.id : null;
}

/**
 * The steps a person can answer in their own words instead of tapping.
 *
 * The presets are there for speed, not to say what a presenter may be: nine
 * builds are nine good starting points, and the tenth person is described. Who
 * and age take no describing, because the bands already cover what they ask.
 */
export const LOOK_SAYS: Record<string, string> = {
  hair: 'Describe the colour',
  length: 'Describe the cut',
  skin: 'Describe their skin',
  build: 'Describe the build',
};

/** What the composer asks for while a step is being answered in words. */
export const LOOK_SAYS_PLACEHOLDER: Record<string, string> = {
  hair: 'Their hair colour, in your words',
  length: 'Their cut, in your words',
  skin: 'Their skin, in your words',
  build: 'Their build, in your words',
};

/** The step still to ask, or null once every one of them has been answered or passed. */
export function nextLookStep(look: Setup['look']): (typeof LOOK_STEPS)[number] | null {
  if (look === 'skipped') return null;
  const done = look ?? {};
  return LOOK_STEPS.find((s) => !done[s.row.id]) ?? null;
}

/** The name we have for a colour of someone's own: the nearest one on its row. */
export function nearestSwatch(hex: string, among: Swatch[]): string {
  const rgb = (h: string) => {
    const v = h.replace('#', '');
    const n = v.length === 3 ? v.split('').map((c) => c + c) : [v.slice(0, 2), v.slice(2, 4), v.slice(4, 6)];
    return n.map((p) => Number.parseInt(p, 16) || 0);
  };
  const [r, g, b] = rgb(hex);
  let best = among[0];
  let far = Number.POSITIVE_INFINITY;
  for (const one of among) {
    if (!one.color) continue;
    const [x, y, z] = rgb(one.color);
    const d = (r - x) ** 2 + (g - y) ** 2 + (b - z) ** 2;
    if (d < far) {
      far = d;
      best = one;
    }
  }
  return best.id;
}

/** A step passed over: remembered, so it is asked once. */
export const PASSED = 'either';

/** What was tapped, said as a person: the sentence the engine is given. */
export function lookSentence(look: Record<string, string>): string {
  const name = (id: string | undefined, among: Swatch[]) =>
    !id || id === PASSED ? '' : id.startsWith('#') ? nearestSwatch(id, among) : id.toLowerCase();
  const who =
    look.who === 'androgynous'
      ? 'an androgynous person'
      : look.who === 'man'
        ? 'a man'
        : look.who === 'woman'
          ? 'a woman'
          : 'a person';
  const parts: string[] = [who];
  if (look.age) parts.push(look.age === '60+' ? 'in their 60s or older' : `in their ${look.age}`);
  const hair = [name(look.length, HAIR_LENGTHS), name(look.hair, HAIR_COLOURS)].filter(Boolean).join(' ');
  const has: string[] = [];
  if (hair) has.push(`${hair} hair`);
  const skin = name(look.skin, SKIN_TONES);
  if (skin) has.push(`${skin} skin`);
  if (look.build && look.build !== PASSED) has.push(`${/^[aeiou]/.test(look.build) ? 'an' : 'a'} ${look.build} build`);
  if (has.length) parts.push(`with ${has.join(', ')}`);
  return parts.join(' ');
}

/** What one tap said, as the answer in the transcript. */
export function answerLabel(row: SwatchRow, given: string): string {
  if (given === PASSED) return 'Either way';
  if (given.startsWith('#')) return cap(nearestSwatch(given, row.options));
  // said in words rather than tapped: the words are the answer
  return row.options.find((o) => o.id === given)?.label ?? given;
}

/** What was tapped, as the answer in the transcript. */
export function lookLine(look: Setup['look']): string {
  if (!look || look === 'skipped') return 'Surprise me';
  return cap(lookSentence(look));
}

/** The sentence the engine is given: the description with the follow-up's picks folded in. */
export function directionFrom(setup: Setup): string {
  const look = setup.look && setup.look !== 'skipped' ? setup.look : null;
  if (look) {
    // what was tapped is the person; anything typed after it is what else they are
    const said = setup.description.trim().replace(/[.\s]+$/, '');
    const from = lookSentence(look);
    return said ? `${from}, ${said}` : from;
  }
  const picks = setup.gaps && setup.gaps !== 'skipped' ? setup.gaps : {};
  const build = picks.build
    ? `${setup.description.trim().replace(/[.\s]+$/, '')}, ${picks.build} build`
    : setup.description;
  return castSentence(
    { steer: (picks.who as Steer) ?? null, age: (picks.age as Age) ?? null, tone: null, hair: null },
    build,
  );
}

/** Which question a typed sentence at the source question answers, if any. */
export const sourceFromText = (text: string): Source | null => choiceFromText(text, SOURCE_OPTIONS) as Source | null;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The follow-up's answer, as a sentence in the transcript. */
export function gapsLine(gaps: Setup['gaps']): string {
  if (!gaps || gaps === 'skipped') return 'Draw as is';
  return Object.values(gaps)
    .map((v) => cap(v))
    .join(', ');
}

export function photosLine(n: number): string {
  return n === 1 ? 'One photo' : `${n} photos`;
}

export function photosHint(n: number): string {
  if (n === 0) return 'The same person, face clear. Different angles help.';
  if (n === 1) return 'One photo works. Two to four, from different angles, hold the likeness better.';
  if (n < MAX_PHOTOS) return `${n} photos. More angles hold the likeness better.`;
  return 'Four angles. The reference set comes from these.';
}

/** Every line Scenri says as a question, once, so the record repeats it exactly. */
export const PROMPT = {
  source: 'Who are we creating? Describe someone new, or add photos of a real person.',
  describe: 'Describe them. Age, hair, build, skin and presence all help; one or two sentences is enough.',
  look: 'What do they look like?',
  lookHint: 'Tap what fits. Anything you skip is ours to choose.',
  lookMore: 'Anything else about them?',
  photos: 'Add one clear photo of their face. Up to three more angles hold the likeness better.',
  name: 'What should we call them?',
  nameWhileDrawing: 'While it draws: what should we call them?',
  nameWhileReading: 'While I read them: what should we call them?',
  identity: (who: string) => `Here is ${who === 'them' ? 'the face' : who}. Use this person, or change something.`,
  change: 'What should change?',
  extras: 'Add back and profile views? They help shots from behind or in profile.',
};

export const gapsPrompt = (n: number): string =>
  n === 1
    ? 'One thing I cannot tell yet.'
    : n === 2
      ? 'Two things I cannot tell yet.'
      : 'A few things I cannot tell yet.';

export interface FlowArgs {
  setup: Setup;
  draft: DraftLike | null;
  canGenerate: boolean;
  ui: FlowUi;
}

/**
 * The transcript, whole, from state. The last turn is the open question
 * when there is one; `activeQuestion()` reads it off.
 */
export function turnsFor(args: FlowArgs): Turn[] {
  const asides = args.ui.asides ?? [];
  // Where an aside goes depends on which question is open, so the transcript
  // is shaped once without them to learn it.
  const openId = asides.length ? openQuestionId(shape(args, [], null)) : null;
  return shape(args, asides, openId);
}

/** A draw that was stopped is said quietly and offered again; one that failed says why, with a Retry. */
export function stoppedOrFailed(view: StudioView, error: string): Question {
  const name = view === 'portrait' ? 'face' : VIEW_NAME[view];
  return error === 'cancelled'
    ? {
        id: 'retry',
        kind: 'confirm',
        quiet: true,
        prompt: `Stopped drawing the ${name}. Nothing finished was touched.`,
        options: [{ id: 'retry', label: 'Draw it again' }],
      }
    : {
        id: 'retry',
        kind: 'confirm',
        tone: 'alert',
        prompt: `The ${name} could not be drawn: ${error}. Nothing finished was touched.`,
        options: [{ id: 'retry', label: 'Retry' }],
      };
}

/** Where the analyzer filed them, said once at the save; the presenter page is where it changes. */
export function filedLine(d: DraftLike): string {
  const cats = (d.analysis?.suitableCategories ?? []).filter(Boolean);
  if (!cats.length) return '';
  const list = cats.length === 1 ? cats[0] : `${cats.slice(0, -1).join(', ')} and ${cats[cats.length - 1]}`;
  return ` Filed under ${list}; that can change on their page.`;
}

/** The moment the record last moved: what was said before it belongs to the record, not to the open question. */
export function recordEdge(d: DraftLike | null): string {
  if (!d) return '';
  const ats = [...(d.asks ?? []), ...(d.results ?? []), ...(d.decisions ?? [])].map((x) => x.at);
  return ats.length ? ats.reduce((m, at) => (at > m ? at : m)) : '';
}

function shape(args: FlowArgs, asides: Aside[], openId: string | null): Turn[] {
  const placed = new Set<Aside>();
  let T = turnsBase(args, asides, openId, placed);
  if (args.ui.reasking) {
    const kept = T[T.length - 1]?.kind === 'question' ? T.slice(0, -1) : T;
    T =
      args.ui.reasking === 'name'
        ? [...kept, { kind: 'question', question: { id: 'name', kind: 'text', prompt: PROMPT.name } }]
        : [
            ...kept,
            {
              kind: 'question',
              question: {
                id: 'describe',
                kind: 'text',
                prompt: 'Describe them again. The face is drawn from the new sentence.',
              },
            },
          ];
  }
  // A sentence with nothing of a person in it waits on its own question. What
  // was said follows the last turn, in order: before that question when it
  // came before, after it when it came after.
  const left = asides.filter((a) => !placed.has(a)).sort(byAt);
  const u = args.ui.unsure;
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

/** Where the conversation is when a sentence answers nothing: what the reply points back to. */
export type AsidePhase = 'source' | 'describe' | 'name' | 'refine';

const HOW: Record<AsidePhase, string> = {
  source: 'describe them in a sentence, or pick one above',
  describe: 'a few words about them is enough: age, hair, build, skin, presence',
  name: 'a name, so the rest of the conversation can use it',
  refine: 'say what should change: hair, age or build change the person; anything else changes the view on the stage',
};

/** The question again, in words that answer what was actually said. Different words the second time. */
export function asideReply(kind: NothingKind, phase: AsidePhase, again: boolean, said = ''): string {
  const how = HOW[phase];
  switch (kind) {
    case 'likeness':
      return 'Describe them by looks. Scenri does not draw a named person.';
    case 'help':
      return phase === 'refine'
        ? 'Select a view and say what is wrong with it, or say what should change about them: hair, age, build, skin.'
        : phase === 'name'
          ? 'Any name will do; it can be changed later.'
          : 'Describe the person in a sentence: age, hair, build, skin, presence. Or add photos of a real person.';
    case 'question':
      return phase === 'refine'
        ? `This is where the picture is changed: ${how}.`
        : phase === 'name'
          ? `This is where they get a name: ${how}.`
          : `This is where the person is described: ${how}.`;
    case 'nav':
      return 'To begin again, use Start over at the top. Close keeps the draft where it is.';
    case 'go':
      return phase === 'refine'
        ? 'Try again redraws it as it is; a sentence says what should change.'
        : `Nothing to draw yet. ${cap(how)}.`;
    case 'intent':
      return phase === 'refine'
        ? `Nothing changes until it is said what: ${how}.`
        : `That is what we are here for. Who are they? ${cap(how)}.`;
    case 'nonsense':
      return phase === 'name'
        ? `That is not a name. ${cap(how)}.`
        : phase === 'refine'
          ? `That does not say what should change. ${cap(how)}.`
          : `That does not describe anyone. ${cap(how)}.`;
    case 'greeting':
      return again
        ? `Still here. ${cap(how)}.`
        : /^(hi|hello|hey|heya|hiya|yo|hola|shalom|good)\b/i.test(said.trim())
          ? `Hi. ${cap(how)}.`
          : `${cap(how)}.`;
    case 'ack':
      return again ? `Still here. ${cap(how)}.` : `Go ahead: ${how}.`;
    case 'vague':
      return again ? `Still here. ${cap(how)}.` : `${cap(how)}.`;
  }
}

/** A sentence with nothing of a person in it, once a proper one came: the record's word for it. */
export const UNSURE_LINE = 'That did not read as a description of someone.';
export const UNSURE_PROMPT =
  'That does not read as a description yet. Draw from it anyway, or describe them: age, hair, build, skin, presence.';

/** The waiting sentence, once something else was said: kept as the record's line, with what was said under it. */
export function settleUnsure(u: FlowUi): FlowUi {
  const w = u.unsure;
  if (!w) return u;
  const asides = (u.asides ?? []).map((a) => (a.q === 'unsure' ? { ...a, q: w.q } : a));
  return { ...u, unsure: null, asides: [...asides, { said: w.said, reply: UNSURE_LINE, q: w.q, at: w.at }] };
}

const byAt = (x: { at: string }, y: { at: string }) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0);

/** The questions of the setup: folded with it, and their asides with them. */
const SETUP_QS = new Set(['source', 'describe', 'gaps', 'photos', 'noengine', 'blind', 'name']);

function turnsBase(
  { setup, draft: d, canGenerate, ui }: FlowArgs,
  asides: Aside[],
  openId: string | null,
  placed: Set<Aside>,
): Turn[] {
  const T: Turn[] = [{ kind: 'you', id: 'intent', text: 'Create a presenter' }];
  const folded = ui.collapsed && !!d && identityLocked(d);
  // the setup's chatter folds with it; the name's only once the name is given and folded with it
  if (folded) {
    for (const a of asides) if (a.q && SETUP_QS.has(a.q) && (a.q !== 'name' || !!d?.name?.trim())) placed.add(a);
  }
  // What was said at a question, once it is answered, sits between its line and the answer.
  const attach = (ids: string[]) => {
    const mine = asides.filter((a) => !placed.has(a) && !!a.q && a.q !== openId && ids.includes(a.q)).sort(byAt);
    for (const a of mine) {
      placed.add(a);
      T.push(...asideTurns(a));
    }
  };
  // An answer keeps the line it answered above it: the exchange is the record.
  const you = (id: string, text: string, asked: string, extra?: { photos?: string[]; editable?: boolean }) => {
    if (!folded) T.push({ kind: 'scenri', id: `asked-${id}`, text: asked });
    // A typed sentence answered the first question, so what was said there stays with it.
    attach(id === 'describe' && setup.typed ? ['source', 'describe'] : [id]);
    T.push({
      kind: 'you',
      id,
      text,
      editable: extra?.editable ?? true,
      editing: ui.editing === id || undefined,
      photos: extra?.photos,
    });
  };
  const say = (id: string, text: string, tone?: 'alert' | 'warn') => T.push({ kind: 'scenri', id, text, tone });
  const ask = (question: Question) => T.push({ kind: 'question', question });
  const name = d?.name?.trim() ?? '';
  const who = name || 'them';
  // A draft opened at its address carries its own answers; the setup mirror is only for before.
  const source: Source | null = setup.source ?? (d ? (d.source === 'photos' ? 'photos' : 'scratch') : null);

  if (!source) {
    ask({
      id: 'source',
      kind: 'choice',
      prompt: PROMPT.source,
      options: SOURCE_OPTIONS,
    });
    return T;
  }

  if (!folded && !setup.typed) you('source', source === 'photos' ? 'Add photos' : 'Describe someone', PROMPT.source);

  if (source === 'scratch') {
    if (!canGenerate && !d) {
      ask({
        id: 'noengine',
        kind: 'confirm',
        quiet: true,
        prompt: 'Describing someone needs image generation, which is not set up yet.',
        options: [
          { id: 'setup', label: 'Set up' },
          { id: 'photos', label: 'Add photos instead' },
        ],
      });
      return T;
    }
    // Tapped before typed: the look is a few rows of colours and words, and the
    // composer is still there for anyone who would rather say it in a sentence.
    const step = setup.description.trim() || d ? null : nextLookStep(setup.look ?? null);
    // Every step is its own exchange: the question as it was asked, the answer
    // under it, and its own pencil. The whole person is read back at the end.
    if (!folded && setup.look && setup.look !== 'skipped') {
      for (const st of LOOK_STEPS) {
        const given = setup.look[st.row.id];
        if (given) you(`look-${st.row.id}`, answerLabel(st.row, given), st.prompt);
      }
    }
    // the look handed over to words: the sentence is the answer again
    if (setup.look === 'skipped' && !setup.description.trim() && !d) {
      if (!folded) T.push({ kind: 'scenri', id: 'asked-describe', text: PROMPT.describe });
      attach(['describe']);
      ask({ id: 'describe', kind: 'text', prompt: PROMPT.describe, starters: STARTERS });
      return T;
    }
    if (step && !d) {
      ask({
        // each step is its own question, so each arrives on its own beat and
        // carries its own answer rather than the one before it
        id: `look-${step.row.id}`,
        kind: 'swatches',
        prompt: step.prompt,
        hint: step.row.id === 'who' ? PROMPT.lookHint : undefined,
        row: step.row,
        who: setup.look && setup.look !== 'skipped' ? setup.look.who : undefined,
        skip: 'Skip',
        describe: step.row.id === 'who' ? 'Describe instead' : LOOK_SAYS[step.row.id],
      });
      return T;
    }
    // every step answered: what we have is read back before anything is drawn
    if (!d && setup.look && setup.look !== 'skipped' && !setup.description.trim()) {
      ask({
        id: 'agree',
        kind: 'confirm',
        prompt: `${cap(lookSentence(setup.look))}. Shall I draw them?`,
        options: [
          { id: 'draw', label: 'Draw them' },
          { id: 'add', label: 'Add a detail' },
          { id: 'change', label: 'Change something' },
        ],
      });
      return T;
    }
    if (!folded && setup.description.trim()) {
      you(
        'describe',
        setup.description.trim(),
        setup.look ? PROMPT.lookMore : setup.typed ? PROMPT.source : PROMPT.describe,
      );
    } else if (!folded && !setup.look) {
      you('describe', d?.direction ?? '', setup.typed ? PROMPT.source : PROMPT.describe);
    }
    if (setup.gapsAsked && !setup.gaps && !d) {
      const gaps = descriptionGaps(setup.description);
      ask({
        id: 'gaps',
        kind: 'choice',
        prompt: gapsPrompt(gaps.length),
        groups: gaps.map((g) => ({ id: g, ...GAP_GROUPS[g] })),
        submit: 'Continue',
        skip: 'Skip, draw as is',
      });
      return T;
    }
    if (setup.gaps && !folded) you('gaps', gapsLine(setup.gaps), gapsPrompt(descriptionGaps(setup.description).length));
  } else {
    if (!d) {
      ask({
        id: 'photos',
        kind: 'photos',
        prompt: PROMPT.photos,
        hint: photosHint(setup.photoHashes.length),
        hashes: setup.photoHashes,
        max: MAX_PHOTOS,
        busy: setup.uploading,
        attest: { text: ATTEST_TEXT, checked: setup.attested },
        submit: 'Continue',
        back: 'Describe someone instead',
      });
      return T;
    }
    if (!folded) {
      const n = d.sources?.length ?? 0;
      you('photos', photosLine(n), PROMPT.photos, { photos: d.sources ?? [], editable: true });
    }
  }

  if (!d) return T;

  if (folded) {
    T.push({
      kind: 'summary',
      id: 'setup',
      text: `Setup: ${source === 'photos' ? photosLine(d.sources?.length ?? 0) : 'described'}${name ? `, named ${name}` : ''}. Show`,
    });
  }

  const askName = (prompt: string) => ask({ id: 'name', kind: 'text', prompt });

  if (d.stage === 'analyzing') {
    say('reading', 'Reading the photos.');
    if (name) you('name', name, PROMPT.name);
    else askName(PROMPT.nameWhileReading);
    return T;
  }

  const coverage = coverageLine(d, canGenerate);
  if (coverage && !folded) say('coverage', coverage.text, coverage.tone);

  if (!canGenerate && d.source === 'photos') {
    if (name && !folded) you('name', name, PROMPT.name);
    if (!name) {
      askName(PROMPT.name);
      return T;
    }
    ask({
      id: 'blind',
      kind: 'confirm',
      prompt: 'No engine here can draw the other views. Save them from the photos as they are?',
      options: [
        { id: 'save', label: 'Save with photos' },
        { id: 'setup', label: 'Set up' },
      ],
    });
    return T;
  }

  const p = d.views.portrait;
  const active = d.activeView as StudioView | null;

  // Every sentence sent to redraw a view is an exchange of its own, in the
  // order it was sent, and stays whatever is sent after it. The last one is
  // still open while its view draws, waits on a decision or failed; the lines
  // below close it. The rest closed when their view landed.
  const asks = d.asks ?? [];
  const last = asks[asks.length - 1];
  const lastSlot = last ? d.views[last.view] : null;
  const lastOpen =
    !!last &&
    !!lastSlot &&
    ((lastSlot.status === 'generating' && d.activeView === last.view) ||
      (lastSlot.status === 'candidate' && lastSlot.adjustment === last.text) ||
      !!lastSlot.error);
  const askedFor = (v: StudioView) => (v === 'portrait' && !identityLocked(d) ? PROMPT.identity(who) : PROMPT.change);
  // The record: every sentence sent to redraw a view, every picture that
  // landed (a restore point while it is not the one on the view), every
  // decision taken, and whatever was said in between, in the order it
  // happened. What was said at the open question is not here; it follows
  // that question.
  // Only a picture that was drawn is a line. Putting one back moves the mark
  // from one card to another; it says nothing new, so the log does not grow.
  const results = (d.results ?? []).filter((r) => r.how !== 'restored');
  const decisions = d.decisions ?? [];
  const idle = !d.activeView && d.stage === 'idle';
  // every picture drawn for a view is numbered in the order it first landed;
  // a restored one keeps its number, and the one on the view right now is
  // marked as such on its latest line
  const numbers = new Map<string, number>();
  const perView = new Map<string, number>();
  const latest = new Map<string, DraftResult>();
  for (const r of results) {
    const key = `${r.view}:${r.hash}`;
    latest.set(key, r);
    if (numbers.has(key)) continue;
    const n = (perView.get(r.view) ?? 0) + 1;
    perView.set(r.view, n);
    numbers.set(key, n);
  }
  const numberOf = (r: DraftResult) => numbers.get(`${r.view}:${r.hash}`) ?? 1;
  const shot = (r: DraftResult, id: string): Turn => {
    const n = numberOf(r);
    const onView = d.views[r.view].hash === r.hash;
    // the mark is only worth saying where a view has more than one picture
    const several = (perView.get(r.view) ?? 0) > 1;
    return {
      kind: 'scenri',
      id,
      text: `Here is ${VIEW_NAME[r.view]} ${n}.`,
      thumb: r.hash,
      label: `${VIEW_LABEL[r.view]} ${n}`,
      current: several && onView && latest.get(`${r.view}:${r.hash}`) === r,
      restore: idle && !onView ? { view: r.view, hash: r.hash } : undefined,
    };
  };
  // a drawn picture answers the ask before it on its view, once
  const taken = new Set<DraftResult>();
  const outcomes = new Map(
    asks.map((a) => {
      const r = results.find(
        (x) => !taken.has(x) && x.how === 'drawn' && x.view === a.view && x.ask === a.text && x.at >= a.at,
      );
      if (r) taken.add(r);
      return [a, r] as const;
    }),
  );
  const firstUse = decisions.find((x) => x.view === 'portrait' && x.what === 'use');
  const revisionPrompt = (v: StudioView) =>
    v === 'portrait'
      ? `Here is ${who} with the change. Use this, or keep the previous one. Using it redraws the views built on the face.`
      : `Redrew the ${VIEW_NAME[v]}. Use it, or keep the previous one.`;
  const decided = (x: DraftDecision): Turn[] => {
    const identity = x.view === 'portrait' && x === firstUse;
    const label =
      x.what === 'again'
        ? 'Try again'
        : x.what === 'keep'
          ? 'Keep previous'
          : identity
            ? 'Use this person'
            : x.view === 'portrait'
              ? 'Use this'
              : 'Use it';
    return [
      { kind: 'scenri', id: `asked-decided-${x.at}`, text: identity ? PROMPT.identity(who) : revisionPrompt(x.view) },
      { kind: 'you', id: `decided-${x.at}`, text: label, editable: false },
    ];
  };
  const pastAsks = () => {
    const closed = lastOpen ? asks.slice(0, -1) : asks;
    // what was said at the open question stays with it only while nothing has been recorded since;
    // once the record moved on, it is part of the record and does not follow the question around
    const edge = recordEdge(d);
    const chatter = asides.filter((a) => !placed.has(a) && (a.q !== openId || a.at <= edge));
    for (const a of chatter) placed.add(a);
    const firstExtra = results.find((r) => (EXTRA_VIEWS as readonly string[]).includes(r.view));
    const record: { at: string; turns: Turn[] }[] = [
      ...closed.map((a) => {
        const r = outcomes.get(a);
        return {
          at: a.at,
          turns: [
            { kind: 'scenri' as const, id: `asked-ask-${a.at}`, text: askedFor(a.view) },
            { kind: 'you' as const, id: `ask-${a.at}`, text: a.text, editable: false },
            ...(r ? [shot(r, `redrew-${a.at}`)] : []),
          ],
        };
      }),
      ...results
        .filter((r) => !taken.has(r))
        .map((r) => ({
          at: r.at,
          turns: [shot(r, `result-${r.at}`)],
        })),
      ...decisions.map((x) => ({ at: x.at, turns: decided(x) })),
      ...chatter.map((a) => ({ at: a.at, turns: asideTurns(a) })),
      // the extras decision sits between the core set and what it added
      ...(identityLocked(d) && (d.extras || ui.extrasDeclined)
        ? [
            {
              at: firstExtra ? firstExtra.at.slice(0, -1) : '~',
              turns: [
                { kind: 'scenri' as const, id: 'asked-extras', text: PROMPT.extras },
                { kind: 'you' as const, id: 'extras', text: d.extras ? 'Add them' : 'Save as is', editable: false },
              ],
            },
          ]
        : []),
    ];
    record.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
    for (const r of record) T.push(...r.turns);
  };
  const openAsk = () => {
    if (lastOpen && last) you(`ask-${last.at}`, last.text, askedFor(last.view), { editable: false });
  };

  if (!identityLocked(d)) {
    const drawingFace = p.status === 'generating' || (active === 'portrait' && p.status !== 'candidate');
    if (drawingFace && !asks.length) {
      // The first draw: the name is asked under the line that says it is
      // drawing, and the answer stays there.
      say('drawing-face', 'Drawing their face.');
      if (name) you('name', name, PROMPT.name);
      else askName(PROMPT.nameWhileDrawing);
      return T;
    }
    if (name) you('name', name, PROMPT.name);
    pastAsks();
    if (drawingFace) {
      openAsk();
      say('drawing-face', lastOpen ? 'Adjusting the face. Everything else stays.' : 'Drawing their face.');
      if (!name) askName(PROMPT.nameWhileDrawing);
      return T;
    }
    if (ui.failed) {
      ask({
        id: 'retry',
        kind: 'confirm',
        tone: 'alert',
        prompt: `That did not go through: ${ui.failed}. Nothing finished was touched.`,
        options: [{ id: 'retry', label: 'Retry' }],
      });
      return T;
    }
    if (p.error) {
      openAsk();
      ask(stoppedOrFailed('portrait', p.error));
      return T;
    }
    if (p.status === 'candidate') {
      openAsk();
      ask({
        id: 'identity',
        kind: 'confirm',
        prompt: lastOpen ? 'Adjusted. Use this person, or try again.' : PROMPT.identity(who),
        options: [
          { id: 'use', label: 'Use this person' },
          { id: 'again', label: 'Try again' },
          { id: 'change', label: 'Change something' },
        ],
      });
      return T;
    }
    return T;
  }

  if (name && !folded) you('name', name, PROMPT.name);
  pastAsks();

  const views = Object.keys(d.views) as StudioView[];
  const candidate = views.find((v) => d.views[v].status === 'candidate');
  const failed = views.find((v) => !!d.views[v].error);

  if (ui.failed && !active) {
    ask({
      id: 'retry',
      kind: 'confirm',
      tone: 'alert',
      prompt: `That did not go through: ${ui.failed}. Nothing finished was touched.`,
      options: [{ id: 'retry', label: 'Retry' }],
    });
    return T;
  }

  if (active) {
    openAsk();
    say(
      `drawing-${active}`,
      lastOpen && last?.view === active
        ? `Redrawing the ${VIEW_NAME[active]}.`
        : active === 'front' && !d.views.front.hash
          ? 'Building the reference set from this face. The full body first.'
          : `Drawing the ${VIEW_NAME[active]}.`,
    );
    // a person whose face came from a photograph has had no draw to be named during
    if (!name) askName(PROMPT.nameWhileDrawing);
    return T;
  }

  if (candidate) {
    openAsk();
    ask({
      id: candidate === 'portrait' ? 'revision' : 'view-revision',
      kind: 'confirm',
      prompt:
        candidate === 'portrait'
          ? `Here is ${who} with the change. Use this, or keep the previous one. Using it redraws the views built on the face.`
          : `Redrew the ${VIEW_NAME[candidate]}. Use it, or keep the previous one.`,
      options: [
        { id: 'use', label: candidate === 'portrait' ? 'Use this' : 'Use it' },
        { id: 'keep', label: 'Keep previous' },
        { id: 'again', label: 'Try again' },
      ],
    });
    return T;
  }

  if (failed) {
    openAsk();
    ask(stoppedOrFailed(failed, d.views[failed].error ?? ''));
    return T;
  }

  if (!allApproved(d)) {
    // between two draws of the set there is still no name and still nothing else to ask
    if (!name) askName(PROMPT.nameWhileDrawing);
    return T;
  }

  if (!d.extras && !ui.extrasDeclined) {
    say('set-ready', 'The set is ready. Select a view and say what is wrong to redraw it.');
    ask({
      id: 'extras',
      kind: 'confirm',
      prompt: PROMPT.extras,
      options: [
        { id: 'add', label: 'Add them' },
        { id: 'save', label: 'Save as is' },
      ],
    });
    return T;
  }

  if (!name) {
    askName(PROMPT.name);
    return T;
  }

  ask({
    id: 'save',
    kind: 'confirm',
    prompt: `${cap(who)} is ready.${filedLine(d)}`,
    options: [{ id: 'save', label: 'Save presenter' }],
  });
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

/**
 * The order the setup is answered in.
 *
 * It is the whole of the dependency model, deliberately: this is a short
 * ordered run of questions, not a graph. What comes after an answer depends on
 * it; what comes before it does not. Changing an answer therefore takes back
 * everything after it and nothing before it.
 */
export const SETUP_ORDER = ['source', 'look', 'describe', 'gaps', 'name'] as const;
export type SetupAnswer = (typeof SETUP_ORDER)[number];

const AT = (id: string): number => SETUP_ORDER.indexOf(id as SetupAnswer);

/**
 * The setup as it stands after an answer is changed: that answer's own value is
 * the caller's to set, and everything the flow asked after it is taken back, so
 * no answer that is no longer on the screen can reach the drawing.
 */
export function rewindSetup(setup: Setup, id: string): Partial<Setup> {
  const at = AT(id);
  if (at < 0) return {};
  const back: Partial<Setup> = {};
  // at the answer itself, everything after it goes; the answer's own new value
  // is the caller's to set
  if (at <= AT('source')) {
    // the photographs belong to the door they were added under
    back.photoHashes = [];
    back.attested = false;
  }
  if (at <= AT('look')) back.look = null;
  if (at < AT('describe')) {
    back.description = '';
    back.typed = false;
  }
  if (at < AT('gaps')) {
    back.gaps = null;
    back.gapsAsked = false;
  }
  return back;
}

/** What was said in passing after an answer, and so belongs to a future that is gone. */
export function rewindAsides(asides: Aside[], id: string): Aside[] {
  const at = AT(id);
  if (at < 0) return asides;
  // a remark made at a question that came later goes with it; one made at this
  // question or before it stays where it was said
  return asides.filter((a) => {
    const q = a.q ? a.q.replace(/^look-.*/, 'look') : null;
    const when = q ? AT(q) : -1;
    return when <= at;
  });
}

/** What changing an earlier answer costs. */
export type EditEffect = 'plain' | 'metadata' | 'redraw-identity' | 'start-over';

/** The step a look answer goes back to when it is taken back: the last one given. */
export function lastLookStep(look: Setup['look']): string | null {
  if (!look || look === 'skipped') return null;
  const given = LOOK_STEPS.filter((s) => look[s.row.id]);
  return given.length ? given[given.length - 1].row.id : null;
}

export function editEffect(turnId: string, hasDraft: boolean): EditEffect {
  if (turnId === 'name') return 'metadata';
  if (!hasDraft) return 'plain';
  if (turnId === 'describe' || turnId === 'gaps') return 'redraw-identity';
  if (turnId === 'source' || turnId === 'photos') return 'start-over';
  return 'plain';
}

/** The composer's placeholder and pill for the open question, or null when the question answers itself. */
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
}

const QUIET: ComposerFor = { placeholder: 'Nothing to type yet', label: 'Message', action: 'Send' };

export function composerFor(
  q: Question | null,
  d: DraftLike | null,
  selected: StudioView,
  /** The one step being answered in words, when a step was asked to be described. */
  saying?: string | null,
): ComposerFor {
  if (q) {
    // A question with things to tap owns the answer: the composer stands down
    // rather than competing with it, and says where the answer is. Asking to
    // describe a step hands the composer that one step, and only that one.
    if (q.id.startsWith('look-')) {
      const step = q.id.slice('look-'.length);
      if (saying === step) {
        return {
          placeholder: LOOK_SAYS_PLACEHOLDER[step] ?? 'In your words',
          label: 'Describe it',
          action: 'Send',
        };
      }
      return { ...QUIET, off: 'Tap one above.' };
    }
    switch (q.id) {
      case 'source':
        return { placeholder: 'Describe them, or choose above', label: 'Describe them', action: 'Send' };
      case 'describe':
      case 'unsure':
        return { placeholder: 'Describe them', label: 'Describe them', action: 'Send' };
      case 'name':
        return { placeholder: 'Their name', label: 'Their name', action: 'Send' };
      case 'agree':
        return saying === 'agree'
          ? { placeholder: 'Anything that makes them them', label: 'Add a detail', action: 'Send' }
          : { ...QUIET, off: 'Choose above.' };
      case 'identity':
        return {
          placeholder: 'What should change? Shorter hair, older',
          label: 'What should change',
          action: 'Refine',
        };
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
