import { describe, expect, it } from 'vitest';
import type { PresenterDraftSlot } from '../src/api.js';
import {
  EMPTY_EDIT_UI,
  OUT_OF_SCOPE_LINE,
  editComposerState,
  editIntent,
  isDirty,
  missingCore,
  turnsForEdit,
} from '../src/create/presenter/presenterEditRules.js';
import { type DraftLike, VIEWS, emptySlot } from '../src/create/presenter/presenterStudioRules.js';

const slot = (p: Partial<PresenterDraftSlot>): PresenterDraftSlot => ({ ...emptySlot(), ...p });
const approved = (hash: string, origin: 'generated' | 'photo' = 'generated') =>
  slot({ status: 'approved', hash, origin });
const views = (over: Partial<Record<(typeof VIEWS)[number], PresenterDraftSlot>> = {}) =>
  Object.fromEntries(VIEWS.map((v) => [v, over[v] ?? emptySlot()])) as DraftLike['views'];
const draft = (over: Partial<DraftLike> = {}): DraftLike => ({
  source: 'synthetic',
  name: 'Maren',
  views: views({ portrait: approved('p'), front: approved('f'), 'three-quarter': approved('t') }),
  activeView: null,
  stage: 'idle',
  extras: false,
  identityEdits: [],
  ...over,
});
const base = {
  shots: [
    { file: 'asset:p', angle: 'portrait' },
    { file: 'asset:f', angle: 'front' },
    { file: 'asset:t', angle: 'three-quarter' },
  ],
  identityEdits: [],
};
const ids = (t: ReturnType<typeof turnsForEdit>) =>
  t.map((x) => (x.kind === 'question' ? `q:${x.question.id}` : `${x.kind}:${x.id}`));

describe('what a sentence in the editor is aimed at', () => {
  const d = draft();
  it('a likeness complaint or a capture correction repairs the view on the stage', () => {
    expect(editIntent('It does not look like her here', 'front', d)).toEqual({ scope: 'view', view: 'front' });
    expect(editIntent('turn her slightly more to camera', 'three-quarter', d)).toEqual({
      scope: 'view',
      view: 'three-quarter',
    });
    expect(editIntent('regenerate this', 'front', d)).toEqual({ scope: 'view', view: 'front' });
    expect(editIntent('a more natural expression', 'front', d)).toEqual({ scope: 'view', view: 'front' });
  });
  it('a trait changes the person, wherever it is said', () => {
    expect(editIntent('Make her hair shorter', 'front', d)).toEqual({ scope: 'identity', view: 'portrait' });
    expect(editIntent('make him ten years older', 'three-quarter', d)).toEqual({ scope: 'identity', view: 'portrait' });
    expect(editIntent('remove the beard', 'front', d)).toEqual({ scope: 'identity', view: 'portrait' });
    expect(editIntent('anything at all', 'portrait', d)).toEqual({ scope: 'identity', view: 'portrait' });
  });
  it('a trait with "here" repairs the view, grounded in the current person', () => {
    expect(
      editIntent(
        'the hair should be shorter here too',
        'back',
        draft({
          views: views({
            portrait: approved('p'),
            front: approved('f'),
            'three-quarter': approved('t'),
            back: approved('b'),
          }),
          extras: true,
        }),
      ),
    ).toEqual({ scope: 'view', view: 'back' });
  });
  it('a trait and a likeness complaint together, with no view named, is asked', () => {
    expect(editIntent('her face looks wrong with the shorter hair', 'front', d)).toEqual({ scope: 'ambiguous' });
  });
  it("a shot's art direction belongs to Create", () => {
    expect(editIntent('Put Maren in a red dress in Paris holding my perfume', 'front', d)).toEqual({
      scope: 'out-of-scope',
    });
    expect(editIntent('on a beach at sunset', 'front', d)).toEqual({ scope: 'out-of-scope' });
    expect(editIntent('a simpler outfit', 'front', d)).toEqual({ scope: 'view', view: 'front' });
  });
  it('a photograph is never redrawn; an empty view has nothing to change', () => {
    const photos = draft({
      views: views({ portrait: approved('a', 'photo'), front: approved('b', 'photo'), 'three-quarter': approved('t') }),
    });
    expect(editIntent('turn more to camera', 'front', photos)).toEqual({
      blocked: 'Your photo stands as it is. Pick a drawn view to change.',
    });
    expect(editIntent('turn more to camera', 'back', d)).toEqual({ blocked: 'Nothing drawn for the back view yet.' });
    expect(editIntent('   ', 'front', d)).toEqual({ blocked: 'Say what should change.' });
  });
  it('the composer says what will happen before Send', () => {
    expect(editComposerState('', 'front', d, 'Maren').hint).toContain('Say what is wrong');
    expect(editComposerState('shorter hair', 'front', d, 'Maren').chip?.label).toBe('Changing the person');
    expect(editComposerState('turn to camera', 'front', d, 'Maren').chip?.label).toBe('Refining the full body');
    expect(editComposerState('in a red dress', 'front', d, 'Maren')).toMatchObject({ chip: null, tone: 'alert' });
  });
});

