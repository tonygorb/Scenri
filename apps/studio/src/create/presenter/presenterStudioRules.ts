import type { PresenterDraft, PresenterDraftSlot, PresenterDraftView } from '../../api.js';

/**
 * The presenter studio's rules, pure: which views a draft is building,
 * which is on the stage, what gets drawn without a click, what a sentence
 * in the composer is aimed at, what blocks a save. The components and the
 * flows read these; nothing here reads a component.
 */
export type StudioView = PresenterDraftView;

/** What one view is. The studio's half of the server's own table. */
export interface ViewRole {
  id: StudioView;
  /** Built by default, or only once somebody asks for the whole set. */
  tier: 'core' | 'supplementary';
  /** A person decides this one; the draft does not advance past it alone. */
  gate?: true;
  /** The approved views it is drawn from, in the order they are attached. */
  from: StudioView[];
  /** The strip's word for it. */
  strip: string;
  /** The same view inside a sentence. */
  name: string;
}

/**
 * The six views, in the order they are built and saved.
 *
 * This is the server's table (presenterPrompts.ts) with the two columns the
 * browser needs and none of the prompt prose it does not. The studio has no
 * dependency on any Scenri package by design, so the two are kept level by
 * presenterViewParity.test.ts rather than by an import: change one side alone
 * and that test goes red.
 */
export const VIEW_ROLES: readonly ViewRole[] = [
  { id: 'portrait', tier: 'core', gate: true, from: [], strip: 'Face', name: 'face' },
  { id: 'front', tier: 'core', gate: true, from: ['portrait'], strip: 'Full body', name: 'full body' },
  {
    id: 'three-quarter',
    tier: 'core',
    from: ['portrait', 'front'],
    strip: 'Three-quarter',
    name: 'three-quarter view',
  },
  { id: 'back', tier: 'supplementary', from: ['portrait', 'front'], strip: 'Back', name: 'back view' },
  { id: 'left', tier: 'supplementary', from: ['portrait', 'front'], strip: 'Left', name: 'left view' },
  { id: 'right', tier: 'supplementary', from: ['portrait', 'front', 'left'], strip: 'Right', name: 'right view' },
];

const idsWhere = (want: (r: ViewRole) => boolean): readonly StudioView[] => VIEW_ROLES.filter(want).map((r) => r.id);

export const VIEWS: readonly StudioView[] = idsWhere(() => true);
export const CORE_VIEWS: readonly StudioView[] = idsWhere((r) => r.tier === 'core');
export const EXTRA_VIEWS: readonly StudioView[] = idsWhere((r) => r.tier === 'supplementary');

/** The strip's word for a view. */
export const VIEW_LABEL = Object.fromEntries(VIEW_ROLES.map((r) => [r.id, r.strip])) as Record<StudioView, string>;

/** The view inside a sentence. */
export const VIEW_NAME = Object.fromEntries(VIEW_ROLES.map((r) => [r.id, r.name])) as Record<StudioView, string>;
const lower = (v: StudioView) => VIEW_NAME[v];

/** Which approved views a view is drawn from. Mirrors the server's plan. */
export const DEPENDS = Object.fromEntries(VIEW_ROLES.map((r) => [r.id, r.from])) as Record<StudioView, StudioView[]>;

/** The views a person decides rather than the draft deciding for them. */
export const HAND_APPROVED: ReadonlySet<StudioView> = new Set(idsWhere((r) => r.gate === true));

/**
 * Whether a draw may decide for itself.
 *
 * A gated view comes back as a candidate and waits; every other view lands
 * approved. This is one function rather than nine copies of a comparison
 * against 'portrait', so gating a second view is a flag on a row and never a
 * hunt through two hooks for the places that forgot.
 */
export const autoFor = (v: StudioView): 'auto' | undefined => (HAND_APPROVED.has(v) ? undefined : 'auto');

/** Four is the working ceiling: past that a photo adds nothing an engine reads. */
export const MAX_PHOTOS = 4;

