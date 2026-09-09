import { describe, expect, it } from 'vitest';
import type { PresenterDraftSlot } from '../src/api.js';
import { activeQuestion } from '../src/create/presenter/presenterFlowRules.js';
import {
  EMPTY_SETUP,
  type Setup,
  composerFor,
  descriptionGaps,
  directionFrom,
  editEffect,
  needsFollowUp,
  sourceFromText,
  turnsFor,
} from '../src/create/presenter/presenterFlowRules.js';
import { type DraftLike, VIEWS, emptySlot } from '../src/create/presenter/presenterStudioRules.js';

const slot = (p: Partial<PresenterDraftSlot>): PresenterDraftSlot => ({ ...emptySlot(), ...p });
const views = (over: Partial<Record<(typeof VIEWS)[number], PresenterDraftSlot>> = {}) =>
  Object.fromEntries(VIEWS.map((v) => [v, over[v] ?? emptySlot()])) as DraftLike['views'];
const draft = (over: Partial<DraftLike> = {}): DraftLike => ({
  source: 'synthetic',
  name: '',
  views: views(),
  activeView: null,
  stage: 'idle',
  extras: false,
  ...over,
});
const ui = { collapsed: false, extrasDeclined: false, reasking: null };
const setup = (over: Partial<Setup> = {}): Setup => ({ ...EMPTY_SETUP, ...over });
const ids = (setupIn: Setup, d: DraftLike | null, canGenerate = true, uiIn = ui) =>
  turnsFor({ setup: setupIn, draft: d, canGenerate, ui: uiIn }).map((t) =>
    t.kind === 'question' ? `q:${t.question.id}` : `${t.kind}:${t.id}`,
  );

describe('a description and what it leaves out', () => {
  it('a full sentence leaves nothing to ask', () => {
    expect(descriptionGaps('Late 30s woman, Mediterranean, dark shoulder-length hair, slim build, elegant')).toEqual(
      [],
    );
    expect(needsFollowUp('a man in his fifties with grey hair and a broad build')).toBe(false);
  });
  it('a short sentence with no who and no age asks once, with build', () => {
    expect(descriptionGaps('black curly hair')).toEqual(['who', 'age', 'build']);
  });
  it('a sentence that says who but not the age asks the age alone', () => {
    expect(descriptionGaps('a woman with black curly hair, freckles and a calm, warm presence, slender')).toEqual([
      'age',
    ]);
  });
  it('the picks fold into the sentence the engine is given, and never repeat what it says', () => {
    const s = setup({ description: 'black curly hair', gaps: { who: 'man', age: '20s', build: 'athletic' } });
    expect(directionFrom(s)).toBe('a man in his 20s, black curly hair, athletic build');
    const said = setup({ description: 'a young man with black curly hair', gaps: { who: 'man', age: '20s' } });
    expect(directionFrom(said)).toBe('a young man with black curly hair');
    expect(directionFrom(setup({ description: 'silver hair', gaps: 'skipped' }))).toBe('silver hair');
  });
});

describe('a typed sentence at the first question', () => {
  it('picks a door when it names one, and is the description otherwise', () => {
    expect(sourceFromText('I have photos')).toBe('photos');
    expect(sourceFromText('describe someone')).toBe('scratch');
    expect(sourceFromText('Late 30s, dark hair, slim')).toBeNull();
  });
});

