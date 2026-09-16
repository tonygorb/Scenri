import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act, type FunctionComponent } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const guide = vi.fn();
const guideLearned = vi.fn();
vi.mock('../src/api.js', () => ({ api: { guide: () => guide(), guideLearned: (c: string) => guideLearned(c) } }));

const { guideSnapshot, learn, loadGuide, resetGuideForTests, useGuide } = await import('../src/guide.js');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let root: Root | null = null;

beforeEach(() => {
  resetGuideForTests();
  guide.mockReset();
  guideLearned.mockReset();
  guideLearned.mockResolvedValue({ eligible: true, learned: [] });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe('guide store', () => {
  it('is silent until the install is known to be new', async () => {
    expect(guideSnapshot()).toEqual({ eligible: false, learned: [] });
    guide.mockResolvedValue({ eligible: true, learned: [] });
    await loadGuide();
    expect(guideSnapshot()).toEqual({ eligible: true, learned: [] });
  });

  it('a failed or missing route teaches nobody and throws nothing', async () => {
    guide.mockRejectedValue(Object.assign(new Error('HTTP 404'), { status: 404 }));
    await expect(loadGuide()).resolves.toBeUndefined();
    expect(guideSnapshot().eligible).toBe(false);
  });

  it('loads once per page', async () => {
    guide.mockResolvedValue({ eligible: true, learned: [] });
    await Promise.all([loadGuide(), loadGuide()]);
    await loadGuide();
    expect(guide).toHaveBeenCalledTimes(1);
  });

  it('learning is visible at once and survives a failed post', async () => {
    guide.mockResolvedValue({ eligible: true, learned: [] });
    await loadGuide();
    const post = deferred<unknown>();
    guideLearned.mockReturnValue(post.promise);
    learn('tour-create');
    expect(guideSnapshot().learned).toEqual(['tour-create']);
    expect(guideLearned).toHaveBeenCalledWith('tour-create');
    post.reject(new Error('offline'));
    await Promise.resolve();
    expect(guideSnapshot().learned).toEqual(['tour-create']);
  });

  it('learning twice posts once', async () => {
    guide.mockResolvedValue({ eligible: true, learned: [] });
    await loadGuide();
    learn('refine');
    learn('refine');
    expect(guideLearned).toHaveBeenCalledTimes(1);
  });

  it('an install that is not new never posts', async () => {
    guide.mockResolvedValue({ eligible: false, learned: [] });
    await loadGuide();
    learn('tour-create');
    expect(guideLearned).not.toHaveBeenCalled();
  });

  it('a slow load never brings back what was learned meanwhile, and sends it', async () => {
    const load = deferred<{ eligible: boolean; learned: string[] }>();
    guide.mockReturnValue(load.promise);
    const loaded = loadGuide();
    learn('tour-create');
    load.resolve({ eligible: true, learned: ['refine', 'tour'] });
    await loaded;
    expect(guideSnapshot()).toEqual({ eligible: true, learned: ['refine', 'tour-create'] });
    expect(guideLearned).toHaveBeenCalledWith('tour-create');
  });

  it('a mounted reader re-renders the moment a concept is learned', async () => {
    guide.mockResolvedValue({ eligible: true, learned: [] });
    await loadGuide();
    const seen: string[][] = [];
    const Probe: FunctionComponent = () => {
      seen.push([...useGuide().learned]);
      return null;
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(createElement(Probe)));
    act(() => learn('refine'));
    expect(seen.at(-1)).toEqual(['refine']);
  });
});
