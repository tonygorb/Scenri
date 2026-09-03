import { describe, it, expect, beforeEach } from 'vitest';
import {
  CHIP,
  closeIcon,
  encode,
  moveAnnouncement,
  moveChipBy,
  moveChipToUnits,
  gapStartUnits,
  moveSlots,
  moveSlotsFor,
  readLine,
  removeChip,
  renderLine,
  snapAfter,
  snapToSlot,
  type SentenceToken,
} from '../src/composer/line.js';

let root: HTMLDivElement;

/** A chip the way BriefInput builds one: an atom with a label and a remove button. */
function chipFor(t: SentenceToken): HTMLElement {
  const el = document.createElement('span');
  el.className = CHIP;
  el.contentEditable = 'false';
  el.dataset.kind = t.t;
  el.dataset.tok = encode(t);
  // The real chip (BriefInput.chipFor) keeps its words in a label span
  // with its own direction; the readers under test look for that span.
  const text = document.createElement('span');
  text.className = 'sc-token-label';
  text.textContent = labelOf(t);
  el.appendChild(text);
  const x = document.createElement('button');
  x.dataset.role = 'remove';
  x.appendChild(closeIcon());
  el.appendChild(x);
  return el;
}

const labelOf = (t: SentenceToken): string =>
  t.t === 'product' ? `P:${t.id}` : t.t === 'character' ? `H:${t.id}` : t.t === 'text' ? t.v : t.t;

const chips = () => Array.from(root.querySelectorAll<HTMLElement>(`.${CHIP}`));
const order = () => readLine(root).map((t) => (t.t === 'text' ? JSON.stringify(t.v) : `<${t.t}:${idOf(t)}>`));
const idOf = (t: SentenceToken): string => ('id' in t ? t.id : '');

beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement('div');
  root.contentEditable = 'true';
  document.body.appendChild(root);
});

const seed = (tokens: SentenceToken[]) => renderLine(root, tokens, chipFor);

describe('moveSlots', () => {
  it('offers the start, the end, chip edges and word boundaries', () => {
    // "on a |P| desk" — units: o0 n1 ' '2 a3 ' '4 [chip]5 ' '6 d7..k10, end 11
    const tokens: SentenceToken[] = [
      { t: 'text', v: 'on a ' },
      { t: 'product', id: 'p1' },
      { t: 'text', v: ' desk' },
    ];
    const slots = moveSlots(tokens);
    for (const s of [0, 3, 5, 7, 11]) expect(slots).toContain(s);
    // never inside a word
    for (const s of [1, 2, 8, 9, 10]) expect(slots).not.toContain(s);
    // and never the chip's trailing edge when a space follows it: 6 and 7
    // land the chip in the same place, and one gap offers one slot
    expect(slots).not.toContain(6);
  });

  it('offers one slot per gap between two chips', () => {
    // "|A| |B|" — units: [A]0 ' '1 [B]2, end 3. The gap between them is one
    // place to land, not the two unit positions either side of its space.
    const tokens: SentenceToken[] = [
      { t: 'product', id: 'a' },
      { t: 'text', v: ' ' },
      { t: 'product', id: 'b' },
    ];
    expect(moveSlots(tokens)).toEqual([0, 2, 3]);
  });

  it('never offers the inside of a word', () => {
    for (const s of moveSlots([{ t: 'text', v: 'wide field' }])) {
      expect([0, 5, 10]).toContain(s);
    }
  });

  it('excludes the moving chip’s own two edges', () => {
    const tokens: SentenceToken[] = [
      { t: 'text', v: 'on ' },
      { t: 'product', id: 'p1' },
      { t: 'text', v: ' desk' },
    ];
    // chip sits at units 3..4
    expect(moveSlotsFor(tokens, 3)).toEqual([0, 9]);
  });

  it('snapAfter resolves upward, so "after the last chip of a row" never lands before it', () => {
    // "|A| |B|" — slots [0, 2, 3]; a drop just after B is raw 3, after A is raw 1
    expect(snapAfter([0, 2, 3], 1)).toBe(2);
    expect(snapAfter([0, 2, 3], 3)).toBe(3);
    expect(snapAfter([0, 2, 3], 9)).toBe(3);
    expect(snapAfter([], 1)).toBeNull();
  });

  it('snapToSlot picks the nearest, ties to the earlier', () => {
    expect(snapToSlot([0, 4, 10], 6)).toBe(4);
    expect(snapToSlot([0, 4, 10], 7)).toBe(4);
    expect(snapToSlot([0, 4, 10], 8)).toBe(10);
    expect(snapToSlot([], 3)).toBeNull();
  });
});