describe('the transcript is a function of state', () => {
  it('opens with the intent and one question', () => {
    expect(ids(setup(), null)).toEqual(['you:intent', 'q:source']);
  });
  it('from scratch: source, then describe, with starters', () => {
    const t = turnsFor({ setup: setup({ source: 'scratch' }), draft: null, canGenerate: true, ui });
    expect(activeQuestion(t)?.id).toBe('describe');
    expect(activeQuestion(t)?.kind === 'text' && activeQuestion(t)?.starters?.length).toBe(3);
  });
  it('from scratch with no engine: the setup line, nothing drawn', () => {
    expect(ids(setup({ source: 'scratch' }), null, false)).toEqual([
      'you:intent',
      'scenri:asked-source',
      'you:source',
      'q:noengine',
    ]);
  });
  it('a thin description asks the follow-up once, then never again', () => {
    const asked = setup({ source: 'scratch', description: 'black curly hair', gapsAsked: true });
    expect(ids(asked, null)).toEqual([
      'you:intent',
      'scenri:asked-source',
      'you:source',
      'scenri:asked-describe',
      'you:describe',
      'q:gaps',
    ]);
    const answered = { ...asked, gaps: 'skipped' as const };
    expect(ids(answered, null).at(-1)).toBe('you:gaps');
  });
  it('from photos: the photo block until a draft exists, then the photos as an answer', () => {
    expect(ids(setup({ source: 'photos' }), null).at(-1)).toBe('q:photos');
    const d = draft({ source: 'photos', sources: ['a', 'b'], stage: 'analyzing' });
    expect(ids(setup({ source: 'photos' }), d)).toEqual([
      'you:intent',
      'scenri:asked-source',
      'you:source',
      'scenri:asked-photos',
      'you:photos',
      'scenri:reading',
      'q:name',
    ]);
  });
  it('the name is asked while the face draws and answered in place', () => {
    const drawing = draft({
      direction: 'x',
      views: views({ portrait: slot({ status: 'generating' }) }),
      activeView: 'portrait',
    });
    const s = setup({ source: 'scratch', description: 'x' });
    expect(ids(s, drawing).at(-1)).toBe('q:name');
    const named = { ...drawing, name: 'Maren' };
    expect(ids(s, named)).not.toContain('q:name');
  });
  it('the face candidate is the one decision before the set', () => {
    const d = draft({ name: 'Maren', views: views({ portrait: slot({ status: 'candidate', hash: 'p' }) }) });
    const t = turnsFor({ setup: setup({ source: 'scratch', description: 'x' }), draft: d, canGenerate: true, ui });
    expect(activeQuestion(t)?.id).toBe('identity');
    expect(activeQuestion(t)?.prompt).toContain('Maren');
  });
  it('the set builds without a question, then offers the extras once, then the save', () => {
    const building = draft({
      name: 'Maren',
      views: views({ portrait: slot({ status: 'approved', hash: 'p' }), front: slot({ status: 'generating' }) }),
      activeView: 'front',
    });
    const s = setup({ source: 'scratch', description: 'x' });
    expect(ids(s, building).at(-1)).toBe('scenri:drawing-front');
    const done = draft({
      name: 'Maren',
      views: views({
        portrait: slot({ status: 'approved', hash: 'p' }),
        front: slot({ status: 'approved', hash: 'f' }),
        'three-quarter': slot({ status: 'approved', hash: 't' }),
      }),
    });
    expect(ids(s, done).slice(-2)).toEqual(['scenri:set-ready', 'q:extras']);
    expect(ids(s, done, true, { ...ui, extrasDeclined: true }).at(-1)).toBe('q:save');
    const unnamed = { ...done, name: '' };
    expect(ids(s, unnamed, true, { ...ui, extrasDeclined: true }).at(-1)).toBe('q:name');
  });
  it('a failed view asks for a retry and touches nothing else', () => {
    const d = draft({
      name: 'Maren',
      views: views({
        portrait: slot({ status: 'approved', hash: 'p' }),
        front: slot({ status: 'empty', error: 'the engine timed out' }),
      }),
    });
    const t = turnsFor({ setup: setup({ source: 'scratch', description: 'x' }), draft: d, canGenerate: true, ui });
    const q = activeQuestion(t);
    expect(q?.id).toBe('retry');
    expect(q?.tone).toBe('alert');
    expect(q?.prompt).toContain('full body');
  });
  it('a revised view returns the one decision, and a revised face says the set follows', () => {
    const d = draft({
      name: 'Maren',
      views: views({
        portrait: slot({ status: 'candidate', hash: 'p2', prior: 'p' }),
        front: slot({ status: 'approved', hash: 'f' }),
      }),
    });
    const t = turnsFor({ setup: setup({ source: 'scratch', description: 'x' }), draft: d, canGenerate: true, ui });
    expect(activeQuestion(t)?.id).toBe('revision');
    expect(activeQuestion(t)?.prompt).toContain('redraws the views');
  });
  it('folds the setup once the face is used', () => {
    const d = draft({ name: 'Maren', views: views({ portrait: slot({ status: 'approved', hash: 'p' }) }) });
    const folded = ids(setup({ source: 'scratch', description: 'x' }), d, true, { ...ui, collapsed: true });
    expect(folded).toContain('summary:setup');
    expect(folded).not.toContain('you:describe');
  });
  it('photos with no engine end in the honest save', () => {
    const d = draft({
      source: 'photos',
      name: 'Maren',
      sources: ['a'],
      views: views({ portrait: slot({ status: 'approved', hash: 'a', origin: 'photo' }) }),
    });
    expect(ids(setup({ source: 'photos' }), d, false).at(-1)).toBe('q:blind');
  });
});

