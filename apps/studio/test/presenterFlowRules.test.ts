import { describe, expect, it } from 'vitest';
import type { PresenterDraftSlot } from '../src/api.js';
import { activeQuestion } from '../src/create/presenter/presenterFlowRules.js';
import type { Question, Turn } from '../src/conversation/question.js';
import {
  EMPTY_SETUP,
  lastLookStep,
  PASSED,
  directionFrom,
  lookLine,
  lookSentence,
  STARTERS,
  type Setup,
  UNSURE_LINE,
  asideReply,
  filedLine,
  settleUnsure,
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
  it('from scratch: the look is asked one tap at a time, in order', () => {
    const ask = (look: Setup['look']) =>
      activeQuestion(turnsFor({ setup: setup({ source: 'scratch', look }), draft: null, canGenerate: true, ui }));
    const first = ask(null);
    expect(first?.id).toBe('look-who');
    expect(first?.kind === 'swatches' && first.row.id).toBe('who');
    expect(first?.kind === 'swatches' && first.row.options.map((o) => o.id)).toEqual(['woman', 'man', 'androgynous']);
    // each answer brings the next, and a step passed over is not asked again
    expect(ask({ who: 'woman' })).toMatchObject({ id: 'look-age' });
    const order = ['who', 'age', 'hair', 'length', 'skin', 'build'];
    const so: Record<string, string> = {};
    for (const id of order) {
      const q = ask({ ...so });
      expect(q?.kind === 'swatches' && q.row.id).toBe(id);
      so[id] = id === 'age' ? PASSED : (q?.kind === 'swatches' && q.row.options[0].id) || '';
    }
    // everything answered: it is read back, and nothing is drawn until it is agreed to
    expect(ask({ ...so })).toMatchObject({ id: 'agree' });
    expect(ask({ ...so })?.prompt).toContain('Shall I draw them?');
    // colours are colours, hair and skin take one of your own, and shapes are drawn
    const hair = ask({ who: 'woman', age: '30s' });
    // one row of colours, with a colour of your own at the end of it
    expect(hair?.kind === 'swatches' && hair.row.options.every((o) => !!o.color)).toBe(true);
    expect(hair?.kind === 'swatches' && [hair.row.options.length, hair.row.custom]).toEqual([9, true]);
    // an answer already given is taken back with its pencil, as any answer is
    const said = turnsFor({
      setup: setup({ source: 'scratch', look: { who: 'woman', age: '30s' } }),
      draft: null,
      canGenerate: true,
      ui,
    });
    expect(said.find((t) => t.kind === 'you' && t.id === 'look')).toMatchObject({ editable: true });
    expect(lastLookStep({ who: 'woman', age: '30s' })).toBe('age');
    const length = ask({ who: 'woman', age: '30s', hair: 'black' });
    expect(length?.kind === 'swatches' && length.row.options.every((o) => o.art === 'hair')).toBe(true);
    // a sentence still answers the whole thing, and answers it whole
    for (const s of STARTERS) expect([s.label, needsFollowUp(s.text)]).toEqual([s.label, false]);
  });

  it('what was tapped is said as a person, with a colour of your own named as the nearest we have', () => {
    const look = { who: 'woman', age: '30s', hair: 'dark brown', length: 'shoulder-length', skin: 'olive', build: 'slender' };
    expect(lookSentence(look)).toBe(
      'a woman in their 30s with shoulder-length dark brown hair, olive skin, a slender build',
    );
    expect(lookSentence({ who: 'man', hair: '#0f0d0c' })).toBe('a man with black hair');
    expect(directionFrom(setup({ source: 'scratch', look, description: 'a warm, unhurried presence' }))).toBe(
      'a woman in their 30s with shoulder-length dark brown hair, olive skin, a slender build, a warm, unhurried presence',
    );
    expect(lookLine('skipped')).toBe('Surprise me');
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
  const hello = (at: string) => ({
    said: 'hello',
    reply: 'Hi. Describe them in a sentence, or pick one above.',
    q: 'source',
    at,
  });
  it('is answered with the question again, the question stays open, and a second one does not replace the first', () => {
    const t = turnsFor({
      setup: setup(),
      draft: null,
      canGenerate: true,
      ui: {
        ...ui,
        asides: [
          hello('a1'),
          { said: 'test', reply: 'Describe them in a sentence, or pick one above.', q: 'source', at: 'a2' },
        ],
      },
    });
    const list = t.map((x) => (x.kind === 'question' ? `q:${x.question.id}` : `${x.kind}:${x.id}`));
    expect(list).toEqual([
      'you:intent',
      'q:source',
      'you:aside-said-a1',
      'scenri:aside-reply-a1',
      'you:aside-said-a2',
      'scenri:aside-reply-a2',
    ]);
    expect(activeQuestion(t)?.id).toBe('source');
  });
  it('stays under the question it interrupted once that question is answered', () => {
    const typed = setup({ source: 'scratch', typed: true, description: 'a woman in her 30s, dark hair, slim' });
    const list = ids(typed, null, true, { ...ui, asides: [hello('a1')] });
    expect(list.slice(0, 5)).toEqual([
      'you:intent',
      'scenri:asked-describe',
      'you:aside-said-a1',
      'scenri:aside-reply-a1',
      'you:describe',
    ]);
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
      results: [{ view: 'portrait', hash: 'p1', at: at(1), ask: 'shorter hair', how: 'drawn' }],
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
      results: [{ view: 'front', hash: 'f2', at: at(3), ask: 'arms relaxed', how: 'drawn' }],
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
    // the stage names what is being drawn, so the composer says nothing under it
    expect(composerFor(null, busy, 'front').off).toBe('');
    expect(ids(scratch, busy).at(-1)).toBe('scenri:drawing-three-quarter');
  });
});

describe('a sentence that answers nothing', () => {
  it('is answered in words for what it was, and differently the second time', () => {
    expect(asideReply('greeting', 'source', false, 'hello')).toBe(
      'Hi. Describe them in a sentence, or pick one above.',
    );
    expect(asideReply('question', 'source', false, 'how are you?')).toBe(
      'This is where the person is described: describe them in a sentence, or pick one above.',
    );
    expect(asideReply('nonsense', 'describe', false, 'bullshit')).toBe(
      'That does not describe anyone. A few words about them is enough: age, hair, build, skin, presence.',
    );
    expect(asideReply('nav', 'refine', false, 'start over')).toContain('Start over at the top');
    expect(asideReply('likeness', 'describe', false, 'like Zendaya')).toContain('does not draw a named person');
    expect(asideReply('greeting', 'source', true, 'hey')).toMatch(/^Still here\./);
    expect(asideReply('intent', 'source', false, 'i want to create a presenter')).toMatch(
      /^That is what we are here for\./,
    );
    expect(asideReply('nonsense', 'name', false, 'wtf')).toMatch(/^That is not a name\./);
  });
  it('a sentence with nothing of a person in it waits on its own question, then joins the record when a real one comes', () => {
    const u = { ...ui, unsure: { said: 'a florist from Paris who sells tulips', q: 'source', at: 'u1' } };
    expect(ids(setup(), null, true, u).slice(-3)).toEqual(['q:source', 'you:unsure-u1', 'q:unsure']);
    expect(activeQuestion(turnsFor({ setup: setup(), draft: null, canGenerate: true, ui: u }))?.id).toBe('unsure');
    const q: Question = { id: 'unsure', kind: 'confirm', prompt: '', options: [] };
    expect(composerFor(q, null, 'portrait').placeholder).toBe('Describe them');
    // what was said at the waiting question follows it; what came before stays before
    const chatty = {
      ...u,
      asides: [
        { said: '?', reply: 'r', q: 'source', at: 'a0' },
        { said: 'hey', reply: 'r', q: 'unsure', at: 'u2' },
      ],
    };
    expect(ids(setup(), null, true, chatty).slice(-6)).toEqual([
      'you:aside-said-a0',
      'scenri:aside-reply-a0',
      'you:unsure-u1',
      'q:unsure',
      'you:aside-said-u2',
      'scenri:aside-reply-u2',
    ]);
    const settled = settleUnsure(chatty);
    expect(settled.unsure).toBeNull();
    expect(settled.asides?.map((a) => [a.said, a.q])).toEqual([
      ['?', 'source'],
      ['hey', 'source'],
      ['a florist from Paris who sells tulips', 'source'],
    ]);
    expect(settled.asides?.at(-1)?.reply).toBe(UNSURE_LINE);
    // once the description came, all of it sits under the first question's line, in order
    const typed = setup({ source: 'scratch', typed: true, description: 'a woman in her 30s' });
    expect(ids(typed, null, true, settled).slice(0, 9)).toEqual([
      'you:intent',
      'scenri:asked-describe',
      'you:aside-said-a0',
      'scenri:aside-reply-a0',
      'you:aside-said-u1',
      'scenri:aside-reply-u1',
      'you:aside-said-u2',
      'scenri:aside-reply-u2',
      'you:describe',
    ]);
  });
});

describe('the record: pictures, decisions and restore points', () => {
  const at = (n: number) => `2026-09-09T11:0${n}:00.000Z`;
  const scratch = setup({ source: 'scratch', description: 'a woman in her 30s, dark hair, slim' });
  it('shows every picture that landed with Restore on the ones not on the view, every decision as an answer, and the extras answer in its place', () => {
    const d = draft({
      name: 'Maren',
      extras: true,
      asks: [{ view: 'front', text: 'arms relaxed', at: at(4) }],
      results: [
        { view: 'portrait', hash: 'p0', at: at(0), how: 'drawn' },
        { view: 'portrait', hash: 'p1', at: at(1), how: 'drawn' },
        { view: 'front', hash: 'f0', at: at(3), how: 'drawn' },
        { view: 'front', hash: 'f1', at: at(5), ask: 'arms relaxed', how: 'drawn' },
        { view: 'three-quarter', hash: 't0', at: at(6), how: 'drawn' },
        { view: 'back', hash: 'b0', at: at(8), how: 'drawn' },
      ],
      decisions: [
        { view: 'portrait', what: 'again', at: `${at(0)}!` },
        { view: 'portrait', what: 'use', at: at(2) },
        { view: 'front', what: 'keep', at: at(7) },
      ],
      views: views({
        portrait: slot({ status: 'approved', hash: 'p1' }),
        front: slot({ status: 'approved', hash: 'f0', prior: 'f1' }),
        'three-quarter': slot({ status: 'approved', hash: 't0' }),
        back: slot({ status: 'approved', hash: 'b0' }),
      }),
    });
    const t = turnsFor({ setup: scratch, draft: d, canGenerate: true, ui });
    const list = ids(scratch, d);
    const order = [
      `scenri:result-${at(0)}`,
      `you:decided-${at(0)}!`,
      `scenri:result-${at(1)}`,
      `you:decided-${at(2)}`,
      `scenri:result-${at(3)}`,
      `you:ask-${at(4)}`,
      `scenri:redrew-${at(4)}`,
      `scenri:result-${at(6)}`,
      `you:decided-${at(7)}`,
      'you:extras',
      `scenri:result-${at(8)}`,
    ];
    expect(order.map((k) => list.indexOf(k))).toEqual([...order.map((k) => list.indexOf(k))].sort((a, b) => a - b));
    for (const k of order) expect(list).toContain(k);
    const line = (id: string) => t.find((x) => x.kind === 'scenri' && x.id === id) as Extract<Turn, { kind: 'scenri' }>;
    // the first face, tried again: a restore point; the face on the view: not
    expect(line(`result-${at(0)}`)).toMatchObject({
      text: 'Here is face 1.',
      label: 'Face 1',
      current: false,
      thumb: 'p0',
      restore: { view: 'portrait', hash: 'p0' },
    });
    expect(line(`result-${at(1)}`)).toMatchObject({ text: 'Here is face 2.', label: 'Face 2', current: true });
    expect(line(`result-${at(1)}`).restore).toBeUndefined();
    // the full body on the view is the first one drawn, and says so
    expect(line(`result-${at(3)}`)).toMatchObject({ label: 'Full body 1', current: true });
    // one three-quarter picture, so nothing to tell apart and nothing marked
    expect(line(`result-${at(6)}`)).toMatchObject({ label: 'Three-quarter 1', current: false });
    // the ask's picture is its outcome, and since Keep previous put the first full body back, it can be restored
    expect(line(`redrew-${at(4)}`)).toMatchObject({
      text: 'Here is full body 2.',
      label: 'Full body 2',
      current: false,
      thumb: 'f1',
      restore: { view: 'front', hash: 'f1' },
    });
    expect(list).not.toContain(`scenri:result-${at(5)}`);
    const you = (id: string) => (t.find((x) => x.kind === 'you' && x.id === id) as Extract<Turn, { kind: 'you' }>).text;
    expect([you(`decided-${at(0)}!`), you(`decided-${at(2)}`), you(`decided-${at(7)}`), you('extras')]).toEqual([
      'Try again',
      'Use this person',
      'Keep previous',
      'Add them',
    ]);
    // nothing can be restored while a view draws
    const busy = draft({ ...d, activeView: 'left', stage: 'drawing' });
    const bt = turnsFor({ setup: scratch, draft: busy, canGenerate: true, ui });
    expect(
      (bt.find((x) => x.kind === 'scenri' && x.id === `result-${at(0)}`) as Extract<Turn, { kind: 'scenri' }>).restore,
    ).toBeUndefined();
  });
});

describe('what was said stays in its place', () => {
  const at = (n: number) => `2026-09-09T12:0${n}:00.000Z`;
  const scratch = setup({ source: 'scratch', description: 'a woman in her 30s, dark hair, slim' });
  it('small talk said at a question before the record moved on stays in the record when the same question is open again', () => {
    const d = draft({
      name: 'Maren',
      asks: [{ view: 'portrait', text: 'shorter hair', at: at(2) }],
      results: [
        { view: 'portrait', hash: 'p0', at: at(0), how: 'drawn' },
        { view: 'portrait', hash: 'p1', at: at(3), ask: 'shorter hair', how: 'drawn' },
      ],
      views: views({
        portrait: slot({ status: 'candidate', hash: 'p1', prior: undefined, adjustment: 'shorter hair' }),
      }),
    });
    const said = { ...ui, asides: [{ said: 'hey', reply: 'r', q: 'identity', at: at(1) }] };
    const list = ids(scratch, d, true, said);
    expect(list.indexOf('you:aside-said-' + at(1))).toBeLessThan(list.indexOf('you:ask-' + at(2)));
    expect(list.at(-1)).toBe('q:identity');
    // said after the record moved on, it follows the open question
    const later = { ...ui, asides: [{ said: 'hey', reply: 'r', q: 'identity', at: at(4) }] };
    expect(ids(scratch, d, true, later).slice(-3)).toEqual([
      'q:identity',
      'you:aside-said-' + at(4),
      'scenri:aside-reply-' + at(4),
    ]);
  });
});

describe('where they were filed', () => {
  it('is said once at the save, from what the analyzer read, and points to the page for changes', () => {
    expect(filedLine(draft())).toBe('');
    expect(filedLine(draft({ analysis: { suitableCategories: ['Apparel'] } }))).toBe(
      ' Filed under Apparel; that can change on their page.',
    );
    expect(filedLine(draft({ analysis: { suitableCategories: ['Apparel', 'Beauty', 'Sport'] } }))).toBe(
      ' Filed under Apparel, Beauty and Sport; that can change on their page.',
    );
  });
});
