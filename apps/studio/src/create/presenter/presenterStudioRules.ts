import type { PresenterDraft, PresenterDraftSlot, PresenterDraftView } from '../../api.js';

/**
 * The presenter studio's rules, pure: which phase the dialog is in, which
 * view is on the stage, what gets drawn without a click, what the rail says
 * and offers, what a request in the composer is aimed at, what blocks a
 * save. The components read these; nothing here reads a component.
 */
export type StudioView = PresenterDraftView;
export const VIEWS: readonly StudioView[] = ['portrait', 'front', 'left', 'back', 'right'];

/** The strip's word for a view: the Figma's Avatar, Front, Left, Back, Right. */
export const VIEW_LABEL: Record<StudioView, string> = {
  portrait: 'Avatar',
  front: 'Front',
  left: 'Left',
  back: 'Back',
  right: 'Right',
};

/** The view inside a sentence. */
export const VIEW_NAME: Record<StudioView, string> = {
  portrait: 'face',
  front: 'front view',
  left: 'left view',
  back: 'back view',
  right: 'right view',
};
const lower = (v: StudioView) => VIEW_NAME[v];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Which approved views a view is drawn from. Mirrors the server's plan. */
const DEPENDS: Record<StudioView, StudioView[]> = {
  portrait: [],
  front: ['portrait'],
  left: ['portrait', 'front'],
  back: ['portrait', 'front'],
  right: ['portrait', 'front', 'left'],
};

/** Four is the working ceiling: past that a photo adds nothing an engine reads. */
export const MAX_PHOTOS = 4;

export type DraftLike = Pick<PresenterDraft, 'source' | 'name' | 'views' | 'activeView' | 'stage'> & {
  direction?: string;
  sources?: string[];
  analysis?: PresenterDraft['analysis'];
  readError?: string;
};

export type Phase = 'identity' | 'build' | 'review';

/** The first view not yet approved, in build order; null once all five are. */
export function currentView(d: DraftLike): StudioView | null {
  return VIEWS.find((v) => d.views[v].status !== 'approved') ?? null;
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
 * With an engine, every view has to be approved.
 */
export function readyToSave(d: DraftLike, canGenerate: boolean): boolean {
  if (allApproved(d)) return true;
  return !canGenerate && d.source === 'photos' && d.views.portrait.status === 'approved';
}

const pending = (d: DraftLike) => VIEWS.some((v) => d.views[v].status === 'candidate' || !!d.views[v].prior);

/** Identity until the face is used; review once everything stands; build in between. */
export function phaseOf(d: DraftLike, canGenerate: boolean): Phase {
  if (!identityLocked(d)) return 'identity';
  if (readyToSave(d, canGenerate) && !drawing(d) && !pending(d)) return 'review';
  return 'build';
}

/**
 * What the dialog draws next with no click: the first view not yet approved,
 * when it is empty or stale, has not just failed, and everything it is drawn
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
  return focus ?? (drawing(d) ? d.activeView : null) ?? currentView(d) ?? 'portrait';
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
}

/** The five views as the progress: what stands, what is being decided, what is still to come. */
export function stripItems(d: DraftLike, selected: StudioView): StripItem[] {
  return VIEWS.map((view) => {
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
    };
  });
}

export type Action = 'try-again' | 'use-person' | 'use' | 'keep-previous' | 'retry' | 'save';
export interface RailCopy {
  status: string;
  tone?: 'alert';
  actions: Action[];
}