describe('changing an earlier answer', () => {
  it('costs what it depends on', () => {
    expect(editEffect('name', true)).toBe('metadata');
    expect(editEffect('describe', false)).toBe('plain');
    expect(editEffect('describe', true)).toBe('redraw-identity');
    expect(editEffect('gaps', true)).toBe('redraw-identity');
    expect(editEffect('source', true)).toBe('start-over');
    expect(editEffect('photos', true)).toBe('start-over');
  });
});

describe('the composer follows the question', () => {
  it('is the answer for text questions and hidden for blocks', () => {
    const t = turnsFor({ setup: setup(), draft: null, canGenerate: true, ui });
    expect(composerFor(activeQuestion(t), null, 'portrait')?.placeholder).toBe('Describe them, or choose above');
    const photos = turnsFor({ setup: setup({ source: 'photos' }), draft: null, canGenerate: true, ui });
    expect(composerFor(activeQuestion(photos), null, 'portrait').off).toBe('Add their photos above.');
  });
  it('turns into the refinement field once the face is used', () => {
    const d = draft({
      name: 'Maren',
      views: views({
        portrait: slot({ status: 'approved', hash: 'p' }),
        front: slot({ status: 'approved', hash: 'f' }),
        'three-quarter': slot({ status: 'approved', hash: 't' }),
      }),
    });
    const t = turnsFor({ setup: setup({ source: 'scratch', description: 'x' }), draft: d, canGenerate: true, ui });
    expect(composerFor(activeQuestion(t), d, 'portrait')?.placeholder).toBe('What should change about Maren?');
    expect(composerFor(activeQuestion(t), d, 'front')?.action).toBe('Refine');
  });
});

describe('a draft opened at its address', () => {
  it("carries its own answers: no door is asked again, and the sentence is the draft's", () => {
    const d = draft({
      name: 'Idan',
      direction: 'a man in his 30s',
      views: views({ portrait: slot({ status: 'candidate', hash: 'p' }) }),
    });
    const t = turnsFor({ setup: setup(), draft: d, canGenerate: true, ui });
    const list = t.map((x) => (x.kind === 'question' ? `q:${x.question.id}` : `${x.kind}:${x.id}`));
    expect(list).not.toContain('q:source');
    expect(list).toContain('you:describe');
    expect(t.find((x) => x.kind === 'you' && x.id === 'describe')).toMatchObject({ text: 'a man in his 30s' });
    expect(activeQuestion(t)?.id).toBe('identity');
    const photos = draft({ source: 'photos', sources: ['a'], stage: 'analyzing' });
    const p = turnsFor({ setup: setup(), draft: photos, canGenerate: true, ui });
    expect(p.map((x) => (x.kind === 'question' ? `q:${x.question.id}` : `${x.kind}:${x.id}`))).toContain('you:photos');
  });
});

