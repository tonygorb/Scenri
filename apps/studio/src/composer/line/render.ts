import { decode, emptySentence, type SentenceToken } from './tokens.js';
import { GUARD_RE } from './caret.js';
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
      buf += (n.textContent ?? '').replace(GUARD_RE, '');
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
  for (const t of withoutSeams(tokens)) {
    if (t.t === 'text') {
      if (t.v) root.appendChild(document.createTextNode(t.v));
      continue;
    }
    root.appendChild(chipFor(t));
  }
  normalizeLine(root);
}

/**
 * Briefs saved before the chip owned its gap carried a space of the line's own
 * on each side of every chip. The chip's margin is that gap now, so a run of
 * nothing but whitespace that only ever stood between two chips, or before the
 * first, or after the last, is dropped on the way in. A space the user typed
 * beside a chip has words on its other side and is kept.
 */
function withoutSeams(tokens: SentenceToken[]): SentenceToken[] {
  const chipAt = (i: number) => i >= 0 && i < tokens.length && tokens[i].t !== 'text';
  return tokens.filter((t, i) => {
    if (t.t !== 'text' || !/^\s+$/.test(t.v)) return true;
    const edgeBefore = i === 0 || chipAt(i - 1);
    const edgeAfter = i === tokens.length - 1 || chipAt(i + 1);
    return !(edgeBefore && edgeAfter);
  });
}
