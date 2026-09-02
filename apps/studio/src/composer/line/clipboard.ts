import { decode, encode, type SentenceToken } from './tokens.js';

// ---------------------------------------------------------------- clipboard

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Two flavours of the selection.
 *
 * text/plain reads a chip as its label, so anywhere else in the world this
 * pastes as the sentence you see. text/html carries each chip's token inside a
 * data-sc-brief wrapper, so pasting back into a brief rebuilds the chips.
 *
 * Chromium reports an empty Selection.toString() when the endpoints land on an
 * editable host, so the default clipboard write would be empty on a select all.
 */
export function serializeSelection(range: Range): { text: string; html: string } {
  let text = '';
  let html = '';
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const v = node.textContent ?? '';
      text += v;
      html += esc(v);
      return;
    }
    const el = node as HTMLElement;
    const raw = el.dataset?.tok;
    if (raw) {
      const label = chipLabel(el);
      text += label;
      html += `<span data-sc-tok="${esc(raw)}">${esc(label)}</span>`;
      return;
    }
    node.childNodes.forEach(walk);
  };
  range.cloneContents().childNodes.forEach(walk);
  return { text, html: `<span data-sc-brief="1">${html}</span>` };
}

/**
 * The same two flavours, built from tokens instead of a DOM selection: the
 * shot record's copy action writes these, so a copied brief pastes back into
 * any composer as chips and into everything else as the sentence you read.
 */
export function serializeBriefTokens(
  tokens: SentenceToken[],
  labelOf: (t: SentenceToken) => string,
): { text: string; html: string } {
  const text: string[] = [];
  const html: string[] = [];
  for (const t of tokens) {
    if (t.t === 'text') {
      const v = t.v.trim();
      if (!v) continue;
      text.push(v);
      html.push(esc(v));
      continue;
    }
    const label = labelOf(t);
    text.push(label);
    html.push(`<span data-sc-tok="${esc(encode(t))}">${esc(label)}</span>`);
  }
  return { text: text.join(' '), html: `<span data-sc-brief="1">${html.join(' ')}</span>` };
}

/** A chip's words: its label span alone, never the remove button's text. */
export function chipLabel(chip: HTMLElement): string {
  return (chip.querySelector('.sc-token-label')?.textContent ?? '').trim();
}

/**
 * Read our own clipboard flavour into parts. Markup is never inserted: only
 * the tokens are read, and the chips get rebuilt from scratch by the caller.
 * The data-sc-brief wrapper is required, because any page on the web can put a
 * data-sc-tok in the HTML it puts on your clipboard.
 *
 * data-bt-* is the pre-rename spelling, read but never written: a brief copied
 * before the upgrade is still on the clipboard, and it should still paste as
 * chips. The wrapper requirement applies to it identically, so accepting the
 * old name widens no trust.
 */
export function parseBriefHtml(html: string): (string | SentenceToken)[] | null {
  if (!html.includes('data-sc-brief') && !html.includes('data-bt-brief')) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const host = doc.querySelector('[data-sc-brief], [data-bt-brief]');
  if (!host) return null;
  const parts: (string | SentenceToken)[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      parts.push(n.textContent ?? '');
      return;
    }
    const el = n as HTMLElement;
    const raw = el.dataset?.scTok ?? el.dataset?.btTok;
    if (raw === undefined) {
      n.childNodes.forEach(walk);
      return;
    }
    const tok = decode(raw);
    parts.push(tok ?? el.textContent ?? '');
  };
  host.childNodes.forEach(walk);
  return parts.length ? parts : null;
}