export type DraftLike = Pick<PresenterDraft, 'source' | 'name' | 'views' | 'activeView' | 'stage'> & {
  direction?: string;
  /** What the person said stays the same about them, in their own words. */
  keep?: string;
  /** The same, one thing at a time, which is what a resumed page reads back. */
  keepItems?: PresenterDraft['keepItems'];
  sources?: string[];
  analysis?: PresenterDraft['analysis'];
  readError?: string;
  extras?: boolean;
  identityEdits?: string[];
  asks?: PresenterDraft['asks'];
  results?: PresenterDraft['results'];
  decisions?: PresenterDraft['decisions'];
};
export type DraftResult = NonNullable<DraftLike['results']>[number];
export type DraftDecision = NonNullable<DraftLike['decisions']>[number];

/**
 * The views this draft is building: the core ones, whatever supplementary
 * views it already holds, and the whole set once somebody asked for it.
 *
 * The middle clause is what keeps a person who holds one extra view from
 * being asked to finish a set they never started: a record carrying a back
 * view and no profiles used to read as "extras are on" and then refuse to
 * save until two views nobody asked for had been drawn.
 */
export const viewsOf = (d: DraftLike): readonly StudioView[] =>
  idsWhere((r) => r.tier === 'core' || !!d.extras || d.views[r.id]?.status !== 'empty');

export type Phase = 'identity' | 'build' | 'review';

/** The first view not yet approved, in build order; null once every view in play is. */
export function currentView(d: DraftLike): StudioView | null {
  return viewsOf(d).find((v) => d.views[v].status !== 'approved') ?? null;
}

export const allApproved = (d: DraftLike): boolean => currentView(d) === null;

/**
 * The face is approved: from here on every view is drawn from it. A revision
 * waiting for a decision still has the approved face behind it (`prior`).
 */
export const identityLocked = (d: DraftLike): boolean =>
  d.views.portrait.status === 'approved' || !!d.views.portrait.prior;

export const drawing = (d: DraftLike): boolean => d.stage !== 'idle' || !!d.activeView;

/**
 * Photos with no engine can still become a presenter: the face is enough.
 * With an engine, every view in play has to be approved.
 */
export function readyToSave(d: DraftLike, canGenerate: boolean): boolean {
  if (allApproved(d)) return true;
  return !canGenerate && d.source === 'photos' && d.views.portrait.status === 'approved';
}

/** A candidate somewhere still waits for a decision. */
const pending = (d: DraftLike) => viewsOf(d).some((v) => d.views[v].status === 'candidate');

/** Identity until the face is used; review once everything stands; build in between. */
export function phaseOf(d: DraftLike, canGenerate: boolean): Phase {
  if (!identityLocked(d)) return 'identity';
  if (readyToSave(d, canGenerate) && !drawing(d) && !pending(d)) return 'review';
  return 'build';
}

/**
 * What is drawn next with no click: the first view not yet approved, when
 * it is empty or stale, has not just failed, and everything it is drawn
 * from is approved. A candidate waits for a decision, a failure waits for
 * Retry. A stale view is drawn again on its own: the person already decided
 * the change that staled it.
 */
export function nextToDraw(d: DraftLike): StudioView | null {
  if (drawing(d)) return null;
  const view = currentView(d);
  if (!view) return null;
  const slot = d.views[view];
  if (slot.status !== 'empty' && slot.status !== 'stale') return null;
  if (slot.error) return null;
  return DEPENDS[view].every((dep) => d.views[dep].status === 'approved') ? view : null;
}

/** The view on the stage: what the person chose, else what is being drawn, else what is next. */
export function selectedView(d: DraftLike, focus: StudioView | null): StudioView {
  return focus ?? (drawing(d) ? (d.activeView as StudioView | null) : null) ?? currentView(d) ?? 'portrait';
}

