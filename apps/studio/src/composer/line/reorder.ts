import type { SentenceToken } from './tokens.js';
import { GUARD_RE, lengthOf, offsetIn, unitsOfPosition } from './caret.js';
import { unitsBeforeChip } from './insert.js';
import { isChip, normalizeLine } from './invariants.js';
import { chipLabel } from './clipboard.js';
import { pointToLinePosition } from './query.js';

// ---------------------------------------------------------------- reordering
//
// Chip order is semantics, not presentation: the compiler writes the prompt in
// token order, and the attachment budget breaks ties by position. So a reorder
// is a real DOM move followed by the same normalize-and-emit path every other
// structural edit takes — never a visual-only shuffle.

/**
 * Every legal landing position for a chip, in caret units: the start, the end,
 * both sides of every chip, and each word boundary inside the text runs. A
 * chip is an atom, so nothing can land inside one; a word is one too — a chip
 * dropped mid-word would weld its spaces into the word's letters.
 */
export function moveSlots(tokens: SentenceToken[]): number[] {
  const slots = new Set<number>([0]);
  let u = 0;
  for (const t of tokens) {
    if (t.t !== 'text') {
      slots.add(u);
      u += 1;
      slots.add(u);
      continue;
    }
    for (let i = 0; i < t.v.length; i++) {
      if (t.v[i] === ' ' || t.v[i] === '\n') slots.add(u + i + 1);
    }
    u += t.v.length;
  }
  slots.add(u);
  const sorted = [...slots].sort((a, b) => a - b);
  // One slot per gap. A chip's trailing edge and the boundary after the
  // space that follows it are two unit positions four pixels apart that land
  // a chip in exactly the same place, and a drag snapping between them drew
  // two carets flickering side by side. Where nothing but whitespace
  // separates two slots, the later one stands for both: the same side a
  // word boundary already sits on, right before the next thing.
  const flat = flatOf(tokens);
  return sorted.filter((s, i) => i === sorted.length - 1 || !/^[ \n]*$/.test(flat.slice(s, sorted[i + 1])));
}

/**
 * The line as a flat string, chips as a sentinel character, so "is there
 * anything but whitespace between here and there" is a substring question.
 */
const flatOf = (tokens: SentenceToken[]): string => tokens.map((t) => (t.t === 'text' ? t.v : '\u0001')).join('');

/** True when landing at `slot` leaves the token order exactly as it stands. */
const noopSlot = (flat: string, chipUnits: number, slot: number): boolean => {
  const between = slot <= chipUnits ? flat.slice(slot, chipUnits) : flat.slice(chipUnits + 1, slot);
  return /^[ \n]*$/.test(between);
};

/**
 * The slots that would actually move this chip. Its own edges are no-ops, and
 * so is anything separated from it by nothing but whitespace: dropping a chip
 * on the far side of its own following space changes no order at all.
 */
export function moveSlotsFor(tokens: SentenceToken[], chipUnits: number): number[] {
  const flat = flatOf(tokens);
  return moveSlots(tokens).filter((s) => !noopSlot(flat, chipUnits, s));
}

/** The first legal slot at or past a raw unit position: what "after this" means. */
export function snapAfter(slots: number[], units: number): number | null {
  return slots.find((s) => s >= units) ?? (slots.length ? slots[slots.length - 1] : null);
}

/** The nearest legal slot to a raw unit position; ties resolve earlier. */
export function snapToSlot(slots: number[], units: number): number | null {
  let best: number | null = null;
  let gap = Infinity;
  for (const s of slots) {
    const d = Math.abs(s - units);
    if (d < gap) {
      gap = d;
      best = s;
    }
  }
  return best;
}

/**
 * Move a chip to a unit position, measured against the line AS IT STANDS
 * (the chip still in place). The one DOM mutation of the reorder feature:
 * resolve the insertion point, lift the chip, put it back, normalize. The
 * chip node itself survives — same uid, same listeners, an open sheet
 * anchored to it stays valid.
 */
export function moveChipToUnits(root: HTMLElement | null, chip: HTMLElement, targetUnits: number): boolean {
  if (!root || !chip.parentNode) return false;
  const at = unitsBeforeChip(root, chip);
  if (noopSlot(flatOf(readTokensLite(root)), at, targetUnits)) return false;

  // resolve BEFORE lifting the chip: the reference stays valid across removal
  let ref: ChildNode | null = null;
  let n = 0;
  for (const c of Array.from(root.childNodes)) {
    const len = lengthOf(c);
    if (targetUnits <= n + len) {
      if (c.nodeType === Node.TEXT_NODE) {
        const units = targetUnits - n;
        if (units <= 0) ref = c;
        else if (units >= len) ref = c.nextSibling;
        // `units` counts characters the way the whole line does, guards as
        // nothing; splitText wants a DOM offset. They agree only while a text
        // node is either pure guard or guard-free, which normalizeLine
        // happens to guarantee from another file. Converting says so here,
        // and is the same pair every other walk uses.
        else ref = (c as Text).splitText(offsetIn(c as Text, units));
      } else {
        ref = targetUnits === n ? c : c.nextSibling;
      }
      break;
    }
    n += len;
  }
  if (ref === chip) return false;

  chip.remove();
  root.insertBefore(chip, ref);
  normalizeLine(root);
  return true;
}

