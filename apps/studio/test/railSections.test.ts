import { describe, it, expect } from 'vitest';
import {
  NO_ATTACHMENTS,
  RAIL_COMPACT,
  RAIL_EXPANDED,
  attachedIdsKey,
  attachedIdsOf,
  railSlice,
} from '../src/layout/railSections.js';
import type { SentenceToken } from '../src/composer/line.js';

const text = (v: string): SentenceToken => ({ t: 'text', v });
const tiles = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `i${i}` }));
const ids = <T extends { id: string }>(xs: T[]) => xs.map((x) => x.id);

describe('attachedIdsOf', () => {
  it('reads nothing out of a brief that is only words', () => {
    expect(attachedIdsOf([text('a candle on a sill')])).toEqual(NO_ATTACHMENTS);
  });

  it('collects each kind in the order it appears', () => {
    const a = attachedIdsOf([
      { t: 'product', id: 'p1' },
      text(' with '),
      { t: 'character', id: 'c1' },
      { t: 'template', id: 's1' },
      { t: 'product', id: 'p2' },
    ]);
    expect(a).toEqual({ product: ['p1', 'p2'], presenter: ['c1'], scene: 's1', ref: [], color: [] });
  });

  it('keeps one scene only — the brief swaps templates rather than appending', () => {
    const a = attachedIdsOf([
      { t: 'template', id: 'first' },
      { t: 'template', id: 'second' },
    ]);
    expect(a.scene).toBe('second');
  });

  it('does not double-count a product attached twice', () => {
    const a = attachedIdsOf([
      { t: 'product', id: 'p1' },
      { t: 'product', id: 'p1' },
    ]);
    expect(a.product).toEqual(['p1']);
  });

  it('reads colours and references too; only a mark has no rail tile', () => {
    const a = attachedIdsOf([
      { t: 'color', hex: '#fff' },
      { t: 'ref', imageHash: 'h' },
      { t: 'mark', imageHash: 'm' },
    ]);
    expect(a).toEqual({ product: [], presenter: [], scene: null, ref: ['h'], color: ['#fff'] });
    expect(attachedIdsOf([{ t: 'mark', imageHash: 'm' }])).toEqual(NO_ATTACHMENTS);
  });
});

describe('attachedIdsKey', () => {
  it('is stable while only the words around the chips change', () => {
    const a = attachedIdsOf([text('one'), { t: 'product', id: 'p1' }]);
    const b = attachedIdsOf([text('one two three'), { t: 'product', id: 'p1' }]);
    expect(attachedIdsKey(a)).toBe(attachedIdsKey(b));
  });

  it('changes the moment an asset does', () => {
    const a = attachedIdsOf([{ t: 'product', id: 'p1' }]);
    const b = attachedIdsOf([{ t: 'product', id: 'p2' }]);
    expect(attachedIdsKey(a)).not.toBe(attachedIdsKey(b));
  });

  it('tells an empty brief apart from a scene-only one', () => {
    expect(attachedIdsKey(NO_ATTACHMENTS)).not.toBe(attachedIdsKey(attachedIdsOf([{ t: 'template', id: 's' }])));
  });

  it('reads references by hash and colours by hex, once each, so the rail can tick and untick them', () => {
    const a = attachedIdsOf([
      { t: 'ref', imageHash: 'h1' },
      { t: 'color', hex: '#D96C3B', name: 'Terracotta' },
      { t: 'ref', imageHash: 'h1' },
      { t: 'color', hex: '#d96c3b' },
    ]);
    expect(a.ref).toEqual(['h1']);
    expect(a.color).toEqual(['#d96c3b']);
    expect(attachedIdsKey(a)).not.toBe(attachedIdsKey(NO_ATTACHMENTS));
    expect(attachedIdsKey(attachedIdsOf([{ t: 'ref', imageHash: 'h1' }]))).not.toBe(
      attachedIdsKey(attachedIdsOf([{ t: 'ref', imageHash: 'h2' }])),
    );
  });
});

describe('railSlice', () => {
  const none = new Set<string>();

  it('draws the quick row and counts the rest', () => {
    const { visible, more } = railSlice(tiles(620), none, RAIL_COMPACT);
    expect(visible).toHaveLength(4);
    expect(more).toBe(616);
  });

  it('draws more when opened out', () => {
    const { visible, more } = railSlice(tiles(620), none, RAIL_EXPANDED);
    expect(visible).toHaveLength(24);
    expect(more).toBe(596);
  });

  it('fills an opened pane rather than leaving a hole under the last row', () => {
    // Three across, so the opened count has to be a whole number of rows or
    // the last one comes out ragged.
    expect(RAIL_EXPANDED % 3).toBe(0);
    expect(RAIL_EXPANDED).toBeGreaterThan(RAIL_COMPACT);
  });

  it('has no "more" tile when everything already fits', () => {
    expect(railSlice(tiles(3), none, RAIL_COMPACT).more).toBe(0);
    expect(railSlice(tiles(4), none, RAIL_COMPACT).more).toBe(0);
  });

  it('survives an empty catalog', () => {
    expect(railSlice([], none, RAIL_COMPACT)).toEqual({ visible: [], more: 0 });
  });

  it('keeps the ranked order whatever is attached: a tick never re-deals the row', () => {
    // an attached asset far down the list stays there, ticked where it sits
    const { visible } = railSlice(tiles(100), new Set(['i77']), RAIL_COMPACT);
    expect(ids(visible)).toEqual(['i0', 'i1', 'i2', 'i3']);
    const several = railSlice(tiles(100), new Set(['i50', 'i9', 'i1']), RAIL_COMPACT);
    expect(ids(several.visible)).toEqual(['i0', 'i1', 'i2', 'i3']);
    expect(several.more).toBe(96);
  });

  it('leaves the order alone when nothing is attached', () => {
    expect(ids(railSlice(tiles(10), none, RAIL_COMPACT).visible)).toEqual(['i0', 'i1', 'i2', 'i3']);
  });

  it('does not mutate the list it was handed', () => {
    const items = tiles(10);
    railSlice(items, new Set(['i8']), RAIL_COMPACT);
    expect(ids(items)[0]).toBe('i0');
  });
});
