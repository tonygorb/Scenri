import { describe, expect, it, vi } from 'vitest';
import { catalogBatchItems, catalogPickVerb } from '../src/layout/catalogPick.js';

const run = () => {};

describe('catalog pick verbs', () => {
  it('deletes presenters you own, and names the count', () => {
    expect(catalogPickVerb('presenter', 1)).toMatchObject({ tool: 'Delete', menu: 'Delete presenter', danger: true });
    expect(catalogPickVerb('presenter', 3).menu).toBe('Delete 3 presenters');
  });

  it('discards drafts', () => {
    expect(catalogPickVerb('draft', 1)).toMatchObject({ tool: 'Discard', menu: 'Discard', danger: true });
    expect(catalogPickVerb('draft', 2).menu).toBe('Discard 2 drafts');
  });

  it('deletes scenes and products you own', () => {
    expect(catalogPickVerb('owned-scene', 3).menu).toBe('Delete 3 scenes');
    expect(catalogPickVerb('owned-scene', 1).menu).toBe('Delete scene');
    expect(catalogPickVerb('product', 3).menu).toBe('Delete 3 products');
    expect(catalogPickVerb('product', 1).menu).toBe('Delete product');
  });

  it('keeps Open about the card, then the pick', () => {
    const items = catalogBatchItems({
      kind: 'owned-scene',
      count: 3,
      openLabel: 'Open',
      onOpen: run,
      href: '/scenes/mine',
      onDeselect: run,
      onAct: run,
    });
    expect(items.map((it) => it.label)).toEqual(['Open', 'Open in new tab', 'Deselect this', 'Delete 3 scenes']);
    expect(items.at(-1)?.separated).toBe(true);
    expect(items.at(-1)?.danger).toBe(true);
    expect(items.some((it) => it.label === 'Duplicate presenter')).toBe(false);
  });

  it('says Deselect when the pick is one card', () => {
    const items = catalogBatchItems({
      kind: 'owned-scene',
      count: 1,
      openLabel: 'Open',
      onOpen: run,
      href: '/scenes/mine',
      onDeselect: run,
      onAct: run,
    });
    expect(items.map((it) => it.label)).toEqual(['Open', 'Open in new tab', 'Deselect', 'Delete scene']);
  });

  it('continues a picked draft and discards the pick', () => {
    const items = catalogBatchItems({
      kind: 'draft',
      count: 2,
      openLabel: 'Continue',
      onOpen: run,
      href: '/studio/d1',
      onDeselect: run,
      onAct: run,
    });
    expect(items.map((it) => it.label)).toEqual(['Continue', 'Open in new tab', 'Deselect this', 'Discard 2 drafts']);
    expect(items[0]?.icon).toBe('continue');
  });

  it('opens the card under the pointer in a new tab', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const items = catalogBatchItems({
      kind: 'product',
      count: 2,
      openLabel: 'Open',
      onOpen: run,
      href: '/products/mine',
      onDeselect: run,
      onAct: run,
    });
    items.find((it) => it.key === 'open-tab')?.onSelect();
    expect(open).toHaveBeenCalledWith('/products/mine', '_blank');
    open.mockRestore();
  });

  it('names Keepers on a picked handful, and leaves a draft without it', () => {
    const scenes = catalogBatchItems({
      kind: 'owned-scene',
      count: 3,
      openLabel: 'Open',
      onOpen: run,
      href: '/scenes/mine',
      onDeselect: run,
      onAct: run,
      onKeep: run,
      allKept: false,
    });
    expect(scenes.map((it) => it.label)).toEqual([
      'Open',
      'Open in new tab',
      'Deselect this',
      'Add 3 scenes to Keepers',
      'Delete 3 scenes',
    ]);
    expect(scenes.find((it) => it.key === 'keep')?.icon).toBe('keep');
    expect(scenes.at(-1)?.separated).toBe(true);

    const off = catalogBatchItems({
      kind: 'presenter',
      count: 2,
      openLabel: 'Open',
      onOpen: run,
      onDeselect: run,
      onAct: run,
      onKeep: run,
      allKept: true,
    });
    expect(off.find((it) => it.key === 'keep')).toMatchObject({
      label: 'Remove 2 presenters from Keepers',
      icon: 'kept',
    });

    const drafts = catalogBatchItems({
      kind: 'draft',
      count: 2,
      openLabel: 'Continue',
      onOpen: run,
      onDeselect: run,
      onAct: run,
      onKeep: run,
    });
    expect(drafts.some((it) => it.key === 'keep')).toBe(false);
  });
});