export type StripState = 'approved' | 'current' | 'todo' | 'stale';
export interface StripItem {
  view: StudioView;
  label: string;
  state: StripState;
  hash: string | undefined;
  photo: boolean;
  drawing: boolean;
  /** Used, whether or not it is the one on the stage. */
  approved: boolean;
  error: boolean;
}

/** The views in play as the progress: what stands, what is being decided, what is still to come. */
export function stripItems(d: DraftLike, selected: StudioView): StripItem[] {
  return viewsOf(d).map((view) => {
    const slot = d.views[view];
    const state: StripState =
      view === selected
        ? 'current'
        : slot.status === 'approved'
          ? 'approved'
          : slot.status === 'stale'
            ? 'stale'
            : 'todo';
    return {
      view,
      label: VIEW_LABEL[view],
      state,
      hash: slot.hash,
      photo: slot.origin === 'photo',
      drawing: d.activeView === view,
      approved: slot.status === 'approved',
      error: !!slot.error,
    };
  });
}

/* --------------------------------------------------------------- casting */

export type Steer = 'woman' | 'man' | 'androgynous';
export type Age = '20s' | '30s' | '40s' | '50s' | '60+';
export type Tone = 'fair' | 'light' | 'olive' | 'tan' | 'brown' | 'deep';
export type Hair = string;

export interface Traits {
  steer: Steer | null;
  age: Age | null;
  tone: Tone | null;
  hair: Hair | null;
}
export const NO_TRAITS: Traits = { steer: null, age: null, tone: null, hair: null };

const STEER_WORDS: Record<Steer, string> = {
  woman: 'a woman',
  man: 'a man',
  androgynous: 'an androgynous person',
};
const POSSESSIVE: Record<Steer, string> = { woman: 'her', man: 'his', androgynous: 'their' };
const HAIR_WORDS: Record<string, string> = {
  black: 'black hair',
  brown: 'brown hair',
  blonde: 'blonde hair',
  red: 'red hair',
  grey: 'grey hair',
  white: 'white hair',
};

/**
 * A colour a person can point at, in the words the engine reads: a hex in a
 * prompt is either dropped or guessed at, so a custom colour is named. The
 * list is the colours hair is found or dyed in, natural first.
 */
const HAIR_NAMES: [string, number, number, number][] = [
  ['jet black', 0x1a, 0x18, 0x17],
  ['dark brown', 0x3b, 0x27, 0x18],
  ['chestnut brown', 0x6b, 0x42, 0x26],
  ['light brown', 0x9b, 0x6f, 0x45],
  ['auburn', 0x8c, 0x3b, 0x24],
  ['copper red', 0xb5, 0x51, 0x22],
  ['ginger', 0xd1, 0x7a, 0x33],
  ['honey blonde', 0xd9, 0xb2, 0x6a],
  ['platinum blonde', 0xe8, 0xdc, 0xbf],
  ['silver grey', 0xb9, 0xb6, 0xb1],
  ['white', 0xf2, 0xf1, 0xee],
  ['burgundy', 0x6a, 0x1b, 0x2f],
  ['pink', 0xe3, 0x74, 0xa6],
  ['lavender', 0xa9, 0x8c, 0xd4],
  ['blue', 0x3f, 0x63, 0xc4],
  ['teal', 0x2f, 0x9a, 0x94],
  ['green', 0x4c, 0xa1, 0x50],
];

export function hairName(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 'dyed';
  const n = Number.parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  let best = HAIR_NAMES[0];
  let near = Number.POSITIVE_INFINITY;
  for (const c of HAIR_NAMES) {
    const dist = (c[1] - r) ** 2 + (c[2] - g) ** 2 + (c[3] - b) ** 2;
    if (dist < near) {
      near = dist;
      best = c;
    }
  }
  return best[0];
}

