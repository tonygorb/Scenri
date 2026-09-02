import { decode, emptySentence, type SentenceToken } from './tokens.js';
import { normalizeLine } from './invariants.js';

// ---------------------------------------------------------------- read and render

/** The line as tokens. Adjacent text collapses into one run. */
export function readLine(root: HTMLElement | null): SentenceToken[] {
  if (!root) return emptySentence();
  const out: SentenceToken[] = [];
  let buf = '';
  const flush = () => {
    if (buf) {
      out.push({ t: 'text', v: buf });
      buf = '';
    }
  };
  for (const n of Array.from(root.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE) {
      buf += n.textContent ?? '';
      continue;
    }
    const el = n as HTMLElement;
    const raw = el.dataset?.tok;
    if (raw) {
      const tok = decode(raw);
      if (tok) {
        flush();
        out.push(tok);
        continue;
      }
    }
    if (el.tagName === 'BR') {
      buf += '\n';
      continue;
    }
    buf += el.textContent ?? ''; // stray markup the browser produced
  }
  flush();
  if (!out.some((t) => t.t === 'text')) out.push({ t: 'text', v: '' });
  return out;
}

/**
 * Rebuild the line from tokens. This is the ONLY thing that may replace the
 * line's children, and it is called only on an explicit reset: a remix loaded,
 * the brief cleared after sending, a template seeded from Home. It must never
 * run in response to typing.
 */
export function renderLine(
  root: HTMLElement | null,
  tokens: SentenceToken[],
  chipFor: (t: SentenceToken) => HTMLElement,
): void {
  if (!root) return;
  root.textContent = '';
  for (const t of tokens) {
    if (t.t === 'text') {
      if (t.v) root.appendChild(document.createTextNode(t.v));
      continue;
    }
    root.appendChild(chipFor(t));
  }
  normalizeLine(root);
}
