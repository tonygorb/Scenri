import { describe, expect, it } from 'vitest';
import type { PresenterDraftSlot } from '../src/api.js';
import { EMPTY_EDIT_UI, isUntouched, turnsForEdit } from '../src/create/presenter/presenterEditRules.js';
import { type DraftLike, VIEWS, emptySlot } from '../src/create/presenter/presenterStudioRules.js';

/**
 * What the editor says when a draw fails, and when a session holds nothing.
 * The raw strings are ones the engines really throw (failure.test.ts keeps the
 * same list).
 */
const slot = (p: Partial<PresenterDraftSlot>): PresenterDraftSlot => ({ ...emptySlot(), ...p });
const approved = (hash: string) => slot({ status: 'approved', hash, origin: 'generated' });
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
const turns = (d: DraftLike, failed: string | null = null) =>
  turnsForEdit({
    draft: d,
    base,
    name: 'Maren',
    selected: 'front',
    canGenerate: true,
    ui: { ...EMPTY_EDIT_UI, failed },
  });
const lastQuestion = (d: DraftLike, failed: string | null = null) => {
  const t = turns(d, failed).at(-1);
  if (t?.kind !== 'question' || t.question.kind !== 'confirm') throw new Error('no confirm question at the end');
  return t.question;
};
const said = (d: DraftLike) =>
  turns(d)
    .map((t) => (t.kind === 'question' ? (t.question.kind === 'confirm' ? t.question.prompt : '') : t.text))
    .join(' ');

/** Protocol, exit codes and JSON envelopes: the engine's words for an engineer. */
const RAW = /codex exited with code|HTTP \d{3}|\{"error"|ERROR:|non-JSON body/;
const failedFront = (error: string) =>
  draft({
    views: views({ portrait: approved('p'), front: slot({ ...approved('f'), error }), 'three-quarter': approved('t') }),
  });

describe('a failed draw in the editor', () => {
  it('says a signed-out Codex in words and offers Sign in before Retry', () => {
    const q = lastQuestion(failedFront('codex exited with code 1: ERROR: unexpected status 401 Unauthorized'));
    expect(q.id).toBe('retry');
    expect(q.prompt).not.toMatch(RAW);
    expect(q.prompt).toBe(
      'The full body could not be drawn. Codex is signed out on this machine. Sign in with your ChatGPT account, then run this again.',
    );
    expect(q.options).toEqual([
      { id: 'remedy:setup', label: 'Sign in' },
      { id: 'retry', label: 'Retry' },
    ]);
  });

  it('points a refused key and a spent cap at the page that fixes them', () => {
    const key = lastQuestion(
      failedFront(
        'OpenRouter request failed: HTTP 401: {"error":{"message":"Missing Authentication header","code":401}}',
      ),
    );
    expect(key.prompt).not.toMatch(RAW);
    expect(key.options.map((o) => o.id)).toEqual(['remedy:engines', 'retry']);
    const cap = lastQuestion(
      failedFront('Spend cap for openrouter: $10.00/mo. Spent $9.80, next ~$0.40 would exceed it.'),
    );
    expect(cap.options.map((o) => o.id)).toEqual(['remedy:budget', 'retry']);
  });

  it('offers only Retry where a second try can work, and keeps words nothing recognises', () => {
    const rate = lastQuestion(
      failedFront('OpenRouter request failed: HTTP 429: {"error":{"message":"Rate limit exceeded","code":429}}'),
    );
    expect(rate.prompt).not.toMatch(RAW);
    expect(rate.options.map((o) => o.id)).toEqual(['retry']);
    // a request that never reached the engine, in its own words
    const refused = lastQuestion(draft(), 'there is no previous three-quarter view to keep');
    expect(refused.prompt).toBe(
      'That did not go through: there is no previous three-quarter view to keep. Nothing finished was touched.',
    );
  });

  it('a stopped draw is still said quietly and offered again', () => {
    const q = lastQuestion(failedFront('cancelled'));
    expect(q.prompt).toBe('Stopped drawing the full body. Nothing finished was touched.');
    expect(q.options).toEqual([{ id: 'retry', label: 'Draw it again' }]);
  });
});

describe('a candidate that carries a failure', () => {
  it('a Try again that failed is said, and the picture is not offered as a new redraw', () => {
    const d = draft({
      views: views({
        portrait: approved('p'),
        front: slot({ status: 'candidate', hash: 'f2', prior: 'f', attempts: 2, error: 'quota exceeded' }),
        'three-quarter': approved('t'),
      }),
    });
    expect(said(d)).toContain('The full body could not be drawn: quota exceeded.');
    expect(said(d)).not.toContain('Redrew the full body.');
    // the decision about the picture still stands
    expect(lastQuestion(d).id).toBe('view-revision');
  });

  it('a redraw cut short by a restart says so', () => {
    const d = draft({
      views: views({
        portrait: approved('p'),
        front: slot({
          status: 'candidate',
          hash: 'f',
          attempts: 1,
          error: 'interrupted: server restarted mid-generation',
        }),
        'three-quarter': approved('t'),
      }),
    });
    expect(said(d)).toContain('restarted');
  });
});

describe('a session nothing happened in', () => {
  it('is the record as saved, with nothing said, drawn or decided', () => {
    expect(isUntouched(draft(), base)).toBe(true);
  });
  // A session opened on a record carries the record's own pictures in its
  // history (the server's backfill), which is not something happening in it.
  it('still counts as untouched with the history the record brought in', () => {
    const own = ['portrait', 'front', 'three-quarter'].map((view, i) => ({
      view: view as 'portrait',
      hash: ['p', 'f', 't'][i],
      at: 'a0',
      how: 'drawn' as const,
    }));
    expect(isUntouched(draft({ results: own }), base)).toBe(true);
  });
  it('is not one with a change, a draw under way, or any history', () => {
    expect(isUntouched(draft({ identityEdits: ['shorter hair'] }), base)).toBe(false);
    expect(isUntouched(draft({ activeView: 'front' }), base)).toBe(false);
    expect(isUntouched(draft({ asks: [{ view: 'front', text: 'to camera', at: 'a1' }] }), base)).toBe(false);
    expect(
      isUntouched(draft({ results: [{ view: 'front', hash: 'f2', at: 'a1', ask: 'to camera', how: 'drawn' }] }), base),
    ).toBe(false);
    expect(isUntouched(draft({ decisions: [{ view: 'front', what: 'keep', at: 'a1' }] }), base)).toBe(false);
  });
});
