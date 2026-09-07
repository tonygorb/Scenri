/**
 * The presenter studio's rules, pure: which view is on, what gets drawn
 * without a click, what the stage says, when leaving deserves a word, what
 * blocks a save. The components read these; nothing here reads a component.
 */
export type StudioView = 'portrait' | 'front' | 'three-quarter';
export const STUDIO_VIEWS: readonly StudioView[] = ['portrait', 'front', 'three-quarter'];

export type SlotStatus = 'empty' | 'generating' | 'candidate' | 'approved' | 'stale';
export interface Slot {
  status: SlotStatus;
  hash?: string;
  origin?: 'generated' | 'photo';
  attempts: number;
  rejected: string[];
  adjustment?: string;
  conditionedOn?: string[];
  error?: string;
}
export interface DraftLike {
  source: 'synthetic' | 'photos';
  name: string;
  views: Record<StudioView, Slot>;
  activeView: StudioView | null;
  stage: 'idle' | 'analyzing' | 'drawing';
}

/** How a view is named where a person reads it. */
export const VIEW_LABEL: Record<StudioView, string> = {
  portrait: 'Portrait',
  front: 'Full body',
  'three-quarter': 'Three-quarter',
};

/** Which approved views a view is drawn from. Mirrors the server's plan. */
const DEPENDS: Record<StudioView, StudioView[]> = {
  portrait: [],
  front: ['portrait'],
  'three-quarter': ['portrait', 'front'],
};

/** The first view not yet approved, in build order; null once all three are, which is the review. */
export function currentView(d: DraftLike): StudioView | null {
  return STUDIO_VIEWS.find((v) => d.views[v].status !== 'approved') ?? null;
}

export function allApproved(d: DraftLike): boolean {
  return currentView(d) === null;
}

/** The portrait is approved: from here on every view is drawn from that face. */
export function identityLocked(d: DraftLike): boolean {
  return d.views.portrait.status === 'approved';
}

/**
 * What the studio draws next with no click: an empty view whose dependencies
 * are approved, on an idle draft, that has not just failed. A candidate waits
 * for a decision, a failure waits for Retry, a stale view waits for Draw again.
 */
export function nextToDraw(d: DraftLike): StudioView | null {
  if (d.stage !== 'idle' || d.activeView) return null;
  const view = currentView(d);
  if (!view) return null;
  const slot = d.views[view];
  if (slot.status !== 'empty' || slot.error) return null;
  return DEPENDS[view].every((dep) => d.views[dep].status === 'approved') ? view : null;
}

export type StripState = 'approved' | 'current' | 'todo' | 'stale';
export interface StripItem {
  view: StudioView;
  label: string;
  state: StripState;
  hash: string | undefined;
  photo: boolean;
}

/** The three views as the progress: what is done, what is being decided, what is still to come. */
export function stripItems(d: DraftLike, focus: StudioView | null): StripItem[] {
  const current = focus ?? currentView(d);
  return STUDIO_VIEWS.map((view) => {
    const slot = d.views[view];
    const state: StripState =
      view === current
        ? 'current'
        : slot.status === 'approved'
          ? 'approved'
          : slot.status === 'stale'
            ? 'stale'
            : 'todo';
    return { view, label: VIEW_LABEL[view], state, hash: slot.hash, photo: slot.origin === 'photo' };
  });
}

/** The title and the one line under it, for a view in its state. */
export function stageCopy(
  view: StudioView,
  slot: Slot,
  source: DraftLike['source'],
  stage: DraftLike['stage'],
): { title: string; hint: string } {
  const label = VIEW_LABEL[view];
  if (slot.status === 'generating' || stage !== 'idle') {
    if (stage === 'analyzing')
      return { title: 'Reading the photos', hint: 'A moment: this is what every view is built from.' };
    return {
      title: `Drawing the ${label.toLowerCase()}`,
      hint: 'One picture. You decide before anything is built on it.',
    };
  }
  if (slot.error) {
    return { title: label, hint: `This view could not be drawn: ${slot.error}. Nothing approved was touched.` };
  }
  if (slot.status === 'stale') {
    return { title: label, hint: 'Built on a view you changed. Draw it again so the set stays one person.' };
  }
  if (slot.status === 'candidate') {
    if (view === 'portrait' && source === 'synthetic') {
      return { title: 'This is the person', hint: 'Approve them to build the rest on this face, or try another.' };
    }
    return { title: label, hint: 'Approve it to continue, try again, or adjust one thing.' };
  }
  if (slot.status === 'approved') {
    return slot.origin === 'photo'
      ? { title: label, hint: 'Your photo, kept as it is. It is the truth every other view answers to.' }
      : { title: label, hint: 'Approved. Redo it only if you want the views built on it drawn again.' };
  }
  return { title: label, hint: 'Ready to draw.' };
}

/** Something was drawn or approved that a discard would throw away. A placed photo is still on disk as itself. */
export function worthKeeping(d: DraftLike): boolean {
  return STUDIO_VIEWS.some((v) => {
    const s = d.views[v];
    return (
      !!s.hash && s.origin !== 'photo' && (s.status === 'candidate' || s.status === 'approved' || s.status === 'stale')
    );
  });
}

/** What stops a save, first thing first: the sentence a disabled button carries. */
export function saveBlocker(d: DraftLike, name: string): string | null {
  if (d.stage !== 'idle' || d.activeView) return 'Still drawing';
  for (const v of STUDIO_VIEWS) {
    const s = d.views[v];
    if (s.status === 'stale') return `Redo the ${VIEW_LABEL[v].toLowerCase()} first`;
    if (s.status !== 'approved') return `Approve the ${VIEW_LABEL[v].toLowerCase()} first`;
  }
  if (!name.trim()) return 'Give them a name';
  return null;
}