describe('the editor transcript', () => {
  it('opens with one question and nothing else when nothing changed', () => {
    expect(
      ids(
        turnsForEdit({
          draft: draft(),
          base,
          name: 'Maren',
          selected: 'portrait',
          canGenerate: true,
          ui: EMPTY_EDIT_UI,
        }),
      ),
    ).toEqual(['scenri:opening']);
  });
  it('offers a legacy presenter its missing views once', () => {
    const legacy = draft({ views: views({ portrait: approved('a', 'photo') }) });
    expect(missingCore(legacy)).toEqual(['front', 'three-quarter']);
    const t = turnsForEdit({
      draft: legacy,
      base: { shots: [{ file: 'asset:a' }] },
      name: 'Kwame',
      selected: 'portrait',
      canGenerate: true,
      ui: EMPTY_EDIT_UI,
    });
    expect(ids(t).at(-1)).toBe('q:legacy');
    expect((t.at(-1) as any).question.prompt).toBe(
      'Kwame has one reference. Build the full body and three-quarter view from it?',
    );
    const declined = turnsForEdit({
      draft: legacy,
      base: { shots: [{ file: 'asset:a' }] },
      name: 'Kwame',
      selected: 'portrait',
      canGenerate: true,
      ui: { ...EMPTY_EDIT_UI, buildDeclined: true },
    });
    expect(ids(declined)).not.toContain('q:legacy');
  });
  it('says when a sentence belongs to Create, and asks once when it reads both ways', () => {
    const oos = turnsForEdit({
      draft: draft(),
      base,
      name: 'Maren',
      selected: 'front',
      canGenerate: true,
      ui: {
        ...EMPTY_EDIT_UI,
        asides: [{ said: 'in a red dress', reply: OUT_OF_SCOPE_LINE('Maren'), q: null, at: 'n1' }],
      },
    });
    expect(ids(oos)).toEqual(['scenri:opening', 'you:aside-said-n1', 'scenri:aside-reply-n1']);
    const ask = turnsForEdit({
      draft: draft(),
      base,
      name: 'Maren',
      selected: 'front',
      canGenerate: true,
      ui: { ...EMPTY_EDIT_UI, scopeAsk: { said: 'her face looks wrong with the shorter hair', at: 'n2' } },
    });
    expect(ids(ask).at(-1)).toBe('q:scope');
  });
  it('a candidate returns the one decision; a self-decided redraw is in the record', () => {
    const d = draft({
      asks: [{ view: 'portrait', text: 'shorter hair', at: 'a1' }],
      views: views({
        portrait: slot({ status: 'candidate', hash: 'p2', prior: 'p', adjustment: 'shorter hair' }),
        front: approved('f'),
        'three-quarter': approved('t'),
      }),
    });
    const t = turnsForEdit({
      draft: d,
      base,
      name: 'Maren',
      selected: 'portrait',
      canGenerate: true,
      ui: EMPTY_EDIT_UI,
    });
    expect(ids(t)).toEqual(['scenri:opening', 'scenri:asked-ask-a1', 'you:ask-a1', 'q:revision']);
    const redrew = draft({
      asks: [{ view: 'front', text: 'to camera', at: 'a2' }],
      views: views({
        portrait: approved('p'),
        front: slot({ status: 'approved', hash: 'f2', prior: 'f', adjustment: 'to camera' }),
        'three-quarter': approved('t'),
      }),
    });
    const r = turnsForEdit({
      draft: redrew,
      base,
      name: 'Maren',
      selected: 'front',
      canGenerate: true,
      ui: EMPTY_EDIT_UI,
    });
    expect(ids(r)).toEqual(['scenri:opening', 'scenri:asked-ask-a2', 'you:ask-a2', 'scenri:redrew-a2', 'q:save']);
  });
  it('a conflict on save asks for a reload; a failure asks for a retry', () => {
    const c = turnsForEdit({
      draft: draft(),
      base,
      name: 'Maren',
      selected: 'front',
      canGenerate: true,
      ui: { ...EMPTY_EDIT_UI, conflict: 'moved' },
    });
    expect(ids(c).at(-1)).toBe('q:conflict');
    const f = turnsForEdit({
      draft: draft(),
      base,
      name: 'Maren',
      selected: 'front',
      canGenerate: true,
      ui: { ...EMPTY_EDIT_UI, failed: 'the engine fell over' },
    });
    expect(ids(f).at(-1)).toBe('q:retry');
  });
});