/** The words for whatever the hair is set to, named or picked. */
export function hairPhrase(hair: Hair): string {
  return HAIR_WORDS[hair] ?? `${hairName(hair)} hair`;
}
const TONE_WORDS: Record<Tone, string> = {
  fair: 'fair skin',
  light: 'light skin',
  olive: 'olive skin',
  tan: 'tan skin',
  brown: 'brown skin',
  deep: 'deep brown skin',
};

/** Words that say who the person is, which is the one thing a roll cannot guess. */
export const saysWho =
  /\b(wom[ae]n|m[ae]n|male|female|lady|ladies|girl|boy|guy|gentlem[ae]n|nonbinary|non-binary|androgynous|masculine|feminine|transgender|trans|mother|father|mum|mom|dad|sister|brother|daughter|son|grandmother|grandfather|she|he|her|his)\b/i;
/** Words that already put an age on them. */
export const saysAge =
  /\b(\d0s|\d{2}\s*(years|yo)|teen|twenties|thirties|forties|fifties|sixties|seventies|elderly|young|old(er)?|middle-aged|adult)\b/i;
/** Words that already say what their hair is. */
const SAYS_HAIR = /\b(hair|bald|shaved|buzz|blonde?|brunette|redhead|ginger|greying|silver|auburn|platinum)\b/i;
/** Words that already say what their skin is like. */
const SAYS_TONE =
  /\b(skin|complexion|fair|pale|light|olive|tan|tanned|brown|deep|dark|ebony|black|white|freckled|golden)\b/i;
/** A person by noun: a pronoun alone says too little for a sentence to be read as one. */
const SAYS_PERSON =
  /\b(wom[ae]n|m[ae]n|male|female|lady|ladies|girl|boy|guy|guys|gentlem[ae]n|nonbinary|non-binary|androgynous|masculine|feminine|transgender|trans|mother|father|mum|mom|dad|sister|brother|daughter|son|grandmother|grandfather|person|people|someone|somebody|model|teen|teenager|kid|child|adult|senior)\b/i;
/** Hair, face, build, presence, and what a change to any of them is called. */
const SAYS_LOOKS =
  /\b(hair|haired|curly|wavy|straight|braids?|bob|ponytail|bun|fringe|bangs|beard|beardless|moustache|mustache|stubble|goatee|clean-shaven|freckles?|glasses|spectacles|tattoos?|piercings?|eyes?|eyebrows?|brows|jaw|jawline|cheekbones|nose|lips|mouth|smile|smiling|face|features|forehead|dimples|scar|wrinkles|build|figure|frame|body|tall|short|slim|slender|athletic|average|fuller|curvy|broad|lean|muscular|petite|stocky|heavy|thin|plus.size|height|weight|presence|vibe|energy|look|looks|looking|calm|warm|confident|elegant|composed|friendly|serious|intense|soft|gentle|bright|energetic|quiet|poised|relaxed|playful|stern|kind|charming|handsome|beautiful|pretty|striking|rugged|graceful|sporty|nerdy|bookish|professional|corporate|casual|older|younger|taller|shorter|longer|slimmer|leaner|heavier|broader|bigger|smaller|thinner|thicker|softer|sharper|lighter|darker|natural|makeup|make-up|lipstick|jewelry|earrings)\b/i;
const SAYS_ORIGIN =
  /\b(mediterranean|asian|indian|chinese|japanese|korean|african|nordic|scandinavian|latin[ao]?|hispanic|arab|arabic|middle eastern|european|caucasian|israeli|jewish|irish|italian|french|spanish|greek|turkish|persian|brazilian|mexican|american|british|german|dutch|russian|polish|thai|vietnamese|filipin[ao]|nigerian|ethiopian|moroccan|egyptian|australian|canadian|swedish|norwegian|danish|finnish|portuguese|indonesian|pakistani|iranian|lebanese|slavic|celtic|mixed|biracial)\b/i;

/**
 * Whether a sentence has anything of a person in it: who they are, their
 * age, hair, skin, build, face, presence or origin. What a face is drawn
 * from; what the conversation asks about first when it is missing.
 */
