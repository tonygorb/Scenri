import { describe, it, expect, beforeEach } from 'vitest';
import {
  guideFactsSnapshot,
  publishComposer,
  publishStudio,
  registerSlot,
  releaseSlot,
  resetGuideFactsForTests,
  setGuideShowing,
  subscribeGuideFacts,
  type ComposerFacts,
} from '../src/guideFacts.js';

const facts = (over: Partial<ComposerFacts> = {}): ComposerFacts => ({
  brandId: 'b1',
  products: 0,
  presenters: 0,
  scene: false,
  words: false,
  canGo: false,
  busy: false,
  pickerOpen: false,
  refining: false,
  engine: 'ready',
  ...over,
});

describe('guide facts', () => {
  let emits = 0;
  beforeEach(() => {
    resetGuideFactsForTests();
    emits = 0;
    subscribeGuideFacts(() => emits++);
  });

  it('a surface that says the same thing twice is not news', () => {
    publishComposer(facts());
    publishComposer(facts());
    publishComposer(facts({ words: true }));
    publishComposer(facts({ words: true }));
    expect(emits).toBe(2);
    publishStudio({ open: 'source' });
    publishStudio({ open: 'source' });
    setGuideShowing(false);
    setGuideShowing(true);
    setGuideShowing(true);
    expect(emits).toBe(4);
    expect(guideFactsSnapshot()).toMatchObject({
      composer: { words: true },
      studio: { open: 'source' },
      showing: true,
    });
  });

  it('a composer that goes takes its facts with it', () => {
    publishComposer(facts({ products: 1 }));
    publishComposer(null);
    expect(guideFactsSnapshot().composer).toBeNull();
  });

  it('a slot is let go only by the element that holds it', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    registerSlot('picker', a);
    registerSlot('picker', b);
    releaseSlot('picker', a);
    expect(guideFactsSnapshot().slots.picker).toBe(b);
    releaseSlot('picker', b);
    expect(guideFactsSnapshot().slots.picker).toBeUndefined();
  });
});