/**
 * Step a chip one legal slot left or right. The keyboard path (Alt+Arrow) and
 * the touch sheet's Move buttons both come through here.
 */
export function moveChipBy(root: HTMLElement | null, chip: HTMLElement, dir: -1 | 1): boolean {
  if (!root) return false;
  const at = unitsBeforeChip(root, chip);
  const slots = moveSlotsFor(readTokensLite(root), at);
  const target = dir === -1 ? [...slots].reverse().find((s) => s < at) : slots.find((s) => s > at + 1);
  if (target === undefined) return false;
  return moveChipToUnits(root, chip, target);
}

/**
 * Where the whitespace run ending at `units` begins, in units: the other edge
 * of the gap a slot stands in. A slot sits right before the next thing, so
 * the drop caret drawn exactly there hugs that thing; drawn at the middle of
 * the gap it sits with the same air on both sides. Equal to `units` when no
 * whitespace precedes it.
 */
export function gapStartUnits(root: HTMLElement | null, units: number): number {
  if (!root) return units;
  const flat = flatOf(readTokensLite(root));
  let start = units;
  while (start > 0 && (flat[start - 1] === ' ' || flat[start - 1] === '\n')) start -= 1;
  return start;
}

/**
 * A drop point as a snapped unit position, or null when the point resolves to
 * nothing the line owns. Chip-band points land on the chip's own edge; text
 * points snap to the nearest word boundary. `noop` is true when dropping there
 * would change nothing — the drag hides its indicator instead of promising a
 * move that will not happen.
 */
export function dropUnitsAt(
  root: HTMLElement | null,
  chip: HTMLElement,
  x: number,
  y: number,
): { units: number; noop: boolean } | null {
  if (!root) return null;
  const pos = pointToLinePosition(root, x, y);
  if (!pos) return null;
  const tokens = readTokensLite(root);
  const at = unitsBeforeChip(root, chip);
  const slots = moveSlots(tokens);
  const raw =
    'beside' in pos
      ? unitsBeforeChip(root, pos.beside) + (pos.side === 'before' ? 0 : 1)
      : pos.node.nodeType === Node.TEXT_NODE || pos.node === root
        ? unitsOfPosition(root, pos.node, pos.offset)
        : null;
  if (raw === null) return null;
  // Landing after a chip means after it: the slot at its trailing edge folded
  // into the one past its following space (one slot per gap), and the
  // nearest-slot tie would have handed the drop back to the slot before the
  // chip. So an "after" resolves upward to the first slot at or past it.
  const snapped = 'beside' in pos && pos.side === 'after' ? snapAfter(slots, raw) : snapToSlot(slots, raw);
  if (snapped === null) return null;
  return { units: snapped, noop: noopSlot(flatOf(tokens), at, snapped) };
}

/**
 * What the move did, for the live region: where the chip now sits, said in
 * terms of what stands beside it. Read AFTER the move, from the chip's own
 * neighbours, so the sentence can never disagree with the line.
 */
export function moveAnnouncement(root: HTMLElement, chip: HTMLElement): string {
  const label = chipLabel(chip) || 'the chip';
  const next = nextThing(chip);
  if (next) return `Moved ${label} before ${next}.`;
  const prev = prevThing(chip);
  if (prev) return `Moved ${label} after ${prev}.`;
  return unitsBeforeChip(root, chip) === 0
    ? `Moved ${label} to the start of the brief.`
    : `Moved ${label} to the end of the brief.`;
}

const WORDS_AROUND = 3;

function nextThing(chip: HTMLElement): string | null {
  for (let n = chip.nextSibling; n; n = n.nextSibling) {
    if (isChip(n)) return chipLabel(n as HTMLElement) || null;
    const words = (n.textContent ?? '').replace(GUARD_RE, '').trim();
    if (words) return `"${words.split(/\s+/).slice(0, WORDS_AROUND).join(' ')}"`;
  }
  return null;
}

function prevThing(chip: HTMLElement): string | null {
  for (let n = chip.previousSibling; n; n = n.previousSibling) {
    if (isChip(n)) return chipLabel(n as HTMLElement) || null;
    // stripped like its mirror above: trim() only eats a guard today because
    // U+FEFF happens to be whitespace, which is not a rule this line relies on
    const words = (n.textContent ?? '').replace(GUARD_RE, '').trim();
    if (words) return `"${words.split(/\s+/).slice(-WORDS_AROUND).join(' ')}"`;
  }
  return null;
}

/**
 * The token stream for slot math, straight off the children.
 *
 * Deliberately not `readLine`, and not for an import reason: `readLine` folds
 * stray markup (a pasted span, a stray `<br>`) into the text buffer, while
 * every slot and drop number is counted in the units `lengthOf` speaks, where
 * any non-text child is one. Reading the line the other way would put these
 * string indices out of step with `unitsBeforeChip` on any line the browser
 * has left markup in.
 */
function readTokensLite(root: HTMLElement): SentenceToken[] {
  const out: SentenceToken[] = [];
  let buf = '';
  for (const n of Array.from(root.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE) {
      buf += (n.textContent ?? '').replace(GUARD_RE, '');
      continue;
    }
    if (buf) {
      out.push({ t: 'text', v: buf });
      buf = '';
    }
    // any non-text child occupies one unit, chip or stray markup alike
    out.push({ t: 'ref', imageHash: '' });
  }
  if (buf) out.push({ t: 'text', v: buf });
  return out;
}