export const readsAsPerson = (text: string): boolean =>
  SAYS_PERSON.test(text) ||
  saysAge.test(text) ||
  SAYS_HAIR.test(text) ||
  SAYS_TONE.test(text) ||
  SAYS_LOOKS.test(text) ||
  SAYS_ORIGIN.test(text);

/**
 * The sentence the engine is given.
 *
 * The chosen traits lead it, in the order a person would say them, and each
 * one drops out when the sentence already covers it, because a prompt that
 * says a thing twice is a prompt arguing with itself.
 */
export function castSentence(t: Traits, direction: string): string {
  const text = direction.trim();
  if (!text) return '';
  const parts: string[] = [];
  const who = t.steer && !saysWho.test(text) ? STEER_WORDS[t.steer] : '';
  if (who) parts.push(who);
  if (t.age && !saysAge.test(text)) {
    const poss = t.steer ? POSSESSIVE[t.steer] : 'their';
    const age = t.age === '60+' ? `in ${poss} 60s or older` : `in ${poss} ${t.age}`;
    parts.push(who ? age : `someone ${age}`);
  }
  const has: string[] = [];
  if (t.tone && !SAYS_TONE.test(text)) has.push(TONE_WORDS[t.tone]);
  if (t.hair && !SAYS_HAIR.test(text)) has.push(hairPhrase(t.hair));
  if (has.length) parts.push(`with ${has.join(' and ')}`);
  if (!parts.length) return text;
  return `${parts.join(' ')}, ${text}`;
}

/**
 * What the Filed under line should start from, or null to leave it alone.
 * The engine names the categories off the photographs or the portrait it
 * drew; the line opens with that answer in it, once, and never argues with a
 * person who has already chosen.
 */
export function seedCategories(d: DraftLike, chosen: string[]): string[] | null {
  const read = d.analysis?.suitableCategories ?? [];
  if (!read.length || chosen.length) return null;
  return read;
}

/** Drawn work a discard would throw away. A placed photo is still on disk as itself. */
export function worthKeeping(d: DraftLike): boolean {
  return VIEWS.some((v) => {
    const s = d.views[v];
    return !!s.hash && s.origin !== 'photo' && s.status !== 'empty';
  });
}

/** A draft that is worth offering back when the studio reopens. */
export function resumable(d: DraftLike): boolean {
  if (d.sources?.length) return true;
  if (d.direction?.trim()) return true;
  return worthKeeping(d);
}

/**
 * What stops a save, first thing first: the sentence a disabled button
 * carries. A view that decided itself and still holds the one it replaced
 * is not a blocker; Keep previous is an offer, not a debt.
 */
export function saveBlocker(d: DraftLike, name: string, canGenerate = true): string | null {
  if (drawing(d)) return 'Still drawing';
  const required: readonly StudioView[] = !canGenerate && d.source === 'photos' ? ['portrait'] : viewsOf(d);
  for (const v of required) {
    const s = d.views[v];
    if (s.status === 'candidate') return `Decide on the ${lower(v)} first`;
    if (s.status === 'stale') return `Redo the ${lower(v)} first`;
    if (s.status !== 'approved') return `Use the ${lower(v)} first`;
  }
  if (!name.trim()) return 'Give them a name';
  return null;
}

/* ------------------------------------------------------------- refining */

/** Words that change who the person is, rather than how one picture was taken. */
export const IDENTITY_WORDS =
  /\b(hair|bald|fringe|bangs|beard|moustache|mustache|stubble|skin|freckles?|complexion|age|older|younger|\d0s|face|facial|jaw|chin|cheek(bone)?s?|nose|eyes?|brows?|eyebrows?|lips?|mouth|teeth|wrinkles?|build|weight|heavier|slimmer|thinner|leaner|broader|muscular|athletic|curvier|taller|shorter|height|gender|woman|man|feminine|masculine|glasses|tattoo|scar)\b/i;

export type RefineTarget = { view: StudioView; scope: 'identity' | 'view' } | { blocked: string };

