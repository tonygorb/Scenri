import type { SentenceToken } from './tokens.js';
import { lengthOf, unitsOfPosition } from './caret.js';
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
  return [...slots].sort((a, b) => a - b);
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
        const offset = targetUnits - n;
        if (offset <= 0) ref = c;
        else if (offset >= len) ref = c.nextSibling;
        else ref = (c as Text).splitText(offset);
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
  const snapped = snapToSlot(slots, raw);
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
    const words = (n.textContent ?? '').trim();
    if (words) return `"${words.split(/\s+/).slice(0, WORDS_AROUND).join(' ')}"`;
  }
  return null;
}

function prevThing(chip: HTMLElement): string | null {
  for (let n = chip.previousSibling; n; n = n.previousSibling) {
    if (isChip(n)) return chipLabel(n as HTMLElement) || null;
    const words = (n.textContent ?? '').trim();
    if (words) return `"${words.split(/\s+/).slice(-WORDS_AROUND).join(' ')}"`;
  }
  return null;
}

/**
 * The token stream for slot math, straight off the children. A local copy of
 * readLine's walk rather than an import: render.ts imports invariants, and
 * slot math needs nothing but text lengths and chip positions.
 */
function readTokensLite(root: HTMLElement): SentenceToken[] {
  const out: SentenceToken[] = [];
  let buf = '';
  for (const n of Array.from(root.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE) {
      buf += n.textContent ?? '';
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
