import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The draft as the studio holds it: what a lost read leaves behind, and what
 * a second press on the same put-back sends. Driven through the hook itself,
 * with the server answering from a script.
 */
const api = vi.hoisted(() => ({
  presenterDraft: vi.fn(),
  revertDraftView: vi.fn(),
  restoreDraftView: vi.fn(),
  updatePresenterDraft: vi.fn(),
  generateDraftView: vi.fn(),
}));
vi.mock('../src/api.js', () => ({ api }));

const { usePresenterDraft } = await import('../src/create/presenter/usePresenterDraft.js');

type Held = ReturnType<typeof usePresenterDraft>;
let host: HTMLDivElement;
let root: Root;
let held: Held;

function Probe() {
  held = usePresenterDraft('b1', 'pd-1');
  return null;
}

const draft = (over: Record<string, unknown> = {}) => ({
  id: 'pd-1',
  updatedAt: '2026-09-26T10:00:00.000Z',
  stage: 'idle',
  activeView: null,
  ...over,
});
const drawing = draft({ activeView: 'portrait', stage: 'drawing' });
const landed = draft({ updatedAt: '2026-09-26T10:00:05.000Z' });
const settle = () => act(async () => {});

beforeEach(() => {
  vi.useFakeTimers();
  for (const f of Object.values(api)) f.mockReset();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe('a read of the draft that is lost', () => {
  it('is a moment: the next read that lands takes the error back', async () => {
    api.presenterDraft
      .mockResolvedValueOnce(drawing)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(landed);
    act(() => root.render(createElement(Probe)));
    await settle();
    expect(held.drawing).toBe(true);
    // the poll that is lost on the way
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(held.err).toBe('Failed to fetch');
    // and the one after it, with the face landed
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(held.drawing).toBe(false);
    expect(held.err).toBeNull();
  });

  it("leaves an action's own failure standing", async () => {
    api.presenterDraft.mockResolvedValue(draft());
    api.updatePresenterDraft.mockRejectedValueOnce(Object.assign(new Error('database is locked'), { status: 500 }));
    act(() => root.render(createElement(Probe)));
    await settle();
    await act(async () => {
      await held.update({ name: 'Maren' });
    });
    expect(held.err).toBe('database is locked');
    await act(async () => {
      await held.reload();
    });
    expect(held.err).toBe('database is locked');
  });
});

describe('putting a picture back', () => {
  it('is one act however fast it is pressed twice', async () => {
    api.presenterDraft.mockResolvedValue(draft());
    let answer = (_: unknown) => {};
    api.revertDraftView.mockReturnValueOnce(
      new Promise((r) => {
        answer = r;
      }),
    );
    act(() => root.render(createElement(Probe)));
    await settle();
    let first: Promise<boolean> = Promise.resolve(false);
    let second: Promise<boolean> = Promise.resolve(false);
    act(() => {
      first = held.revert('three-quarter');
      second = held.revert('three-quarter');
    });
    await act(async () => {
      answer(draft({ updatedAt: '2026-09-26T10:00:09.000Z' }));
      await first;
    });
    expect(await second).toBe(false);
    expect(api.revertDraftView).toHaveBeenCalledTimes(1);
    expect(held.err).toBeNull();
  });
});

/**
 * A draw that never reached the engine is said about the view it was for
 * (UXP-11), so the failure keeps which view that was beside its words; any
 * other action's failure names no view.
 */
describe('a request that failed', () => {
  it('remembers the view when it was a draw', async () => {
    api.presenterDraft.mockResolvedValue(draft());
    api.generateDraftView.mockRejectedValueOnce(Object.assign(new Error('the engine fell over'), { status: 500 }));
    act(() => root.render(createElement(Probe)));
    await settle();
    await act(async () => {
      await held.generate('front');
    });
    expect(held.err).toBe('the engine fell over');
    expect(held.errView).toBe('front');
  });

  it('names no view when it was not a draw', async () => {
    api.presenterDraft.mockResolvedValue(draft());
    api.generateDraftView.mockRejectedValueOnce(Object.assign(new Error('the engine fell over'), { status: 500 }));
    api.updatePresenterDraft.mockRejectedValueOnce(Object.assign(new Error('database is locked'), { status: 500 }));
    act(() => root.render(createElement(Probe)));
    await settle();
    await act(async () => {
      await held.generate('front');
    });
    await act(async () => {
      await held.update({ name: 'Maren' });
    });
    expect(held.err).toBe('database is locked');
    expect(held.errView).toBeNull();
  });
});
