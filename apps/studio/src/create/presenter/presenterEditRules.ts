import type { Question, Turn } from '../../conversation/question.js';
import {
  CORE_VIEWS,
  type DraftLike,
  IDENTITY_WORDS,
  type StudioView,
  VIEW_NAME,
  drawing,
  viewsOf,
} from './presenterStudioRules.js';

/**
 * The editor's conversation, as rules.
 *
 * A saved presenter is opened as a session seeded from its record. There is
 * no onboarding: Scenri asks what should change, and a sentence is aimed by
 * a small table. A likeness complaint or a capture correction repairs the
 * view on the stage; a trait verb changes the person and redraws the face,
 * which is decided before the views built on it follow; wardrobe, products,
 * places and lighting belong to Create and are said so; a sentence that
 * reads both ways is asked once. Nothing here asks a model for words.
 */
export type EditIntent =
  | { scope: 'identity' | 'view'; view: StudioView }
  | { scope: 'out-of-scope' }
  | { scope: 'ambiguous' }
  | { blocked: string };

/** "here", "in this view": the sentence is about the picture on the stage. */
const DEIXIS = /\b(here|in this (view|one|picture|image|frame)|this (view|one|picture|image|frame))\b/i;
/** The picture does not hold the person: a repair, not a change. */
const LIKENESS =
  /\b(looks? like|doesn'?t look|does not look|not (her|him|them)|drift(s|ed|ing)?|wrong|\boff\b|different person|someone else|regenerate|redraw|again)\b/i;
/** A shot's art direction, which is not who the person is. */
const OUT_OF_SCOPE =
  /\b(dress|gown|outfit|wearing|wear|jacket|coat|suit|shirt|t-shirt|tee|hoodie|jeans|trousers|skirt|shoes|heels|sneakers|boots|hat|cap|sunglasses|jewell?ery|necklace|earrings|watch|holding|holds?|product|bottle|perfume|bag|handbag|phone|laptop|scene|beach|paris|london|tokyo|street|rooftop|office|kitchen|cafe|city|forest|desert|snow|rain|sunset|sunrise|golden hour|background|backdrop|lighting|campaign|shoot)\b/i;
/** A plainer capture is still a capture: allowed. */
const CLEANUP = /\b(simpler|plainer|plain|neutral|cleaner|tidier)\b/i;
const WARDROBE = /\b(outfit|clothes|clothing|top|wardrobe|wearing)\b/i;

/** What a sentence in the editor's composer is aimed at. */
export function editIntent(text: string, selected: StudioView, d: DraftLike): EditIntent {
  const t = text.trim();
  if (!t) return { blocked: 'Say what should change.' };
  if (OUT_OF_SCOPE.test(t) && !(CLEANUP.test(t) && WARDROBE.test(t))) return { scope: 'out-of-scope' };
  const trait = IDENTITY_WORDS.test(t);
  const likeness = LIKENESS.test(t);
  const deixis = DEIXIS.test(t);
  if (selected === 'portrait') return { scope: 'identity', view: 'portrait' };
  if (trait && likeness && !deixis) return { scope: 'ambiguous' };
  if (trait && !deixis) return { scope: 'identity', view: 'portrait' };
  const slot = d.views[selected];
  if (slot.origin === 'photo') return { blocked: 'Your photo stands as it is. Pick a drawn view to change.' };
  if (slot.status !== 'approved' && slot.status !== 'candidate')
    return { blocked: `Nothing drawn for the ${VIEW_NAME[selected]} yet.` };
  return { scope: 'view', view: selected };
}

export const OUT_OF_SCOPE_LINE = (name: string) =>
  `Use Create for wardrobe, products and scenes. Edits here change who ${name} is.`;

export interface EditComposerState {
  chip: { view: StudioView; label: string } | null;
  hint: string;
  tone?: 'alert';
}

/** The chip over the sentence and the line under the card, following the sentence as it is typed. */
export function editComposerState(text: string, selected: StudioView, d: DraftLike, name: string): EditComposerState {
  const typed = text.trim();
  const idle =
    selected === 'portrait'
      ? 'Describe a change to who they are.'
      : 'Say what is wrong with this view, or describe a change to who they are.';
  if (!typed) {
    const slot = d.views[selected];
    if (selected !== 'portrait' && slot.origin === 'photo') {
      return { chip: null, hint: 'Your photo stands as it is. Pick a drawn view to change.' };
    }
    return { chip: null, hint: idle };
  }
  const i = editIntent(typed, selected, d);
  if ('blocked' in i) return { chip: null, hint: i.blocked, tone: 'alert' };
  if (i.scope === 'out-of-scope') return { chip: null, hint: OUT_OF_SCOPE_LINE(name), tone: 'alert' };
  if (i.scope === 'ambiguous')
    return { chip: null, hint: 'This reads as the view or the person. Send it and I will ask which.' };
  if (i.scope === 'identity') {
    return {
      chip: { view: 'portrait', label: 'Changing the person' },
      hint: 'Changes the person. The other views are redrawn after you use it.',
    };
  }
  return {
    chip: { view: i.view, label: `Refining the ${VIEW_NAME[i.view]}` },
    hint: 'Changes this view only. Hair, skin, age or build change the person.',
  };
}

/** The record the session was seeded from, as much of it as dirtiness needs. */
export interface EditBase {
  shots: { file: string; angle?: string }[];
  identityEdits?: string[];
}

const hashOf = (file: string) => file.replace(/^asset:/, '');

/** Something in the session differs from the saved record: a save has work to do. */
export function isDirty(d: DraftLike, base: EditBase): boolean {
  const edits = d.identityEdits ?? [];
  if (edits.join('\n') !== (base.identityEdits ?? []).join('\n')) return true;
  const saved = new Map(base.shots.map((s) => [s.angle ?? '', hashOf(s.file)]));
  for (const v of viewsOf(d)) {
    const slot = d.views[v];
    if (slot.status === 'candidate' || slot.status === 'stale' || slot.prior) return true;
    const was = saved.get(v);
    if (slot.status === 'approved' && slot.hash && slot.hash !== was) return true;
    if (slot.status === 'empty' && was) return true;
  }
  return false;
}

/** The core views the record never had; a legacy presenter is offered them once. */
export const missingCore = (d: DraftLike): StudioView[] =>
  CORE_VIEWS.filter((v) => d.views[v].status === 'empty' && v !== 'portrait');

const list = (vs: readonly StudioView[]) =>
  vs.length <= 2
    ? vs.map((v) => VIEW_NAME[v]).join(' and ')
    : `${vs
        .slice(0, -1)
        .map((v) => VIEW_NAME[v])
        .join(', ')} and ${VIEW_NAME[vs[vs.length - 1]]}`;

export interface EditUi {
  /** "Build them" was chosen: the missing core views are drawn without a click. */
  building: boolean;
  buildDeclined: boolean;
  /** The last sentence that belonged to Create, shown once with the line that says so. */
  outOfScope: string | null;
  /** The last sentence that read both ways, waiting for its answer. */
  scopeAsk: string | null;
  /** A draw request that never reached the engine. */
  failed?: string | null;
  /** The save was refused because the record moved elsewhere. */
  conflict: string | null;
  /** Small talk: what was said, and what the composer is for, once. */
  aside?: { said: string; reply: string } | null;
}

export const EMPTY_EDIT_UI: EditUi = {
  building: false,
  buildDeclined: false,
  outOfScope: null,
  scopeAsk: null,
  failed: null,
  conflict: null,
};

export interface EditFlowArgs {
  draft: DraftLike | null;
  base: EditBase | null;
  name: string;
  selected: StudioView;
  canGenerate: boolean;
  ui: EditUi;
}

export const EDIT_ASIDE =
  'Say what should change: hair, age or build change the person; anything else changes the view on the stage.';

export const PROMPT_EDIT = {
  opening: (name: string) =>
    `What would you like to change about ${name}? Select a view to work on it, or describe a change to who they are.`,
  scope: 'Apply this to:',
  change: 'What should change?',
  saved: 'Save changes when you are done.',
};

/** The editor's transcript, whole, from state. */
export function turnsForEdit({ draft: d, base, name, selected, canGenerate, ui }: EditFlowArgs): Turn[] {
  const T: Turn[] = [{ kind: 'scenri', id: 'opening', text: PROMPT_EDIT.opening(name) }];
  const you = (id: string, text: string, asked?: string) => {
    if (asked) T.push({ kind: 'scenri', id: `asked-${id}`, text: asked });
    T.push({ kind: 'you', id, text, editable: false });
  };
  const say = (id: string, text: string, tone?: 'alert' | 'warn') => T.push({ kind: 'scenri', id, text, tone });
  const ask = (question: Question) => T.push({ kind: 'question', question });
  if (!d) return T;

  const missing = missingCore(d);
  if (missing.length && !ui.building && !ui.buildDeclined && !drawing(d) && canGenerate) {
    const have = viewsOf(d).filter((v) => d.views[v].status === 'approved').length;
    ask({
      id: 'legacy',
      kind: 'confirm',
      prompt: `${name} has ${have === 1 ? 'one reference' : `${have} references`}. Build the ${list(missing)} from it?`,
      options: [
        { id: 'build', label: 'Build them' },
        { id: 'not', label: 'Not now' },
      ],
    });
    return T;
  }

  if (ui.outOfScope) {
    you('out-of-scope', ui.outOfScope);
    say('out-of-scope-line', OUT_OF_SCOPE_LINE(name));
  }
  if (ui.aside) {
    you('aside-said', ui.aside.said);
    say('aside-reply', ui.aside.reply);
  }

  if (ui.scopeAsk) {
    you('scope-ask', ui.scopeAsk);
    ask({
      id: 'scope',
      kind: 'choice',
      prompt: PROMPT_EDIT.scope,
      options: [
        { id: 'view', label: `This view (the ${VIEW_NAME[selected]})` },
        { id: 'identity', label: 'The presenter' },
      ],
    });
    return T;
  }

  const views = viewsOf(d);
  const active = d.activeView as StudioView | null;
  const candidate = views.find((v) => d.views[v].status === 'candidate');
  const failedView = views.find((v) => !!d.views[v].error);

  // The changes to the person accepted in this session stay in the record.
  const before = base?.identityEdits ?? [];
  const edits = (d.identityEdits ?? []).filter((e) => !before.includes(e));
  edits.forEach((e, i) => {
    you(`edit-${i}`, e, PROMPT_EDIT.change);
    say(`changed-${i}`, `Changed ${name}. The views built on the face were redrawn.`);
  });

  for (const v of views) {
    const slot = d.views[v];
    if (slot.status === 'approved' && slot.prior && slot.adjustment && v !== 'portrait') {
      you(`adjust-${v}`, slot.adjustment, PROMPT_EDIT.change);
      say(`redrew-${v}`, `Redrew the ${VIEW_NAME[v]}.`);
    }
  }

  if (active) {
    const slot = d.views[active];
    say(
      `drawing-${active}`,
      slot.adjustment
        ? active === 'portrait'
          ? `Changing ${name}: "${slot.adjustment}". Everything else stays.`
          : `Redrawing the ${VIEW_NAME[active]}: "${slot.adjustment}".`
        : slot.status === 'stale' || views.some((v) => d.views[v].status === 'stale')
          ? `Redrawing the views built on the face. The ${VIEW_NAME[active]} first.`
          : `Drawing the ${VIEW_NAME[active]}.`,
    );
    return T;
  }

  if (candidate) {
    const slot = d.views[candidate];
    if (slot.adjustment) you('adjust', slot.adjustment, PROMPT_EDIT.change);
    ask({
      id: candidate === 'portrait' ? 'revision' : 'view-revision',
      kind: 'confirm',
      prompt:
        candidate === 'portrait'
          ? `Here is ${name} with the change. Use this, or keep the previous one. Using it redraws the views built on the face.`
          : `Redrew the ${VIEW_NAME[candidate]}. Use it, or keep the previous one.`,
      options: [
        { id: 'use', label: candidate === 'portrait' ? 'Use this' : 'Use it' },
        { id: 'keep', label: 'Keep previous' },
        { id: 'again', label: 'Try again' },
      ],
    });
    return T;
  }

  if (ui.failed || failedView) {
    ask({
      id: 'retry',
      kind: 'confirm',
      tone: 'alert',
      prompt: failedView
        ? `The ${VIEW_NAME[failedView]} could not be drawn: ${d.views[failedView].error}. Nothing finished was touched.`
        : `That did not go through: ${ui.failed}. Nothing finished was touched.`,
      options: [{ id: 'retry', label: 'Retry' }],
    });
    return T;
  }

  if (ui.conflict) {
    ask({
      id: 'conflict',
      kind: 'confirm',
      tone: 'alert',
      prompt: `${name} changed in another tab. Reload to continue.`,
      options: [{ id: 'reload', label: 'Reload' }],
    });
    return T;
  }

  if (base && isDirty(d, base)) {
    ask({
      id: 'save',
      kind: 'confirm',
      prompt: `The set is coherent. ${PROMPT_EDIT.saved}`,
      options: [{ id: 'save', label: 'Save changes' }],
    });
  }
  return T;
}
