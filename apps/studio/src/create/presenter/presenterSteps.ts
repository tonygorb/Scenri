import type { PresenterDraft } from '../../api.js';
import type { Aside } from '../../conversation/question.js';
import type { CreationState } from './creationState.js';
import { readyToDraw } from './creationState.js';
import { compileDirection, compileItems, type KeptItem, seedStateFromDraft } from './presenterFlowRules.js';
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
  | { kind: 'seed'; answers: Answers; asides: Aside[] }
  /** Nothing is left to ask of a described person: the draft is made. */
  | { kind: 'start' }
  /** The answers moved under a draft: it is told, and what was drawn from the old words is redrawn. */
  | { kind: 'sync'; patch: SyncPatch; redo: StudioView | null }
  /** The next view is drawn, deciding itself unless a person decides it. */
  | { kind: 'draw'; view: StudioView; decide: 'auto' | undefined };

export interface SyncPatch {
  direction?: string;
  keepItems: KeptItem[];
}

/** The draft as the hook holds it: the rules' view of it, plus what a step is keyed by. */
export type StepDraft = DraftLike & Pick<PresenterDraft, 'id' | 'generations' | 'keepItems'>;

export interface StepInputs {
  /**
   * Every step this page has already done, by key.
   *
   * A step whose key is in here is not done again. It is what stops the flow
   * asking for something it cannot get: the server is the authority on what it
   * can store, and it truncates long text and drops pictures it does not hold,
   * so what it keeps can differ from what was asked for and no amount of asking
   * will close the gap. Asked once, then the flow goes on to what it can still
   * do, which is draw.
   *
   * All of them, not the last one: with only the last, a sync that would not
   * take and a draw would take turns being "not the last thing" forever, which
   * is the same loop wearing a different hat.
   */
  done: ReadonlySet<string>;
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
    sameItems(d.keepItems, compileItems(state.answers))
  );
}

/**
 * Whether the draft is holding these items.
 *
 * The words have to match exactly, and both sides cap them the same way so
 * that is a question with an answer. The pictures only have to be a subset:
 * the store is the authority on which hashes it holds, and it drops the ones
 * it does not. Asking for a picture the server will not keep, forever, is how
 * a draft used to sit in step with nothing.
 */
function sameItems(held: readonly KeptItem[] | undefined, want: readonly KeptItem[]): boolean {
  const has = held ?? [];
  if (has.length !== want.length) return false;
  return want.every((w, i) => {
    const h = has[i];
    if (!h || h.id !== w.id || h.words !== w.words) return false;
    return (h.refs ?? []).every((r) => (w.refs ?? []).includes(r));
  });
}

/** What a sync tells the draft. */
export function syncPatch(state: CreationState, d: DraftLike): SyncPatch {
  return {
    ...(d.source === 'synthetic' ? { direction: compileDirection(state.answers) } : {}),
    keepItems: compileItems(state.answers),
  };
}

/** What a picture was drawn from is what a redraw is worth: an empty view is simply drawn when its turn comes. */
export const redoAfterSync = (d: DraftLike): StudioView | null =>
  d.source === 'photos' ? (d.views.front.hash ? 'front' : null) : d.views.portrait.hash ? 'portrait' : null;

/** Everything the flow could do right now, best first. */
function candidates(i: StepInputs): Step[] {
  const { state, draft: d, ctx } = i;
  if (i.busy || i.err) return [];
  if (d) {
    const ready = readyToDraw(state, ctx);
    // A page arriving at a draft with answers that cannot draw it reads them
    // off the draft: another tab, a cleared session, answers left over from a
    // run that is over. Once per draft, so a person halfway through changing
    // their mind on a draft this page has been driving is left alone.
    if (i.seededFor !== d.id && (!state.answers.source || !ready)) return [{ kind: 'seed', ...seedStateFromDraft(d) }];
    // a question is open, or an answer is being changed: nothing draws
    if (!ready) return [];
    const out: Step[] = [];
    if (!inStep(state, d)) out.push({ kind: 'sync', patch: syncPatch(state, d), redo: redoAfterSync(d) });
    const view = i.canDraw ? nextToDraw(d) : null;
    if (view) out.push({ kind: 'draw', view, decide: autoFor(view) });
    return out;
  }
  // a draft is on its way, or the page is still finding out
  if (i.booting || i.draftId) return [];
  if (!i.canDraw || !readyToDraw(state, ctx)) return [];
  // A person described in words starts drawing the moment nothing is left to
  // ask. The rows end at a read-back and a tap, and the photographs at a
  // Continue: those two begin from the press, never from here.
  const src = state.answers.source;
  return src?.door === 'scratch' && src.via !== 'taps' ? [{ kind: 'start' }] : [];
}

/**
 * The one thing to do next, or nothing.
 *
 * The first thing the flow can do that it has not just done. Telling the draft
 * what the answers say comes before drawing it, but it never holds the drawing
 * up: a sync that did not take is asked for once and then stepped over, because
 * a picture drawn from what the draft actually holds is worth more than a
 * conversation that will not go on until a word lands that never will.
 */
export function nextStep(i: StepInputs): Step | null {
  for (const step of candidates(i)) {
    if (!i.done.has(stepKey(step, i))) return step;
  }
  return null;
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
