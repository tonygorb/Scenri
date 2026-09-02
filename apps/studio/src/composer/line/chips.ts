import { hexWord } from '../../brand/palette.js';
import { CHIP_SELECTOR, encode, type SentenceToken } from './tokens.js';
import { placeCaret } from './caret.js';
import { isChip, normalizeLine } from './invariants.js';
import { isBreak } from './insert.js';

// ---------------------------------------------------------------- chips

/** One template per brief: the existing chip, if the line already has one. */
export const templateChip = (root: HTMLElement | null): HTMLElement | null =>
  root?.querySelector<HTMLElement>('[data-kind="template"]') ?? null;

export const chipAt = (target: EventTarget | null): HTMLElement | null =>
  (target as HTMLElement | null)?.closest?.(CHIP_SELECTOR) ?? null;

export type ColorToken = Extract<SentenceToken, { t: 'color' }>;

/**
 * Turn finished standalone hex words in the line into colour chips.
 *
 * A 6-digit hex chips as soon as it is a complete word. A 3-digit hex waits
 * for a terminator (space or punctuation) so `#fff` can still become
 * `#ffffff`. `commit` is blur or paste: a trailing 3-digit word is finished.
 *
 * Mid-word hashes stay prose (`cap#F5C518`), the same word-start rule as
 * `sigilAtCaret`. The caret is rewritten around the chip the way
 * `insertToken` does, so the next keystroke lands after it.
 */
export function chipHexWords(
  root: HTMLElement | null,
  chipFor: (t: ColorToken) => HTMLElement,
  opts: { commit?: boolean; nameFor?: (hex: string) => string | undefined } = {},
): boolean {
  if (!root) return false;
  let changed = false;
  for (let n = 0; n < 32; n++) {
    const hit = lastHexHit(root, !!opts.commit);
    if (!hit) break;
    const token: ColorToken = { t: 'color', hex: hit.hex, name: opts.nameFor?.(hit.hex) };
    replaceTextRangeWithChip(root, hit.node, hit.start, hit.end, chipFor(token));
    changed = true;
  }
  if (changed) normalizeLine(root);
  return changed;
}

/**
 * Rewrite a colour chip in place.
 *
 * The colour menu is anchored to this node. `replaceWith` would detach it
 * mid-drag; this keeps the element and updates what it shows and stores.
 */
export function updateColorChip(chip: HTMLElement, token: ColorToken): void {
  chip.dataset.kind = 'color';
  chip.dataset.tok = encode(token);
  const label = token.name ?? token.hex;
  const swatch = chip.querySelector<HTMLElement>('.sc-token-swatch');
  if (swatch) swatch.style.background = token.hex;
  const text = chip.querySelector<HTMLElement>('.sc-token-label');
  if (text) text.textContent = label;
  if (chip.getAttribute('role') === 'button') {
    chip.setAttribute('aria-label', `colour: ${label}. Change or remove.`);
  }
  chip.querySelector('[data-role="remove"]')?.setAttribute('aria-label', `Remove ${label}`);
}

function lastHexHit(
  root: HTMLElement,
  commit: boolean,
): { node: Text; start: number; end: number; hex: string } | null {
  for (let i = root.childNodes.length - 1; i >= 0; i--) {
    const node = root.childNodes[i];
    if (node.nodeType !== Node.TEXT_NODE) continue;
    const text = node as Text;
    const hits = hexHitsIn(text.textContent ?? '', commit, (at, value) => isHexWordStart(text, value, at));
    const hit = hits[hits.length - 1];
    if (hit) return { node: text, ...hit };
  }
  return null;
}

function isHexWordStart(node: Text, text: string, index: number): boolean {
  if (index > 0) return isBreak(text[index - 1]);
  const prev = node.previousSibling;
  if (!prev) return true;
  if (isChip(prev)) return true;
  if (prev.nodeType === Node.TEXT_NODE) {
    const v = prev.textContent ?? '';
    return !v.length || isBreak(v[v.length - 1] ?? '');
  }
  return true;
}

function hexHitsIn(
  text: string,
  commit: boolean,
  wordStart: (index: number, text: string) => boolean,
): { start: number; end: number; hex: string }[] {
  const hits: { start: number; end: number; hex: string }[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '#') continue;
    if (!wordStart(i, text)) continue;
    let j = i + 1;
    while (j < text.length && /[0-9A-Fa-f]/.test(text[j] ?? '')) j++;
    const raw = text.slice(i, j);
    const hex = hexWord(raw);
    if (!hex) continue;
    const digits = j - i - 1;
    if (digits === 3) {
      const next = text[j];
      if (next === undefined ? !commit : /[0-9A-Za-z]/.test(next)) continue;
    }
    hits.push({ start: i, end: j, hex });
  }
  return hits;
}

function replaceTextRangeWithChip(root: HTMLElement, host: Text, start: number, end: number, chip: HTMLElement): void {
  const full = host.textContent ?? '';
  const before = full.slice(0, start);
  const after = full.slice(end);
  const sel = typeof window === 'undefined' ? null : window.getSelection();
  let caretInHost: number | null = null;
  if (sel && sel.rangeCount > 0 && sel.getRangeAt(0).startContainer === host) {
    caretInHost = sel.getRangeAt(0).startOffset;
  }

  const parent = host.parentNode;
  if (!parent) return;
  host.textContent = after.length ? after : ' ';
  parent.insertBefore(chip, host);
  if (before) parent.insertBefore(document.createTextNode(before), chip);

  if (caretInHost == null) return;
  if (caretInHost <= start) {
    const prev = chip.previousSibling;
    if (prev?.nodeType === Node.TEXT_NODE) {
      placeCaret(root, prev as Text, Math.min(caretInHost, (prev.textContent ?? '').length));
    }
    return;
  }
  if (caretInHost <= end || !after.length) {
    placeCaret(root, host, host.length);
    return;
  }
  placeCaret(root, host, Math.min(caretInHost - end, host.length));
}

/**
 * Every template keeps its own hue but reads at the same strength. Raw
 * extracted colours range from near-black to cream, so mixing them straight
 * into the chip made some invisible and others washed out.
 */
export function normalizeTint(hex?: string | null): string | undefined {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return undefined;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  if (d < 0.02) return undefined;
  let h: number;
  if (max === r) h = (((g - b) / d + (g < b ? 6 : 0)) * 60) % 360;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return `hsl(${Math.round(h)} 55% 55%)`;
}

/** Built as nodes rather than markup: nothing in this tree is ever parsed. */
export function closeIcon(): SVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '9');
  svg.setAttribute('height', '9');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.4');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', 'm6 6 12 12M18 6 6 18');
  svg.appendChild(path);
  return svg;
}