/**
 * What a sentence in the composer is aimed at. Before the face is used, every
 * ask nudges the face candidate. After it, an ask on the face, or one naming
 * something that belongs to the person (hair, skin, age, build...), changes
 * the person and redraws the face; anything else changes only the view on
 * the stage. A photograph is never redrawn: the person's own photos are who
 * they are.
 */
export function refineTarget(text: string, selected: StudioView, d: DraftLike): RefineTarget {
  if (!text.trim()) return { blocked: 'Say what should change.' };
  if (!identityLocked(d)) {
    if (d.views.portrait.status !== 'candidate') return { blocked: 'Nothing to adjust yet.' };
    return { view: 'portrait', scope: 'identity' };
  }
  const identity = selected === 'portrait' || IDENTITY_WORDS.test(text);
  if (identity) {
    if (d.views.portrait.origin === 'photo') {
      return { blocked: 'Their photos define who they are. Change a drawn view instead.' };
    }
    return { view: 'portrait', scope: 'identity' };
  }
  const slot = d.views[selected];
  if (slot.origin === 'photo') return { blocked: 'Your photo stands as it is. Pick a drawn view to change.' };
  if (slot.status !== 'approved' && slot.status !== 'candidate')
    return { blocked: `Nothing drawn for the ${lower(selected)} yet.` };
  return { view: selected, scope: 'view' };
}

/** The one line under the composer saying what Refine will do, before it is pressed. */
export function refineHint(selected: StudioView, d: DraftLike): string {
  if (!identityLocked(d)) return 'An adjustment keeps this person. Try again rolls a new one.';
  if (d.views.portrait.origin === 'photo') return 'Changes this view only. Their photos define who they are.';
  if (selected === 'portrait') return 'Changes the person. The other views are redrawn after you use it.';
  return 'Changes this view only. Hair, skin, age or build change the person.';
}

export type ComposerState = {
  /** The chip in the card naming what Refine will touch; none while the sentence is refused. */
  chip: { view: StudioView; label: string } | null;
  /** The line under the card. */
  hint: string;
  tone?: 'alert';
};

/**
 * What the composer shows around the sentence, following it as it is typed:
 * the chip says which picture Refine will redraw, and the line under the
 * card says what that means. A sentence that cannot go anywhere drops the
 * chip and puts the reason on the line.
 */
export function composerState(text: string, selected: StudioView, d: DraftLike): ComposerState {
  const typed = text.trim();
  const t = refineTarget(typed || 'this', selected, d);
  if ('blocked' in t) {
    return typed ? { chip: null, hint: t.blocked, tone: 'alert' } : { chip: null, hint: refineHint(selected, d) };
  }
  const label = !identityLocked(d)
    ? 'Adjusting the face'
    : t.scope === 'identity'
      ? 'Changing the person'
      : `Refining the ${VIEW_NAME[t.view]}`;
  return { chip: { view: t.view, label }, hint: refineHint(selected, d) };
}

/* --------------------------------------------------------------- photos */

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** After the read: which views the photos already are, and which will be drawn. */
export function coverageLine(d: DraftLike, canGenerate: boolean): { text: string; tone?: 'warn' } | null {
  if (d.source !== 'photos' || d.stage === 'analyzing') return null;
  const readError = d.readError?.trim();
  if (readError) {
    const reason = /[.!?]$/.test(readError) ? readError : `${readError}.`;
    return { text: `The photos could not be read: ${reason} Your first photo is the face.`, tone: 'warn' };
  }
  const conflict = d.analysis?.conflict?.trim();
  if (conflict) return { text: `These photos may show more than one person: ${conflict}`, tone: 'warn' };
  const inPlay = viewsOf(d);
  const photo = inPlay.filter((v) => d.views[v].origin === 'photo');
  const drawn = inPlay.filter((v) => d.views[v].origin !== 'photo');
  const list = (vs: readonly StudioView[]) =>
    vs.length <= 2
      ? vs.map(lower).join(' and ')
      : `${vs.slice(0, -1).map(lower).join(', ')} and ${lower(vs[vs.length - 1])}`;
  const from = photo.length ? `${cap(list(photo))} from your ${photo.length === 1 ? 'photo' : 'photos'}.` : '';
  if (!drawn.length) return { text: from };
  const how = canGenerate ? 'drawn from them' : 'saved from the photos as they are';
  const rest =
    drawn.length >= 3 && photo.length
      ? `The rest are ${how}.`
      : `${cap(list(drawn))} ${drawn.length === 1 ? 'is' : 'are'} ${how}.`;
  return { text: [from, rest].filter(Boolean).join(' ') };
}

