import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { GuideView } from '../src/apiTypes.js';

const guide = vi.fn();
const guideIntentApi = vi.fn();
vi.mock('../src/api.js', () => ({
  api: { guide: () => guide(), guideIntent: (i: unknown) => guideIntentApi(i) },
}));

// The store itself, with first use offered; firstUsePaused.test.ts holds it paused.
vi.mock('../src/firstUse.js', () => ({ FIRST_USE: true }));

const { guideIntent, guideSnapshot, loadGuide, refreshGuide, resetGuideForTests } = await import('../src/guide.js');

const view = (over: Partial<GuideView> = {}): GuideView => ({
  eligible: true,
  welcome: null,
  hidden: false,
  done: {},
  dismissed: [],
  active: null,
  activeNodes: [],
  activeDraftId: null,
  counts: null,
  ...over,
});
const active = {
  task: 'product' as const,
  brandId: 'b1',
  since: 's',
  baseline: { products: 0, presenters: 0, scenes: 0 },
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  resetGuideForTests();
  guide.mockReset();
  guideIntentApi.mockReset();
});

describe('the guide record in the studio', () => {
  it('knows nothing until the server answers, then holds its answer', async () => {
    guide.mockResolvedValue(view({ welcome: 'taken' }));
    expect(guideSnapshot()).toMatchObject({ loaded: false, eligible: false, hidden: true });
    await loadGuide();
    expect(guideSnapshot()).toMatchObject({ loaded: true, eligible: true, welcome: 'taken' });
  });

  it('loads once, however many ask, and a failed read still counts as loaded', async () => {
    guide.mockRejectedValue(new Error('old server'));
    await Promise.all([loadGuide(), loadGuide()]);
    expect(guide).toHaveBeenCalledTimes(1);
    expect(guideSnapshot()).toMatchObject({ loaded: true, eligible: false });
  });

  it('an intent shows at once, then takes the server answer', async () => {
    guide.mockResolvedValue(view());
    await loadGuide();
    const answer = deferred<GuideView>();
    guideIntentApi.mockReturnValue(answer.promise);
    const sent = guideIntent({ welcome: 'declined' });
    expect(guideSnapshot().welcome).toBe('declined');
    answer.resolve(view({ welcome: 'declined', done: { shot: 'x' } }));
    await sent;
    expect(guideSnapshot().done.shot).toBe('x');
  });

  it('a failed intent puts the record back and reads it again', async () => {
    guide.mockResolvedValue(view({ active }));
    await loadGuide();
    guideIntentApi.mockRejectedValue(new Error('offline'));
    const sent = guideIntent({ dismiss: 'product' });
    // closing the guide pauses the task in hand rather than dropping it
    expect(guideSnapshot()).toMatchObject({ active: { ...active, paused: true }, dismissed: ['product'] });
    await sent;
    expect(guideSnapshot()).toMatchObject({ active, dismissed: [] });
    expect(guide).toHaveBeenCalledTimes(2);
  });

  it('finishing another task than the one in hand changes nothing', async () => {
    guide.mockResolvedValue(view({ active }));
    await loadGuide();
    guideIntentApi.mockReturnValue(new Promise(() => {}));
    void guideIntent({ finish: 'scene' });
    expect(guideSnapshot().active).toEqual(active);
    void guideIntent({ finish: 'product' });
    expect(guideSnapshot().active).toBeNull();
  });

  it('a refresh reads again even after the first load', async () => {
    guide.mockResolvedValueOnce(view()).mockResolvedValueOnce(view({ hidden: true }));
    await loadGuide();
    await refreshGuide();
    expect(guideSnapshot().hidden).toBe(true);
  });

  it('a record from a server that does not know part-done lessons loads as none', async () => {
    // The fields this build reads may simply not be there: a studio on a lane
    // whose API has been up since before they existed answers without them.
    // Learn reads progress on every open, so taking that literally white
    // screened the whole app behind the route boundary.
    guide.mockResolvedValue(view());
    await loadGuide();
    expect(guideSnapshot().progress).toEqual({});
    expect(guideSnapshot().lessons).toEqual({});
  });
});
