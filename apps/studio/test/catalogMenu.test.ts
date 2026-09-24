import { describe, expect, it, vi } from 'vitest';
import { catalogMenuItems } from '../src/layout/catalogMenu.js';

const run = () => {};

describe('catalog menus', () => {
  it('gives a library scene open, use, and Keepers', () => {
    const items = catalogMenuItems({
      onOpen: run,
      href: '/scenes/loft',
      use: { label: 'Use in a shot', run },
      keep: { on: false, run },
    });
    expect(items.map((it) => it.label)).toEqual(['Open', 'Open in new tab', 'Use in a shot', 'Add to Keepers']);
    expect(items.find((it) => it.key === 'keep')?.icon).toBe('keep');
    expect(items.some((it) => it.key === 'delete')).toBe(false);
  });

  it('names a keeper that is already on', () => {
    const items = catalogMenuItems({
      onOpen: run,
      href: '/scenes/loft',
      use: { label: 'Use in a shot', run },
      keep: { on: true, run },
    });
    const mark = items.find((it) => it.key === 'keep');
    expect(mark?.label).toBe('Remove from Keepers');
    expect(mark?.icon).toBe('kept');
  });

  it('lets a scene you own be selected and kept, then deleted', () => {
    const items = catalogMenuItems({
      onOpen: run,
      href: '/scenes/mine',
      use: { label: 'Use in a shot', run },
      select: { run },
      keep: { on: false, run },
      remove: { label: 'Delete scene', run },
    });
    expect(items.map((it) => it.label)).toEqual([
      'Open',
      'Open in new tab',
      'Use in a shot',
      'Select',
      'Add to Keepers',
      'Delete scene',
    ]);
    const del = items.at(-1);
    expect(del?.danger).toBe(true);
    expect(del?.separated).toBe(true);
  });

  it('keeps a library presenter to open, use, and Keepers', () => {
    const items = catalogMenuItems({
      onOpen: run,
      href: '/presenters/noa',
      use: { label: 'Use in a shot', run },
      keep: { on: false, run },
    });
    expect(items.map((it) => it.label)).toEqual(['Open', 'Open in new tab', 'Use in a shot', 'Add to Keepers']);
    expect(items.some((it) => it.key === 'delete' || it.key === 'select')).toBe(false);
  });

  it('adds select, Keepers, duplicate, edit, and delete to a presenter you own', () => {
    const items = catalogMenuItems({
      onOpen: run,
      href: '/presenters/mine',
      use: { label: 'Use in a shot', run },
      select: { run },
      keep: { on: false, run },
      onDuplicate: run,
      onEdit: run,
      remove: { label: 'Delete presenter', run },
    });
    expect(items.map((it) => it.label)).toEqual([
      'Open',
      'Open in new tab',
      'Use in a shot',
      'Select',
      'Add to Keepers',
      'Duplicate presenter',
      'Edit presenter',
      'Delete presenter',
    ]);
    expect(items.at(-1)?.danger).toBe(true);
    expect(items.find((it) => it.key === 'duplicate')?.separated).toBeUndefined();
  });

  it('lets a draft be selected, then discarded', () => {
    const items = catalogMenuItems({
      draft: { onContinue: run, href: '/studio/d1', onDiscard: run },
      select: { run },
    });
    expect(items.map((it) => it.label)).toEqual(['Continue', 'Open in new tab', 'Select', 'Discard']);
    expect(items.at(-1)?.danger).toBe(true);
    expect(items.at(-1)?.separated).toBe(true);
  });

  it('renames a record you own, and leaves a library card alone', () => {
    const owned = catalogMenuItems({
      onOpen: run,
      href: '/products/mine',
      use: { label: 'Use in a shot', run },
      keep: { on: false, run },
      onRename: run,
      remove: { label: 'Delete product', run },
    });
    expect(owned.map((it) => it.label)).toEqual([
      'Open',
      'Open in new tab',
      'Use in a shot',
      'Add to Keepers',
      'Rename',
      'Delete product',
    ]);
    expect(owned.find((it) => it.key === 'rename')?.icon).toBe('rename');
    expect(owned.at(-1)?.separated).toBe(true);
    const library = catalogMenuItems({
      onOpen: run,
      href: '/products/demo',
      use: { label: 'Use in a shot', run },
      keep: { on: false, run },
    });
    expect(library.some((it) => it.key === 'rename')).toBe(false);
  });

  it('lets you delete a product you own, and keep it', () => {
    const items = catalogMenuItems({
      onOpen: run,
      href: '/products/mine',
      use: { label: 'Use in a shot', run },
      select: { run },
      keep: { on: false, run },
      remove: { label: 'Delete product', run },
    });
    expect(items.map((it) => it.label)).toEqual([
      'Open',
      'Open in new tab',
      'Use in a shot',
      'Select',
      'Add to Keepers',
      'Delete product',
    ]);
    expect(items.at(-1)?.danger).toBe(true);
  });

  it('keeps a Scenri product to open, use, and Keepers, with no tick', () => {
    const items = catalogMenuItems({
      onOpen: run,
      href: '/products/demo',
      use: { label: 'Use in a shot', run },
      keep: { on: false, run },
    });
    expect(items.map((it) => it.label)).toEqual(['Open', 'Open in new tab', 'Use in a shot', 'Add to Keepers']);
    expect(items.some((it) => it.key === 'select' || it.key === 'delete')).toBe(false);
  });

  it('is one line on the Home shelf', () => {
    const items = catalogMenuItems({ only: { label: 'Use in a shot', run } });
    expect(items.map((it) => it.label)).toEqual(['Use in a shot']);
  });

  it('is one line for an example', () => {
    const items = catalogMenuItems({ only: { label: 'Recreate this', run } });
    expect(items.map((it) => it.label)).toEqual(['Recreate this']);
    expect(items[0]?.icon).toBe('use');
  });

  it('opens the record in a new tab from the line that says so', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const items = catalogMenuItems({ onOpen: run, href: '/scenes/loft' });
    items.find((it) => it.key === 'open-tab')?.onSelect();
    expect(open).toHaveBeenCalledWith('/scenes/loft', '_blank');
    open.mockRestore();
  });
});