describe('small talk at a question', () => {
  it('is answered with the question again, and the question stays open', () => {
    const t = turnsFor({
      setup: setup(),
      draft: null,
      canGenerate: true,
      ui: { ...ui, aside: { said: 'hello', reply: 'Hi. Describe them in a sentence, or pick one above.' } },
    });
    const list = t.map((x) => (x.kind === 'question' ? `q:${x.question.id}` : `${x.kind}:${x.id}`));
    expect(list).toEqual(['you:intent', 'q:source', 'you:aside-said', 'scenri:aside-reply']);
    expect(activeQuestion(t)?.id).toBe('source');
  });
});

describe('what was sent stays as it was sent', () => {
  const at = (n: number) => `2026-09-09T10:0${n}:00.000Z`;
  const scratch = setup({ source: 'scratch', description: 'a woman in her 30s, dark hair, slim' });
  it('the name answered during the first draw stays under the line that says it draws', () => {
    const d = draft({
      name: 'Maren',
      views: views({ portrait: slot({ status: 'generating' }) }),
      activeView: 'portrait',
      stage: 'drawing',
    });
    expect(ids(scratch, d).slice(-3)).toEqual(['scenri:drawing-face', 'scenri:asked-name', 'you:name']);
    const unnamed = draft({ ...d, name: '' });
    expect(ids(scratch, unnamed).slice(-2)).toEqual(['scenri:drawing-face', 'q:name']);
  });
  it('every adjustment is an exchange of its own; the open one sits under the line that says it draws, and none is rewritten by the next', () => {
    const asks = [
      { view: 'portrait' as const, text: 'shorter hair', at: at(1) },
      { view: 'portrait' as const, text: 'add glasses', at: at(2) },
    ];
    const drawing = draft({
      name: 'Maren',
      asks,
      views: views({ portrait: slot({ status: 'generating', hash: 'p1', adjustment: 'add glasses' }) }),
      activeView: 'portrait',
      stage: 'drawing',
    });
    const t = turnsFor({ setup: scratch, draft: drawing, canGenerate: true, ui });
    expect(ids(scratch, drawing).slice(-8)).toEqual([
      'scenri:asked-name',
      'you:name',
      `scenri:asked-ask-${at(1)}`,
      `you:ask-${at(1)}`,
      `scenri:redrew-${at(1)}`,
      `scenri:asked-ask-${at(2)}`,
      `you:ask-${at(2)}`,
      'scenri:drawing-face',
    ]);
    expect(t.at(-1)).toMatchObject({ kind: 'scenri', text: 'Adjusting the face. Everything else stays.' });
    expect(t.find((x) => x.kind === 'you' && x.id === `ask-${at(1)}`)).toMatchObject({
      text: 'shorter hair',
      editable: false,
    });
    const landed = draft({
      ...drawing,
      views: views({ portrait: slot({ status: 'candidate', hash: 'p2', adjustment: 'add glasses' }) }),
      activeView: null,
      stage: 'idle',
    });
    expect(ids(scratch, landed).slice(-3)).toEqual([`scenri:asked-ask-${at(2)}`, `you:ask-${at(2)}`, 'q:identity']);
  });
  it('a view that redrew itself keeps its ask closed, and the composer is off while any view draws', () => {
    const set = draft({
      name: 'Maren',
      asks: [{ view: 'front', text: 'arms relaxed', at: at(3) }],
      views: views({
        portrait: slot({ status: 'approved', hash: 'p' }),
        front: slot({ status: 'approved', hash: 'f2', prior: 'f', adjustment: 'arms relaxed' }),
        'three-quarter': slot({ status: 'approved', hash: 't' }),
      }),
    });
    const t = ids(scratch, set);
    expect(t).toContain(`you:ask-${at(3)}`);
    expect(t).toContain(`scenri:redrew-${at(3)}`);
    expect(composerFor(null, set, 'front').off).toBeUndefined();
    const busy = draft({ ...set, activeView: 'three-quarter', stage: 'drawing' });
    expect(composerFor(null, busy, 'front').off).toBe('The three-quarter view is still drawing.');
    expect(ids(scratch, busy).at(-1)).toBe('scenri:drawing-three-quarter');
  });
});
