import type { Question, Turn } from '../../conversation/question.js';
import { choiceFromText } from '../../conversation/question.js';
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
  const T = turnsBase(args);
  if (!args.ui.reasking) return T;
  const kept = T[T.length - 1]?.kind === 'question' ? T.slice(0, -1) : T;
  if (args.ui.reasking === 'name') {
    return [...kept, { kind: 'question', question: { id: 'name', kind: 'text', prompt: 'What should we call them?' } }];
  }
  return [
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

function turnsBase({ setup, draft: d, canGenerate, ui }: FlowArgs): Turn[] {
  const T: Turn[] = [{ kind: 'you', id: 'intent', text: 'Create a presenter' }];
  const you = (id: string, text: string, asked: string, extra?: { photos?: string[]; editable?: boolean }) =>
    T.push({ kind: 'you', id, text, asked, editable: extra?.editable ?? true, photos: extra?.photos });
  const say = (id: string, text: string, tone?: 'alert' | 'warn') => T.push({ kind: 'scenri', id, text, tone });
  const ask = (question: Question) => T.push({ kind: 'question', question });
  const name = d?.name?.trim() ?? '';
  const who = name || 'them';
  const folded = ui.collapsed && !!d && identityLocked(d);
  // A draft opened at its address carries its own answers; the setup mirror is only for before.
  const source: Source | null = setup.source ?? (d ? (d.source === 'photos' ? 'photos' : 'scratch') : null);

  if (!source) {
    ask({
      id: 'source',
      kind: 'choice',
      prompt: 'Who are we creating? Describe someone new, or add photos of a real person.',
      options: SOURCE_OPTIONS,
    });
    return T;
  }

  if (!folded && !setup.typed)
    you('source', source === 'photos' ? 'Add photos' : 'Describe someone', 'Who are we creating?');

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
        prompt: 'Describe them. Age, hair, build, skin and presence all help; one or two sentences is enough.',
        starters: STARTERS,
      });
      return T;
    }
    if (!folded) you('describe', setup.description.trim() || (d?.direction ?? ''), 'Describe them.');
    if (setup.gapsAsked && !setup.gaps && !d) {
      const gaps = descriptionGaps(setup.description);
      ask({
        id: 'gaps',
        kind: 'choice',
        prompt:
          gaps.length === 1
            ? 'One thing I cannot tell yet.'
            : gaps.length === 2
              ? 'Two things I cannot tell yet.'
              : 'A few things I cannot tell yet.',
        groups: gaps.map((g) => ({ id: g, ...GAP_GROUPS[g] })),
        submit: 'Continue',
        skip: 'Skip, draw as is',
      });
      return T;
    }
    if (setup.gaps && !folded) you('gaps', gapsLine(setup.gaps), 'What I could not tell');
  } else {
    if (!d) {
      ask({
        id: 'photos',
        kind: 'photos',
        prompt: 'Add one clear photo of their face. Up to three more angles hold the likeness better.',
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
      you('photos', photosLine(n), 'Photos of them', { photos: d.sources ?? [], editable: true });
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
    if (!name) askName('While I read them: what should we call them?');
    return T;
  }

  const coverage = coverageLine(d, canGenerate);
  if (coverage && !folded) say('coverage', coverage.text, coverage.tone);

  if (!canGenerate && d.source === 'photos') {
    if (name && !folded) you('name', name, 'What should we call them?');
    if (!name) {
      askName('What should we call them?');
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

  if (!identityLocked(d)) {
    if (p.status === 'generating' || (active === 'portrait' && p.status !== 'candidate')) {
      say(
        'drawing-face',
        p.adjustment ? `Adjusting the face: "${p.adjustment}". Everything else stays.` : 'Drawing their face.',
      );
      if (!name) askName('While it draws: what should we call them?');
      return T;
    }
    if (name) you('name', name, 'What should we call them?');
    if (p.error) {
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
      if (p.adjustment) you('adjust', p.adjustment, 'What should change');
      ask({
        id: 'identity',
        kind: 'confirm',
        prompt: p.adjustment
          ? 'Adjusted. Use this person, or try again.'
          : `Here is ${who === 'them' ? 'the face' : who}. Use this person, try again, or say what to change.`,
        options: [
          { id: 'use', label: 'Use this person' },
          { id: 'again', label: 'Try again' },
        ],
      });
      return T;
    }
    return T;
  }

  if (name && !folded) you('name', name, 'What should we call them?');

  const views = Object.keys(d.views) as StudioView[];
  const candidate = views.find((v) => d.views[v].status === 'candidate');
  const failed = views.find((v) => !!d.views[v].error);

  if (active) {
    const slot = d.views[active];
    say(
      `drawing-${active}`,
      slot.adjustment
        ? `Redrawing the ${VIEW_NAME[active]}: "${slot.adjustment}".`
        : active === 'front' && !d.views.front.hash
          ? 'Building the reference set from this face. The full body first.'
          : `Drawing the ${VIEW_NAME[active]}.`,
    );
    return T;
  }

  if (candidate) {
    const slot = d.views[candidate];
    if (slot.adjustment) you('adjust', slot.adjustment, 'What should change');
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
    ask({
      id: 'retry',
      kind: 'confirm',
      tone: 'alert',
      prompt: `The ${VIEW_NAME[failed]} could not be drawn: ${d.views[failed].error}. Nothing finished was touched.`,
      options: [{ id: 'retry', label: 'Retry' }],
    });
    return T;
  }

  // A view that decided itself keeps the sentence that redrew it in the record.
  for (const v of views) {
    const slot = d.views[v];
    if (slot.status === 'approved' && slot.prior && slot.adjustment && v !== 'portrait') {
      you(`adjust-${v}`, slot.adjustment, 'What should change', { editable: false });
      say(`redrew-${v}`, `Redrew the ${VIEW_NAME[v]}.`);
    }
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
    askName('What should we call them?');
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

/** The open question, read off the transcript. */
export function activeQuestion(turns: Turn[]): Question | null {
  const last = turns[turns.length - 1];
  return last && last.kind === 'question' ? last.question : null;
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
export function composerFor(
  q: Question | null,
  d: DraftLike | null,
  selected: StudioView,
): { placeholder: string; label: string; action: string } | null {
  if (q) {
    switch (q.id) {
      case 'source':
        return { placeholder: 'Describe them, or choose above', label: 'Describe them', action: 'Send' };
      case 'describe':
        return { placeholder: 'Describe them', label: 'Describe them', action: 'Send' };
      case 'name':
        return { placeholder: 'Their name', label: 'Their name', action: 'Send' };
      case 'identity':
        return { placeholder: 'Adjust: shorter hair, older', label: 'What should change', action: 'Refine' };
      case 'gaps':
      case 'photos':
      case 'noengine':
      case 'blind':
      case 'retry':
        return null;
    }
  }
  if (!d || !identityLocked(d) || drawing(d)) {
    if (d && drawing(d) && identityLocked(d)) {
      return { placeholder: composerPlaceholder(selected, d), label: 'What should change', action: 'Refine' };
    }
    return null;
  }
  return { placeholder: composerPlaceholder(selected, d), label: 'What should change', action: 'Refine' };
}

function composerPlaceholder(selected: StudioView, d: DraftLike): string {
  const who = d.name?.trim() || 'them';
  return selected === 'portrait' ? `What should change about ${who}?` : `Change this view: ${VIEW_NAME[selected]}`;
}
