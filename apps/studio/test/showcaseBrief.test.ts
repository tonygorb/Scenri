import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement, act, type FunctionComponent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ShowcaseEntry } from '../src/api.js';
import { showcaseBrief } from '../src/app/useApplyShowcase.js';
import { PREF, useRecipeSetting } from '../src/prefs.js';
import {
  DEFAULT_FORMAT_ID,
  DEFAULT_QUALITY,
  DEFAULT_VARIANT_COUNT,
  type QualityId,
} from '../src/composer/shotSettings/settings.js';

/**
 * Every homepage example is stored as a two-variant shot, and lending that
 * count meant the first Generate from an example made two pictures the person
 * never chose. The shape and the quality still come along, because they are
 * what makes the result match the tile; the count stays the person's own, which
 * on a machine that never picked one is a single shot.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
const roots: Root[] = [];

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    for (const r of roots.splice(0)) r.unmount();
  });
  container.remove();
});

/** Mount a hook and return a live handle on its latest return value. */
function mount<T>(useHook: () => T): { current: T } {
  const handle = { current: undefined as unknown as T };
  const Probe: FunctionComponent = () => {
    handle.current = useHook();
    return null;
  };
  const host = document.createElement('div');
  container.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(Probe)));
  return handle;
}

const entry: ShowcaseEntry = {
  id: 'dark-bite',
  title: 'The first square of 72%',
  category: 'social',
  brief: { tokens: [{ t: 'format', id: 'square', w: 1024, h: 1024 }] },
  variants: 2,
  quality: 'high',
  width: 1024,
  height: 1024,
};

/**
 * Land the recipe the way the composer does when it arrives as its initial
 * brief: the shape rides in the sentence, and each setting the brief carries is
 * borrowed for the brief on screen rather than written down. This copies the
 * initialBrief effect in layout/Composer.tsx; keep the two in step.
 */
function land(lentBefore?: number) {
  const count = mount(() => useRecipeSetting(PREF.count, DEFAULT_VARIANT_COUNT));
  // a remix landed earlier on the same composer lends its own count
  if (lentBefore) act(() => count.current[2](lentBefore));
  const quality = mount(() => useRecipeSetting<QualityId>(PREF.quality, DEFAULT_QUALITY));
  const format = mount(() => useRecipeSetting(PREF.format, DEFAULT_FORMAT_ID));
  const brief: { tokens: { t: string; id?: string }[]; variants?: number; quality?: QualityId } = showcaseBrief(entry);
  const shape = brief.tokens.find((t) => t.t === 'format');
  act(() => {
    if (shape?.id) format.current[2](shape.id);
    count.current[2](brief.variants ?? null);
    if (brief.quality) quality.current[2](brief.quality);
  });
  return { count: count.current[0], quality: quality.current[0], format: format.current[0] };
}

describe('showcaseBrief', () => {
  it('opens an example at one shot, still at its own shape and quality', () => {
    expect(land()).toEqual({ count: 1, quality: 'high', format: 'square' });
    // borrowing writes nothing down, so no later shot inherits any of it
    expect(localStorage.getItem(PREF.count)).toBeNull();
    expect(localStorage.getItem(PREF.quality)).toBeNull();
  });

  it('clears a count an earlier brief lent, so a remix of four never rides into an example', () => {
    expect(land(4).count).toBe(1);
  });

  it('leaves a count the person saved in charge', () => {
    localStorage.setItem(PREF.count, '3');
    expect(land().count).toBe(3);
    expect(localStorage.getItem(PREF.count)).toBe('3');
  });
});