describe('the record of a session', () => {
  it('keeps the changes to the person accepted in this session, not the ones the record already had', () => {
    const d = draft({ identityEdits: ['longer hair', 'shorter hair'] });
    const t = turnsForEdit({
      draft: d,
      base: { ...base, identityEdits: ['longer hair'] },
      name: 'Maren',
      selected: 'portrait',
      canGenerate: true,
      ui: EMPTY_EDIT_UI,
    });
    expect(ids(t)).toEqual(['scenri:opening', 'scenri:asked-edit-0', 'you:edit-0', 'scenri:changed-0', 'q:save']);
    expect((t[2] as any).text).toBe('shorter hair');
  });
});

describe('dirtiness', () => {
  it('is any picture or identity edit that differs from the record', () => {
    expect(isDirty(draft(), base)).toBe(false);
    expect(
      isDirty(
        draft({ views: views({ portrait: approved('p'), front: approved('f2'), 'three-quarter': approved('t') }) }),
        base,
      ),
    ).toBe(true);
    expect(isDirty(draft({ identityEdits: ['shorter hair'] }), base)).toBe(true);
    expect(
      isDirty(
        draft({
          views: views({
            portrait: approved('p'),
            front: slot({ status: 'stale', hash: 'f' }),
            'three-quarter': approved('t'),
          }),
        }),
        base,
      ),
    ).toBe(true);
  });
});

describe('a set that is not coherent yet', () => {
  it('offers no Save while a view built on the face is still to be redrawn', () => {
    const d = draft({
      views: views({
        portrait: approved('p2'),
        front: slot({ status: 'stale', hash: 'f' }),
        'three-quarter': slot({ status: 'stale', hash: 't' }),
      }),
    });
    const t = turnsForEdit({
      draft: d,
      base,
      name: 'Maren',
      selected: 'portrait',
      canGenerate: true,
      ui: EMPTY_EDIT_UI,
    });
    expect(ids(t).at(-1)).toBe('scenri:rebuilding');
    expect(ids(t)).not.toContain('q:save');
  });
});
