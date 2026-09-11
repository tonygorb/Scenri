import type { PresenterDraft } from '../../api.js';
import type { CreationState } from './creationState.js';
import { readyToDraw } from './creationState.js';
import { compileDirection, compileKeep, compileRefs, seedFromDraft } from './presenterFlowRules.js';
import type { Answers, FlowContext } from './presenterQuestions.js';
import { type DraftLike, type StudioView, autoFor, nextToDraw } from './presenterStudioRules.js';

/**
 * What the flow does next, on its own, given everything it knows.
 *
 * Four things happen in this conversation without anybody pressing anything:
 * the answers are read off a draft a page arrived at, a draft is made from a
 * description the moment nothing is left to ask, the draft is brought in step
 * with answers that changed, and the next view is drawn. Each used to be its
 * own effect, guarded by its own list of conditions and its own latch saying
 * whether it had already happened. Four lists over the same facts, and every
 * stall and every double-fire in this area was two of them disagreeing: a
 * draft with a direction on it and nothing drawing, nothing said, because one
 * latch was set and another was not.
 *
 * There is one decision now, and it is a pure function of the state, so it can
 * be tested in a table and walked at random. The hook that calls it does the
 * one thing it says, keyed by what it is for, and nothing else.
 */
export type Step =
  /** A page arrived at a draft with answers that cannot draw it: they are read off the draft. */
  | { kind: 'seed'; answers: Answers }
  /** Nothing is left to ask of a described person: the draft is made. */
  | { kind: 'start' }
  /** The answers moved under a draft: it is told, and what was drawn from the old words is redrawn. */
  | { kind: 'sync'; patch: SyncPatch; redo: StudioView | null }
  /** The next view is drawn, deciding itself unless a person decides it. */
  | { kind: 'draw'; view: StudioView; decide: 'auto' | undefined };

export interface SyncPatch {
  direction?: string;
  keep: string;
  detailRefs: Record<string, string[]>;
}

/** The draft as the hook holds it: the rules' view of it, plus what a step is keyed by. */
export type StepDraft = DraftLike & Pick<PresenterDraft, 'id' | 'generations' | 'detailRefs'>;

export interface StepInputs {
  state: CreationState;
  draft: StepDraft | null;
  ctx: FlowContext;
  /** An engine that can draw a person is set up. */
  canDraw: boolean;
  /** Work is in flight, here or on the server, or the page is being left: nothing else begins. */
  busy: boolean;
  /** An error is standing that a person has to answer before anything goes on. */
  err: boolean;
  /** The page is still finding out whether a draft is pointed at. */
  booting: boolean;
  /** A draft is in the route, whether or not it has loaded yet. */
  draftId: string | null;
  /** The draft whose answers this page has already read, if any. */
  seededFor: string | null;
}

/** Whether the draft holds what the answers say. */
export function inStep(state: CreationState, d: StepDraft): boolean {
  return (
    (d.source !== 'synthetic' || (d.direction ?? '') === compileDirection(state.answers)) &&
    (d.keep ?? '') === compileKeep(state.answers) &&
    sameRefs(d.detailRefs, compileRefs(state.answers))
  );
}

/** What a sync tells the draft. */
export function syncPatch(state: CreationState, d: DraftLike): SyncPatch {
  return {
    ...(d.source === 'synthetic' ? { direction: compileDirection(state.answers) } : {}),
    keep: compileKeep(state.answers),
    detailRefs: compileRefs(state.answers),
  };
}

/** What a picture was drawn from is what a redraw is worth: an empty view is simply drawn when its turn comes. */
export const redoAfterSync = (d: DraftLike): StudioView | null =>
  d.source === 'photos' ? (d.views.front.hash ? 'front' : null) : d.views.portrait.hash ? 'portrait' : null;

export function nextStep(i: StepInputs): Step | null {
  const { state, draft: d, ctx } = i;
  if (i.busy || i.err) return null;
  if (d) {
    const ready = readyToDraw(state, ctx);
    // A page arriving at a draft with answers that cannot draw it reads them
    // off the draft: another tab, a cleared session, answers left over from a
    // run that is over. Once per draft, so a person halfway through changing
    // their mind on a draft this page has been driving is left alone.
    if (i.seededFor !== d.id && (!state.answers.source || !ready)) return { kind: 'seed', answers: seedFromDraft(d) };
    // a question is open, or an answer is being changed: nothing draws
    if (!ready) return null;
    if (!inStep(state, d)) return { kind: 'sync', patch: syncPatch(state, d), redo: redoAfterSync(d) };
    if (!i.canDraw) return null;
    const view = nextToDraw(d);
    return view ? { kind: 'draw', view, decide: autoFor(view) } : null;
  }
  // a draft is on its way, or the page is still finding out
  if (i.booting || i.draftId) return null;
  if (!i.canDraw || !readyToDraw(state, ctx)) return null;
  // A person described in words starts drawing the moment nothing is left to
  // ask. The rows end at a read-back and a tap, and the photographs at a
  // Continue: those two begin from the press, never from here.
  const src = state.answers.source;
  return src?.door === 'scratch' && src.via !== 'taps' ? { kind: 'start' } : null;
}

/**
 * What a step is for, as a string. Two renders that produce the same key are
 * asking for the same thing, and it is done once: this is the one latch, in
 * place of one per step. It changes exactly when the step should be attempted
 * again, which for a draw is when the view, its attempts or its status move.
 */
export function stepKey(step: Step, i: StepInputs): string {
  const d = i.draft;
  switch (step.kind) {
    case 'seed':
      return `seed:${d?.id}`;
    case 'start':
      return `start:${i.state.revision}`;
    case 'sync':
      return `sync:${d?.id}:${JSON.stringify(step.patch)}:${step.redo ?? ''}`;
    case 'draw': {
      const slot = d?.views[step.view];
      return `draw:${d?.id}:${step.view}:${slot?.attempts ?? 0}:${d?.generations ?? 0}:${slot?.status ?? ''}`;
    }
  }
}

const sameRefs = (x: Record<string, string[]> | undefined, y: Record<string, string[]>) =>
  JSON.stringify(x ?? {}) === JSON.stringify(y);