/** What the rail says about the view on the stage, and the one or two things you can do about it. */
export function railCopy(d: DraftLike, view: StudioView, canGenerate: boolean): RailCopy {
  const slot = d.views[view];
  const label = cap(lower(view));
  if (phaseOf(d, canGenerate) === 'review') {
    if (!canGenerate && !allApproved(d)) {
      return { status: 'Saved from your photos: the face leads, the rest follow as they are.', actions: ['save'] };
    }
    return {
      status: d.name.trim()
        ? 'All five views are one person. Check them, then save.'
        : 'All five views are one person. Check them, then name them.',
      actions: ['save'],
    };
  }
  if (d.stage === 'analyzing') return { status: 'Reading the photos.', actions: [] };
  if (d.activeView === view) {
    if (slot.adjustment && slot.prior) {
      return {
        status:
          `Redrawing the ${lower(view)}: "${slot.adjustment}".` +
          (view === 'portrait' ? ' The other views follow once you use it.' : ''),
        actions: [],
      };
    }
    if (slot.adjustment)
      return { status: `Adjusting the face: "${slot.adjustment}". Everything else stays.`, actions: [] };
    if (view === 'portrait') return { status: 'Drawing their face from your description.', actions: [] };
    return {
      status: `Drawing the ${lower(view)} from ${d.source === 'photos' ? 'your photos and the approved face' : 'the approved face'}.`,
      actions: [],
    };
  }
  if (slot.error) {
    return {
      status: `The ${lower(view)} could not be drawn: ${slot.error}. Nothing approved was touched.`,
      tone: 'alert',
      actions: ['retry'],
    };
  }
  if (slot.status === 'candidate' && slot.prior) {
    return {
      status:
        `A revised ${lower(view)}. Use it, or keep the previous one.` +
        (view === 'portrait' ? ' Using it redraws the other views from this face.' : ''),
      actions: ['keep-previous', 'use'],
    };
  }
  if (slot.status === 'candidate' && view === 'portrait' && !identityLocked(d)) {
    return {
      status: 'Is this the person? Using them locks the face; the other views are built from it.',
      actions: ['try-again', 'use-person'],
    };
  }
  if (slot.status === 'candidate') {
    return { status: `${label}. Built from the approved face. Use it, or try again.`, actions: ['try-again', 'use'] };
  }
  if (slot.status === 'stale')
    return { status: `${label}. Built on a face that changed; it is drawn again next.`, actions: [] };
  if (slot.status === 'approved') {
    return {
      status: slot.origin === 'photo' ? `${label}. Your photo, kept as it is.` : `${label}, approved.`,
      actions: [],
    };
  }
  if (!canGenerate) return { status: `${label}. Needs an engine to draw.`, actions: [] };
  const missing = DEPENDS[view].find((dep) => d.views[dep].status !== 'approved');
  if (missing) return { status: `${label} comes after the ${lower(missing)}.`, actions: [] };
  return { status: `${label}. Drawn next.`, actions: [] };
}

/** The request the transcript shows as yours: the sentence, or the photos in a sentence. */
export function requestLine(d: DraftLike): string {
  if (d.source === 'synthetic') return d.direction?.trim() || 'Build a presenter.';
  const who = d.name.trim();
  return `Build a presenter${who ? ` named ${who}` : ''} from these photos.`;
}

/** Drawn work a discard would throw away. A placed photo is still on disk as itself. */
export function worthKeeping(d: DraftLike): boolean {
  return VIEWS.some((v) => {
    const s = d.views[v];
    return !!s.hash && s.origin !== 'photo' && s.status !== 'empty';
  });
}

/** A draft that is worth offering back when the dialog reopens. */
export function resumable(d: DraftLike): boolean {
  if (d.sources?.length) return true;
  if (d.direction?.trim()) return true;
  return worthKeeping(d);
}

/** What stops a save, first thing first: the sentence a disabled button carries. */
export function saveBlocker(d: DraftLike, name: string, canGenerate = true): string | null {
  if (drawing(d)) return 'Still drawing';
  const required: readonly StudioView[] = !canGenerate && d.source === 'photos' ? ['portrait'] : VIEWS;
  for (const v of required) {
    const s = d.views[v];
    if (s.prior) return `Decide on the ${lower(v)} first`;
    if (s.status === 'stale') return `Redo the ${lower(v)} first`;
    if (s.status !== 'approved') return `Use the ${lower(v)} first`;
  }
  if (!name.trim()) return 'Give them a name';
  return null;
}

/* ------------------------------------------------------------- refining */

/** Words that change who the person is, rather than how one picture was taken. */
const IDENTITY_WORDS =
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
 * the chip says which picture Refine will redraw (the Figma "Refining front
 * view"), and the line under the card says what that means. A sentence that
 * cannot go anywhere drops the chip and puts the reason on the line.
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

/** What Refine is asked for, so a placeholder can ask the right question. */
export function composerPlaceholder(selected: StudioView, d: DraftLike): string {
  if (!identityLocked(d)) return 'Adjust: shorter hair, older';
  const who = d.name.trim() || 'them';
  return selected === 'portrait' ? `What should change about ${who}?` : `Change this view: ${VIEW_NAME[selected]}`;
}

/* --------------------------------------------------------------- photos */

/** The line under the photo tiles before anything has been read. */
export function photosHint(count: number): string {
  if (count === 0) return 'The same person, face clear. Different angles help.';
  if (count === 1) return 'One photo works. Two to four, from different angles, hold the likeness better.';
  if (count < MAX_PHOTOS) return 'More angles hold the likeness better.';
  return 'Four angles. The reference set comes from these.';
}

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
  const photo = VIEWS.filter((v) => d.views[v].origin === 'photo');
  const drawn = VIEWS.filter((v) => d.views[v].origin !== 'photo');
  const list = (vs: StudioView[]) =>
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