/** A slot, for tests and for anyone building a draft by hand. */
export const emptySlot = (): PresenterDraftSlot => ({ status: 'empty', attempts: 0, rejected: [] });

/** What the stage is doing, in a few words: the view being drawn, and whether it is drawn over a picture it already has. */
/**
 * When the step now running began.
 *
 * The row's own updated stamp moves on every write, so the analyzer finishing
 * or a name typed while the picture draws sent the clock back to 0:00 and read
 * as the whole thing starting over. The slot carries the moment its step was
 * admitted, and that is what a person is watching.
 */
export const drawingSince = (d: DraftLike & { updatedAt?: string }): string | undefined =>
  (d.activeView ? d.views[d.activeView]?.startedAt : undefined) ?? d.updatedAt;

export function doingLine(d: DraftLike): string | undefined {
  if (d.stage === 'analyzing') return `Reading ${d.source === 'photos' ? 'the photos' : 'the face'}`;
  const v = d.activeView;
  if (!v) return undefined;
  const again = !!d.views[v]?.hash;
  if (v === 'portrait') return again ? 'Adjusting the face' : 'Drawing the face';
  return `${again ? 'Redrawing' : 'Drawing'} the ${VIEW_NAME[v]}`;
}

/** One picture a view has worn: its number, its file, and whether it wears it now. */
export interface Take {
  n: number;
  hash: string;
  current: boolean;
}

/**
 * Whether anything has been drawn from this view yet.
 *
 * Swapping which picture a view wears is honest while that view is the only
 * thing standing on it, and destructive the moment something else was drawn
 * from it: the server stales every dependent, so one tap of an arrow on a face
 * that a full body and four more views were built from throws all five away.
 * That is not an undo, it is a demolition, and it was one tap with nothing
 * said.
 *
 * So the swap is offered while nothing rests on the picture and withdrawn
 * after. Going back to an earlier face once a body exists is a decision to
 * rebuild, and the flow already has the words for it: Try again, or change
 * something. The pictures themselves are not lost either way, because the
 * conversation keeps them: every one that was drawn is still a turn in the
 * log, which is where a chat remembers things.
 */
export function builtOn(d: DraftLike, view: StudioView): boolean {
  const after = new Set<StudioView>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const v of VIEWS) {
      if (v === view || after.has(v)) continue;
      if (DEPENDS[v].some((dep) => dep === view || after.has(dep))) {
        after.add(v);
        grew = true;
      }
    }
  }
  return [...after].some((v) => !!d.views[v].hash);
}

/**
 * Every picture drawn for a view, oldest first. The strip under the stage says
 * which view you are looking at; this says which of its pictures, so a person
 * who has gone back and forth can see them side by side at a glance instead of
 * reading the log for it.
 */
export function takesOf(d: DraftLike, view: StudioView): Take[] {
  const seen = new Set<string>();
  const out: Take[] = [];
  for (const r of d.results ?? []) {
    if (r.view !== view || r.how === 'restored' || seen.has(r.hash)) continue;
    seen.add(r.hash);
    out.push({ n: out.length + 1, hash: r.hash, current: d.views[view].hash === r.hash });
  }
  return out.length > 1 ? out : [];
}
