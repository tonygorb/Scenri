import { describe, it, expect, vi } from 'vitest';
import type { GuideView } from '../src/apiTypes.js';

const guide = vi.fn();
const guideIntentApi = vi.fn();
vi.mock('../src/api.js', () => ({
  api: { guide: () => guide(), guideIntent: (i: unknown) => guideIntentApi(i) },
}));
vi.mock('../src/firstUse.js', () => ({ FIRST_USE: false }));

const { guideIntent, guideSnapshot, loadGuide } = await import('../src/guide.js');

/** A new install part way through a task, as a build that offered first use left it. */
const midTask: GuideView = {
  eligible: true,
  welcome: 'taken',
  hidden: false,
  done: { product: 'x' },
  dismissed: [],
  active: {
    task: 'first-shot',
    brandId: 'b1',
    since: 's',
    baseline: { products: 0, presenters: 0, scenes: 0 },
  },
  activeNodes: [],
  activeDraftId: 'd1',
  counts: null,
};

describe('first use, paused', () => {
  it('reads nobody as new and nothing as in hand, whatever the record says', async () => {
    guide.mockResolvedValue(midTask);
    await loadGuide();
    expect(guideSnapshot()).toMatchObject({
      loaded: true,
      eligible: false,
      hidden: true,
      active: null,
      activeDraftId: null,
      done: { product: 'x' },
    });
  });

  it('and an answer to an intent is taken the same way', async () => {
    guideIntentApi.mockResolvedValue(midTask);
    await guideIntent({ welcome: 'taken' });
    expect(guideSnapshot()).toMatchObject({ eligible: false, hidden: true, active: null });
  });
});
