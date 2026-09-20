import { describe, expect, it } from 'vitest';
import type { Brand } from '../src/api.js';
import { acceptsBrand, applyBrandRow, mergeBrandList } from '../src/app/brandRows.js';

/** A brand row with only what these rules read, plus the scenes it holds. */
const row = (id: string, updatedAt: string, scenes: string[] = []): Brand =>
  ({ id, slug: id, updatedAt, createdAt: '2026-09-01 00:00:00', json: { meta: { name: id }, scenes } }) as Brand;
const scenesOf = (list: Brand[], id: string) => (list.find((b) => b.id === id)?.json as any)?.scenes;

describe('a mutation answer replacing the row held for its brand', () => {
  it('takes a newer answer', () => {
    expect(acceptsBrand(row('a', '2026-09-19 10:00:00.100'), row('a', '2026-09-19 10:00:00.200'))).toBe(true);
  });

  it('takes the same write answered twice', () => {
    expect(acceptsBrand(row('a', '2026-09-19 10:00:00.100'), row('a', '2026-09-19 10:00:00.100'))).toBe(true);
  });

  // A rename answered after the delete that followed it: the scene must stay gone.
  it('refuses an answer about an older write that crossed a newer one', () => {
    const afterDelete = row('a', '2026-09-19 10:00:00.300', []);
    const list = applyBrandRow([afterDelete], row('a', '2026-09-19 10:00:00.200', ['us-1']));
    expect(scenesOf(list, 'a')).toEqual([]);
  });

  it('orders a millisecond stamp after the second-precision stamp it follows', () => {
    // Rows written before stamps carried milliseconds compare as their prefix.
    expect(acceptsBrand(row('a', '2026-09-19 10:00:00'), row('a', '2026-09-19 10:00:00.000'))).toBe(true);
    expect(acceptsBrand(row('a', '2026-09-19 10:00:00.999'), row('a', '2026-09-19 10:00:00'))).toBe(false);
    expect(acceptsBrand(row('a', '2026-09-19 10:00:00.999'), row('a', '2026-09-19 10:00:01'))).toBe(true);
  });

  it('leaves the other brands exactly as they were, and ignores a brand it does not hold', () => {
    const b = row('b', '2026-09-19 09:00:00.000', ['us-b']);
    const list = [row('a', '2026-09-19 10:00:00.000'), b];
    const next = applyBrandRow(list, row('a', '2026-09-19 10:00:01.000', ['us-new']));
    expect(next[1]).toBe(b);
    expect(applyBrandRow(list, row('zzz', '2026-09-19 11:00:00.000'))).toBe(list);
  });
});

describe('a re-read of the whole list landing after local writes', () => {
  // The resurrection, as a rule: a read started, the scene was deleted and the
  // delete's answer applied, then the read landed carrying the scene.
  it('never brings back what a delete applied after the read started removed', () => {
    const held = [row('a', '2026-09-19 10:00:02.000', [])];
    const staleRead = [row('a', '2026-09-19 10:00:01.000', ['us-deleted'])];
    const merged = mergeBrandList(held, staleRead, new Set(['a']));
    expect(scenesOf(merged, 'a')).toEqual([]);
  });

  it('takes the read for a touched row when the read saw a later write still', () => {
    // A build landed on the server after the delete; the read is the newer truth.
    const held = [row('a', '2026-09-19 10:00:02.000', [])];
    const read = [row('a', '2026-09-19 10:00:03.000', ['us-built'])];
    expect(scenesOf(mergeBrandList(held, read, new Set(['a'])), 'a')).toEqual(['us-built']);
  });

  it('takes the read for every row nobody touched, whatever the clocks say', () => {
    // A clock that stepped backwards must not wedge a brand on its old row.
    const held = [row('a', '2026-09-19 10:00:09.000', ['us-old'])];
    const read = [row('a', '2026-09-19 09:00:00.000', ['us-truth'])];
    expect(scenesOf(mergeBrandList(held, read, new Set()), 'a')).toEqual(['us-truth']);
  });

  it('lets the read decide which brands exist', () => {
    const held = [row('a', '2026-09-19 10:00:00.000'), row('gone', '2026-09-19 10:00:00.000')];
    const read = [row('a', '2026-09-19 10:00:00.000'), row('new', '2026-09-19 10:00:00.000')];
    expect(mergeBrandList(held, read, new Set()).map((b) => b.id)).toEqual(['a', 'new']);
  });

  it('keeps the brand on screen in step with a create applied while the read was out', () => {
    const held = [row('a', '2026-09-19 10:00:05.000', ['us-1', 'us-2'])];
    const read = [row('a', '2026-09-19 10:00:04.000', ['us-1'])];
    expect(scenesOf(mergeBrandList(held, read, new Set(['a'])), 'a')).toEqual(['us-1', 'us-2']);
  });

  it('takes the first answer whole', () => {
    const read = [row('a', '2026-09-19 10:00:00.000')];
    expect(mergeBrandList(null, read, new Set())).toBe(read);
  });

  it('hands back the list it already holds when the read changed nothing', () => {
    const a = row('a', '2026-09-19 10:00:00.000');
    const held = [a];
    expect(mergeBrandList(held, [a], new Set())).toBe(held);
  });
});
