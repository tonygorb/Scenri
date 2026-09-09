import type { Question, Turn } from '../../conversation/question.js';
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
  type DraftLike,
  type Steer,
  type StudioView,
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
  /** A sentence with nothing of a person in it, waiting to be drawn from anyway or replaced. */
  unsure?: { said: string; q: string | null; at: string } | null;
}

export const MAX_PHOTOS = 4;

export const SOURCE_OPTIONS = [
  { id: 'photos', label: 'Add photos' },
  { id: 'scratch', label: 'Describe someone' },
];

export const STARTERS = [
  'Late 30s, Mediterranean, dark shoulder-length hair, slim, warm and composed',
  'Early 20s, athletic, short blond hair, freckles, bright',
  'Around 60, silver hair, broad build, calm and assured',
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

/** The sentence the engine is given: the description with the follow-up's picks folded in. */
export function directionFrom(setup: Setup): string {
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
  photos: 'Add one clear photo of their face. Up to three more angles hold the likeness better.',
  name: 'What should we call them?',
  nameWhileDrawing: 'While it draws: what should we call them?',
  nameWhileReading: 'While I read them: what should we call them?',
  identity: (who: string) =>
    `Here is ${who === 'them' ? 'the face' : who}. Use this person, try again, or say what to change.`,
  change: 'What should change?',
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
  if (folded) for (const a of asides) if (a.q && SETUP_QS.has(a.q)) placed.add(a);
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
    T.push({ kind: 'you', id, text, editable: extra?.editable ?? true, photos: extra?.photos });
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
    if (!setup.description.trim() && !d) {
      ask({
        id: 'describe',
        kind: 'text',
        prompt: PROMPT.describe,
        starters: STARTERS,
      });
      return T;
    }
    if (!folded) {
      you('describe', setup.description.trim() || (d?.direction ?? ''), setup.typed ? PROMPT.source : PROMPT.describe);
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
    (lastSlot.status === 'generating' || lastSlot.status === 'candidate' || !!lastSlot.error) &&
    (lastSlot.adjustment === last.text || !!lastSlot.error);
  const askedFor = (v: StudioView) => (v === 'portrait' && !identityLocked(d) ? PROMPT.identity(who) : PROMPT.change);
  // The record: the closed asks and whatever was said in between, in the
  // order it happened. What was said at the open question is not here; it
  // follows that question.
  const pastAsks = () => {
    const closed = lastOpen ? asks.slice(0, -1) : asks;
    const chatter = asides.filter((a) => !placed.has(a) && a.q !== openId);
    for (const a of chatter) placed.add(a);
    const record: { at: string; turns: Turn[] }[] = [
      ...closed.map((a) => ({
        at: a.at,
        turns: [
          { kind: 'scenri' as const, id: `asked-ask-${a.at}`, text: askedFor(a.view) },
          { kind: 'you' as const, id: `ask-${a.at}`, text: a.text, editable: false },
          { kind: 'scenri' as const, id: `redrew-${a.at}`, text: `Redrew the ${VIEW_NAME[a.view]}.` },
        ],
      })),
      ...chatter.map((a) => ({ at: a.at, turns: asideTurns(a) })),
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
      ask({
        id: 'retry',
        kind: 'confirm',
        tone: 'alert',
        prompt: `The face could not be drawn: ${p.error}. Nothing finished was touched.`,
        options: [{ id: 'retry', label: 'Retry' }],
      });
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
    ask({
      id: 'retry',
      kind: 'confirm',
      tone: 'alert',
      prompt: `The ${VIEW_NAME[failed]} could not be drawn: ${d.views[failed].error}. Nothing finished was touched.`,
      options: [{ id: 'retry', label: 'Retry' }],
    });
    return T;
  }

  if (!allApproved(d)) return T;

  if (!d.extras && !ui.extrasDeclined) {
    say('set-ready', 'The set is ready. Select a view and say what is wrong to redraw it.');
    ask({
      id: 'extras',
      kind: 'confirm',
      prompt: 'Add back and profile views? They help shots from behind or in profile.',
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
    prompt: `${cap(who)} is ready.`,
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

/** What changing an earlier answer costs. */
export type EditEffect = 'plain' | 'metadata' | 'redraw-identity' | 'start-over';

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

export function composerFor(q: Question | null, d: DraftLike | null, selected: StudioView): ComposerFor {
  if (q) {
    switch (q.id) {
      case 'source':
        return { placeholder: 'Describe them, or choose above', label: 'Describe them', action: 'Send' };
      case 'describe':
      case 'unsure':
        return { placeholder: 'Describe them', label: 'Describe them', action: 'Send' };
      case 'name':
        return { placeholder: 'Their name', label: 'Their name', action: 'Send' };
      case 'identity':
        return { placeholder: 'Adjust: shorter hair, older', label: 'What should change', action: 'Refine' };
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
    const v = d.activeView as StudioView | null;
    const off = v ? `The ${VIEW_NAME[v]} is still drawing.` : 'Still drawing.';
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