describe('gapStartUnits', () => {
  it('finds the other edge of the whitespace gap a slot stands in', () => {
    // "|A||B| on desk" — units: [A]0 [B]1 ' '2 o3 n4 ' '5 d6; the guard between
    // the chips counts as nothing, so there is no gap to walk back through
    seed([
      { t: 'product', id: 'a' },
      { t: 'product', id: 'b' },
      { t: 'text', v: ' on desk' },
    ]);
    expect(gapStartUnits(root, 1)).toBe(1); // before B: no whitespace, no walk
    expect(gapStartUnits(root, 6)).toBe(5); // before "desk"
    expect(gapStartUnits(root, 0)).toBe(0); // the start has no gap before it
    expect(gapStartUnits(root, 3)).toBe(2); // before "on"
    expect(gapStartUnits(null, 5)).toBe(5);
  });
});

describe('moveChipToUnits', () => {
  it('moves a chip into the middle of the prose, at a word boundary', () => {
    seed([
      { t: 'text', v: 'hero on a desk ' },
      { t: 'product', id: 'p1' },
    ]);
    // target the word boundary after "hero " (unit 5)
    expect(moveChipToUnits(root, chips()[0], 5)).toBe(true);
    expect(order()).toEqual(['"hero "', '<product:p1>', '"on a desk "']);
  });

  it('moves a chip to the very start and the very end', () => {
    seed([
      { t: 'text', v: 'wide field ' },
      { t: 'product', id: 'p1' },
      { t: 'text', v: ' shot' },
    ]);
    expect(moveChipToUnits(root, chips()[0], 0)).toBe(true);
    // the two spaces that stood either side of the chip now meet: both the user's
    expect(order()).toEqual(['<product:p1>', '"wide field  shot"']);
    const total = readLine(root).reduce((n, t) => n + (t.t === 'text' ? t.v.length : 1), 0);
    expect(moveChipToUnits(root, chips()[0], total)).toBe(true);
    expect(order()).toEqual(['"wide field  shot"', '<product:p1>']);
  });

  it('refuses its own edges as a no-op', () => {
    seed([
      { t: 'text', v: 'on ' },
      { t: 'product', id: 'p1' },
      { t: 'text', v: ' desk' },
    ]);
    const before = order();
    expect(moveChipToUnits(root, chips()[0], 3)).toBe(false);
    expect(moveChipToUnits(root, chips()[0], 4)).toBe(false);
    expect(order()).toEqual(before);
  });

  it('moves across another chip and keeps node identity', () => {
    seed([
      { t: 'product', id: 'p1' },
      { t: 'text', v: ' beside ' },
      { t: 'character', id: 'c1' },
    ]);
    const [p, c] = chips();
    p.dataset.uid = 'stable';
    const total = readLine(root).reduce((n, t) => n + (t.t === 'text' ? t.v.length : 1), 0);
    expect(moveChipToUnits(root, p, total)).toBe(true);
    expect(order().filter((s) => s.startsWith('<'))).toEqual(['<character:c1>', '<product:p1>']);
    // the same node moved, never a rebuilt copy
    expect(chips().find((el) => el.dataset.uid === 'stable')).toBeTruthy();
    expect(chips()).toContain(c);
  });

  it('leaves the prose exactly as it was wherever it lands', () => {
    seed([
      { t: 'text', v: 'a marble hall ' },
      { t: 'product', id: 'p1' },
    ]);
    moveChipToUnits(root, chips()[0], 2);
    expect(order()).toEqual(['"a "', '<product:p1>', '"marble hall "']);
  });
});

describe('reorder then remove', () => {
  it('removes the chip that just moved, not a neighbour', () => {
    seed([
      { t: 'text', v: 'a b ' },
      { t: 'product', id: 'p1' },
      { t: 'text', v: ' c ' },
      { t: 'character', id: 'c1' },
    ]);
    const c = chips()[1];
    expect(moveChipToUnits(root, c, 0)).toBe(true);
    expect(order()[0]).toBe('<character:c1>');
    removeChip(root, c);
    expect(order().filter((s) => s.startsWith('<'))).toEqual(['<product:p1>']);
  });

  it('keeps a moved chip in place when another chip is removed', () => {
    seed([
      { t: 'product', id: 'p1' },
      { t: 'text', v: ' beside ' },
      { t: 'character', id: 'c1' },
      { t: 'text', v: ' end' },
    ]);
    const [p, c] = chips();
    const total = readLine(root).reduce((n, t) => n + (t.t === 'text' ? t.v.length : 1), 0);
    expect(moveChipToUnits(root, p, total)).toBe(true);
    removeChip(root, c);
    expect(order().filter((s) => s.startsWith('<'))).toEqual(['<product:p1>']);
    // the survivor is the same node that moved, never a rebuilt copy
    expect(chips()).toContain(p);
  });
});

describe('moveChipBy', () => {
  it('steps left and right one slot at a time, clamping at the ends', () => {
    seed([
      { t: 'text', v: 'one two ' },
      { t: 'product', id: 'p1' },
    ]);
    const chip = () => chips()[0];
    expect(moveChipBy(root, chip(), -1)).toBe(true);
    expect(order()).toEqual(['"one "', '<product:p1>', '"two "']);
    expect(moveChipBy(root, chip(), -1)).toBe(true);
    expect(order()[0]).toBe('<product:p1>');
    expect(moveChipBy(root, chip(), -1)).toBe(false);
    // and all the way back
    expect(moveChipBy(root, chip(), 1)).toBe(true);
    expect(order()).toEqual(['"one "', '<product:p1>', '"two "']);
    expect(moveChipBy(root, chip(), 1)).toBe(true);
    expect(order()).toEqual(['"one two "', '<product:p1>']);
    expect(moveChipBy(root, chip(), 1)).toBe(false);
  });
});

describe('moveAnnouncement', () => {
  it('names what now stands beside the chip', () => {
    seed([
      { t: 'product', id: 'p1' },
      { t: 'text', v: ' on a long marble counter' },
    ]);
    expect(moveAnnouncement(root, chips()[0])).toBe('Moved P:p1 before "on a long".');
  });

  it('falls back to the ends of the brief when nothing stands beside it', () => {
    seed([{ t: 'product', id: 'p1' }]);
    expect(moveAnnouncement(root, chips()[0])).toBe('Moved P:p1 to the start of the brief.');
  });

  it('names a neighbouring chip by its label', () => {
    seed([
      { t: 'product', id: 'p1' },
      { t: 'character', id: 'c1' },
    ]);
    expect(moveAnnouncement(root, chips()[0])).toBe('Moved P:p1 before H:c1.');
  });
});

/**
 * The unit space and the DOM are not the same ruler.
 *
 * A unit counts a guard as nothing, a DOM offset counts it as a character.
 * `moveChipToUnits` walks in units and then splits a text node, so the two
 * have to be converted between; today `normalizeLine` keeps a text node either
 * pure guard or guard-free, which makes them agree by accident. The line
 * built here breaks that accident on purpose, the way a browser can mid-edit,
 * and the drop still lands on the character it was aimed at.
 */
describe('moveChipToUnits counts in units, not in DOM offsets', () => {
  it('lands on the aimed character even when a guard shares the text node', () => {
    seed([
      { t: 'text', v: 'one two ' },
      { t: 'product', id: 'p1' },
    ]);
    const chip = root.querySelector<HTMLElement>(`.${CHIP}`)!;
    // a guard welded onto the front of the prose: legal DOM, and exactly what
    // normalizeLine would tidy away if it ran
    const prose = root.firstChild as Text;
    prose.textContent = `\ufeff${prose.textContent ?? ''}`;

    // unit 4 is the boundary after "one ", which is DOM offset 5 here
    expect(moveChipToUnits(root, chip, 4)).toBe(true);
    expect(readLine(root).map((t) => (t.t === 'text' ? t.v : '<chip>'))).toEqual(['one ', '<chip>', 'two ']);
  });
});
