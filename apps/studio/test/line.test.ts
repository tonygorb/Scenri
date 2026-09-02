import { describe, it, expect, beforeEach } from 'vitest';
import {
  CHIP,
  caretBeside,
  caretUnits,
  chipHexWords,
  chipLabel,
  closeIcon,
  collapseChipSpaces,
  collapseDoubleSpaceAtCaret,
  syncEmpty,
  decode,
  emptySentence,
  encode,
  insertToken,
  keepCaret,
  normalizeLine,
  normalizeTint,
  parseBriefHtml,
  readLine,
  removeChip,
  renderLine,
  serializeSelection,
  setCaretUnits,
  sigilAtCaret,
  templateChip,
  textBeforeCaret,
  unitsBeforeChip,
  updateColorChip,
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
  t.t === 'template'
    ? `T:${t.id}`
    : t.t === 'product'
      ? `P:${t.id}`
      : t.t === 'color'
        ? (t.name ?? t.hex)
        : t.t === 'ref'
          ? 'reference'
          : t.v;

/** Put the caret at a character offset, chips counting as one. */
const caret = (units: number) => setCaretUnits(root, units);
const text = () => root.textContent ?? '';
const chips = () => Array.from(root.querySelectorAll(`.${CHIP}`));
/** The shape of the line: text runs quoted, chips as <kind>. */
const shape = () =>
  Array.from(root.childNodes).map((n) =>
    n.nodeType === Node.TEXT_NODE ? JSON.stringify(n.textContent) : `<${(n as HTMLElement).dataset.kind}>`,
  );

beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement('div');
  root.contentEditable = 'true';
  document.body.appendChild(root);
});

describe('tokens and the line', () => {
  // 'b:' was the brand-kit chip, retired when brand rules became something that
  // applies on its own. A draft saved while it existed must decode to nothing
  // rather than to a token no compiler understands.
  it('decodes a retired chip to nothing', () => {
    expect(decode('b:')).toBeNull();
    expect(decode('z:whatever')).toBeNull();
  });

  it('renders and reads back the same sentence', () => {
    const tokens: SentenceToken[] = [
      { t: 'text', v: 'hero of ' },
      { t: 'product', id: 'p1' },
      { t: 'text', v: ' in ' },
      { t: 'color', hex: '#D96C3B', name: 'Terracotta' },
    ];
    renderLine(root, tokens, chipFor);
    const read = readLine(root);
    expect(read.filter((t) => t.t !== 'text')).toEqual([
      { t: 'product', id: 'p1' },
      { t: 'color', hex: '#D96C3B', name: 'Terracotta' },
    ]);
    expect(read.map((t) => (t.t === 'text' ? t.v : '·')).join('')).toContain('hero of');
  });

  it('an empty line reads as one empty text token', () => {
    renderLine(root, emptySentence(), chipFor);
    expect(readLine(root)).toEqual([{ t: 'text', v: '' }]);
  });

  it('every token kind survives encode and decode', () => {
    const all: SentenceToken[] = [
      { t: 'template', id: 'studio-packshot' },
      { t: 'product', id: 'p1' },
      // A product pinned to a specific angle must survive too. This case was
      // missing, which is why the DOM round-trip could drop `angle` for years
      // while this test still claimed "every token kind survives".
      { t: 'product', id: 'p1', angle: 'material-closeup' },
      { t: 'character', id: 'priya' },
      { t: 'color', hex: '#FFAA00', name: 'Primary' },
      { t: 'color', hex: '#FFAA00' },
      { t: 'ref', imageHash: 'abc123' },
    ];
    for (const t of all) expect(decode(encode(t))).toEqual(t);
  });

  it('refuses to decode a token with no payload', () => {
    expect(decode('t:')).toBeNull();
    expect(decode('nonsense')).toBeNull();
  });
});

describe('normalizeLine invariants', () => {
  it('keeps exactly one space on each side of a chip', () => {
    renderLine(
      root,
      [
        { t: 'text', v: 'a   ' },
        { t: 'product', id: 'p1' },
        { t: 'text', v: '    b' },
      ],
      chipFor,
    );
    expect(text()).toBe('a P:p1 b');
  });

  it('gives a bare chip a space to sit in, on both sides', () => {
    renderLine(root, [{ t: 'product', id: 'p1' }], chipFor);
    expect(shape()).toEqual(['""', '<product>', '" "']);
  });

  it('separates two chips that would otherwise touch', () => {
    renderLine(
      root,
      [
        { t: 'product', id: 'p1' },
        { t: 'ref', imageHash: 'h' },
      ],
      chipFor,
    );
    // no leading space: a chip that starts the line gets an empty caret host
    expect(text()).toBe('P:p1 reference ');
    expect(shape()).toEqual(['""', '<product>', '" "', '<ref>', '" "']);
    expect(chips()).toHaveLength(2);
  });

  it('drops a leading space and empty text nodes', () => {
    root.append(document.createTextNode(''), document.createTextNode('   lead'), document.createTextNode(''));
    normalizeLine(root);
    expect(text()).toBe('lead');
    expect(root.childNodes).toHaveLength(1);
  });

  it('strips a lone <br> and sets data-empty for the placeholder', () => {
    root.appendChild(document.createElement('br'));
    expect(syncEmpty(root)).toBe(true);
    expect(root.childNodes).toHaveLength(0);
    expect(root.hasAttribute('data-empty')).toBe(true);
  });

  it('treats an empty chrome wrapper div as blank', () => {
    const wrap = document.createElement('div');
    wrap.appendChild(document.createElement('br'));
    root.appendChild(wrap);
    expect(syncEmpty(root)).toBe(true);
    expect(root.childNodes).toHaveLength(0);
    expect(root.hasAttribute('data-empty')).toBe(true);
  });

  it('normalizeLine clears Chromium empty-editor leftovers', () => {
    root.append(document.createElement('br'), document.createTextNode('\u200B'));
    normalizeLine(root);
    expect(root.childNodes).toHaveLength(0);
    expect(root.hasAttribute('data-empty')).toBe(true);
  });

  it('clears data-empty when the line has real text', () => {
    root.appendChild(document.createTextNode('keep'));
    root.setAttribute('data-empty', '');
    expect(syncEmpty(root)).toBe(false);
    expect(text()).toBe('keep');
    expect(root.hasAttribute('data-empty')).toBe(false);
  });

  it('always leaves somewhere to type after a trailing chip', () => {
    renderLine(
      root,
      [
        { t: 'text', v: 'shoot' },
        { t: 'product', id: 'p1' },
      ],
      chipFor,
    );
    const last = root.lastChild!;
    expect(last.nodeType).toBe(Node.TEXT_NODE);
  });
});

describe('inserting a chip', () => {
  it('lands at the caret, not at the end', () => {
    renderLine(root, [{ t: 'text', v: 'shoot in light' }], chipFor);
    caret(6); // "shoot |in light"
    insertToken(root, chipFor({ t: 'product', id: 'p1' }));
    expect(text()).toBe('shoot P:p1 in light');
  });

  it('does not double a space the sentence already has', () => {
    renderLine(root, [{ t: 'text', v: 'shoot in light' }], chipFor);
    caret(6);
    insertToken(root, chipFor({ t: 'product', id: 'p1' }));
    expect(text()).not.toMatch(/ {2}/);
  });

  it('appends when the caret is at the end', () => {
    renderLine(root, [{ t: 'text', v: 'shoot' }], chipFor);
    caret(5);
    insertToken(root, chipFor({ t: 'ref', imageHash: 'h' }));
    expect(text()).toBe('shoot reference ');
  });

  it('leaves the caret after the chip so typing carries on there', () => {
    renderLine(root, [{ t: 'text', v: 'shoot in light' }], chipFor);
    caret(6);
    insertToken(root, chipFor({ t: 'product', id: 'p1' }));
    // "shoot " is 6, the chip is 7, and the caret lands past the space that
    // follows it, so the next keystroke never runs into the chip's own label
    expect(caretUnits(root)).toBe(8);
  });

  it('replaces a highlighted stretch rather than adding to it', () => {
    renderLine(root, [{ t: 'text', v: 'shoot the thing' }], chipFor);
    const t = root.firstChild as Text;
    const r = document.createRange();
    r.setStart(t, 6);
    r.setEnd(t, 15); // "the thing"
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    insertToken(root, chipFor({ t: 'product', id: 'p1' }));
    expect(text()).toBe('shoot P:p1 ');
  });

  it('eats the sigil query only when the pick came from the sigil menu', () => {
    renderLine(root, [{ t: 'text', v: 'shoot @pro' }], chipFor);
    caret(10);
    insertToken(root, chipFor({ t: 'product', id: 'p1' }), { eatQuery: true });
    expect(text()).toBe('shoot P:p1 ');
  });

  it('eats a scene query the same way', () => {
    renderLine(root, [{ t: 'text', v: 'shot /morn' }], chipFor);
    caret(10);
    insertToken(root, chipFor({ t: 'template', id: 'morning-tabletop' }), { eatQuery: true });
    expect(text()).toBe('shot T:morning-tabletop ');
  });

  it('leaves a slash the user meant, like "50/50 split"', () => {
    renderLine(root, [{ t: 'text', v: 'split it 50/50 ' }], chipFor);
    caret(15);
    insertToken(root, chipFor({ t: 'product', id: 'p1' })); // plus menu: no query
    expect(text()).toContain('50/50');
  });

  it('eats a query that got split across text nodes', () => {
    renderLine(root, [{ t: 'text', v: 'shoot ' }], chipFor);
    root.appendChild(document.createTextNode('@pr'));
    root.appendChild(document.createTextNode('od'));
    const last = root.lastChild as Text;
    const r = document.createRange();
    r.setStart(last, last.length);
    r.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    insertToken(root, chipFor({ t: 'product', id: 'p1' }), { eatQuery: true });
    expect(text()).toBe('shoot P:p1 ');
  });

  it('falls back to the remembered caret when focus left the line', () => {
    renderLine(root, [{ t: 'text', v: 'shoot in light' }], chipFor);
    window.getSelection()!.removeAllRanges(); // the file dialog took the selection
    insertToken(root, chipFor({ t: 'product', id: 'p1' }), { fallbackUnits: 6 });
    expect(text()).toBe('shoot P:p1 in light');
  });
});

describe('removing a chip', () => {
  it('closes the gap it leaves behind', () => {
    renderLine(
      root,
      [
        { t: 'text', v: 'shoot ' },
        { t: 'product', id: 'p1' },
        { t: 'text', v: ' in light' },
      ],
      chipFor,
    );
    removeChip(root, chips()[0]);
    expect(text()).toBe('shoot in light');
  });

  it('leaves the caret at the seam', () => {
    renderLine(
      root,
      [
        { t: 'text', v: 'shoot ' },
        { t: 'product', id: 'p1' },
        { t: 'text', v: ' in light' },
      ],
      chipFor,
    );
    removeChip(root, chips()[0]);
    expect(caretUnits(root)).toBe(6);
  });

  it('handles a chip at the very start', () => {
    renderLine(
      root,
      [
        { t: 'product', id: 'p1' },
        { t: 'text', v: ' on marble' },
      ],
      chipFor,
    );
    removeChip(root, chips()[0]);
    expect(text()).toBe('on marble');
  });

  it('removes the middle chip of three and merges the seam to one space', () => {
    renderLine(
      root,
      [
        { t: 'text', v: 'shoot ' },
        { t: 'product', id: 'p1' },
        { t: 'text', v: ' with ' },
        { t: 'color', hex: '#ff0000', name: 'red' },
        { t: 'text', v: ' in ' },
        { t: 'product', id: 'p2' },
        { t: 'text', v: ' light' },
      ],
      chipFor,
    );
    removeChip(root, chips()[1]);
    expect(chips().length).toBe(2);
    expect(text()).toBe('shoot P:p1 with in P:p2 light');
    expect(caretUnits(root)).toBe(13);
  });

  it('removes the first and the last chip of a multi-chip line', () => {
    renderLine(
      root,
      [
        { t: 'product', id: 'p1' },
        { t: 'text', v: ' and ' },
        { t: 'product', id: 'p2' },
        { t: 'text', v: ' after' },
      ],
      chipFor,
    );
    removeChip(root, chips()[1]);
    expect(text()).toBe('P:p1 and after');
    removeChip(root, chips()[0]);
    expect(text()).toBe('and after');
  });

  it('takes chips out one after another without disturbing the prose', () => {
    renderLine(
      root,
      [
        { t: 'text', v: 'a ' },
        { t: 'product', id: 'p1' },
        { t: 'text', v: ' b ' },
        { t: 'color', hex: '#00ff00', name: 'green' },
        { t: 'text', v: ' c ' },
        { t: 'product', id: 'p2' },
        { t: 'text', v: ' d' },
      ],
      chipFor,
    );
    removeChip(root, chips()[0]);
    removeChip(root, chips()[0]);
    removeChip(root, chips()[0]);
    expect(chips().length).toBe(0);
    expect(text()).toBe('a b c d');
  });

  it('no-ops on a missing or detached target', () => {
    renderLine(
      root,
      [
        { t: 'text', v: 'shoot ' },
        { t: 'product', id: 'p1' },
        { t: 'text', v: ' x' },
      ],
      chipFor,
    );
    removeChip(root, null);
    removeChip(root, chipFor({ t: 'product', id: 'zz' }));
    expect(chips().length).toBe(1);
    expect(text()).toBe('shoot P:p1 x');
  });

  it('closes the double space a Backspace over a chip leaves', () => {
    root.append(document.createTextNode('shoot  in light'));
    const t = root.firstChild as Text;
    const r = document.createRange();
    r.setStart(t, 6);
    r.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    collapseDoubleSpaceAtCaret(root);
    expect(text()).toBe('shoot in light');
  });
});

describe('collapseChipSpaces', () => {
  const caretIn = (t: Text, at: number) => {
    const r = document.createRange();
    r.setStart(t, at);
    r.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
  };
  const caretAt = () => {
    const r = window.getSelection()!.getRangeAt(0);
    return [r.startContainer, r.startOffset] as const;
  };

  it('a space typed between two chips collapses back to the one they share, caret past it', () => {
    root.append(
      chipFor({ t: 'product', id: 'p1' }),
      document.createTextNode('  '),
      chipFor({ t: 'character', id: 'c1' }),
    );
    const t = root.childNodes[1] as Text;
    caretIn(t, 2);
    expect(collapseChipSpaces(root)).toBe(true);
    expect(t.textContent).toBe(' ');
    expect(caretAt()).toEqual([t, 1]);
  });

  it('a space typed at a chip edge beside prose keeps the prose and one space', () => {
    root.append(
      chipFor({ t: 'product', id: 'p1' }),
      document.createTextNode('  on marble  '),
      chipFor({ t: 'character', id: 'c1' }),
    );
    const t = root.childNodes[1] as Text;
    caretIn(t, 13);
    collapseChipSpaces(root);
    expect(t.textContent).toBe(' on marble ');
    expect(caretAt()).toEqual([t, 11]);
  });

  it('prose that touches no chip is left alone', () => {
    root.append(document.createTextNode('shoot  in light'));
    expect(collapseChipSpaces(root)).toBe(false);
    expect(text()).toBe('shoot  in light');
  });
});

describe('caret beside a chip', () => {
  it('lands just past the space after the chip', () => {
    renderLine(
      root,
      [
        { t: 'text', v: 'ab ' },
        { t: 'product', id: 'p1' },
        { t: 'text', v: ' cd' },
      ],
      chipFor,
    );
    caretBeside(root, chips()[0], 'after');
    const r = window.getSelection()!.getRangeAt(0);
    expect((r.startContainer.textContent ?? '').startsWith(' cd')).toBe(true);
    expect(r.startOffset).toBe(1);
  });

  it('lands at the end of the text before the chip', () => {
    renderLine(
      root,
      [
        { t: 'text', v: 'ab ' },
        { t: 'product', id: 'p1' },
        { t: 'text', v: ' cd' },
      ],
      chipFor,
    );
    caretBeside(root, chips()[0], 'before');
    const r = window.getSelection()!.getRangeAt(0);
    expect(r.startContainer.textContent).toBe('ab ');
    expect(r.startOffset).toBe(3);
  });

  it('makes somewhere to stand when the chip is last', () => {
    renderLine(
      root,
      [
        { t: 'text', v: 'ab ' },
        { t: 'product', id: 'p1' },
      ],
      chipFor,
    );
    root.lastChild!.remove(); // the trailing space normalizeLine would have added
    caretBeside(root, chips()[0], 'after');
    const r = window.getSelection()!.getRangeAt(0);
    expect(r.startContainer.nodeType).toBe(Node.TEXT_NODE);
    expect((r.startContainer as Text).parentElement).toBe(root);
  });

  it('never leaves the caret inside the chip', () => {
    renderLine(
      root,
      [
        { t: 'text', v: 'ab ' },
        { t: 'product', id: 'p1' },
        { t: 'text', v: ' cd' },
      ],
      chipFor,
    );
    for (const side of ['before', 'after'] as const) {
      caretBeside(root, chips()[0], side);
      const n = window.getSelection()!.getRangeAt(0).startContainer;
      expect((n.parentElement as HTMLElement | null)?.closest(`.${CHIP}`) ?? null).toBeNull();
    }
  });
});

describe('one template per brief', () => {
  it('finds the template chip the line already carries', () => {
    renderLine(
      root,
      [
        { t: 'text', v: 'a ' },
        { t: 'template', id: 'flat-lay' },
      ],
      chipFor,
    );
    expect(templateChip(root)?.dataset.tok).toBe('t:flat-lay');
  });

  it('reports none when the line has no template', () => {
    renderLine(
      root,
      [
        { t: 'text', v: 'a ' },
        { t: 'product', id: 'p1' },
      ],
      chipFor,
    );
    expect(templateChip(root)).toBeNull();
  });
});

describe('clipboard', () => {
  const selectAll = () => {
    const r = document.createRange();
    r.selectNodeContents(root);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    return r;
  };

  it('plain text reads a chip as its label', () => {
    renderLine(
      root,
      [
        { t: 'text', v: 'hero of ' },
        { t: 'product', id: 'p1' },
        { t: 'text', v: ' at dusk' },
      ],
      chipFor,
    );
    expect(serializeSelection(selectAll()).text).toBe('hero of P:p1 at dusk');
  });

  it('html carries the token inside our own wrapper', () => {
    renderLine(root, [{ t: 'product', id: 'p1' }], chipFor);
    const { html } = serializeSelection(selectAll());
    expect(html).toContain('data-sc-brief');
    expect(html).toContain('data-sc-tok="p:p1"');
  });

  it('escapes a label that looks like markup', () => {
    renderLine(root, [{ t: 'color', hex: '#fff', name: '<script>x</script>' }], chipFor);
    const { html } = serializeSelection(selectAll());
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('round trips through parse back into tokens', () => {
    renderLine(
      root,
      [
        { t: 'text', v: 'hero of ' },
        { t: 'product', id: 'p1' },
      ],
      chipFor,
    );
    const parts = parseBriefHtml(serializeSelection(selectAll()).html);
    expect(parts).toEqual(['hero of ', { t: 'product', id: 'p1' }, ' ']);
  });

  it('ignores html that is not ours, however it is dressed up', () => {
    // any page can put a data-sc-tok on the clipboard; without our wrapper it
    // must never become a chip
    expect(parseBriefHtml('<b>bold</b><span data-sc-tok="t:app-on-device">fake</span>')).toBeNull();
    expect(parseBriefHtml('<p>just words</p>')).toBeNull();
  });

  it('keeps a token that is inside our wrapper', () => {
    const parts = parseBriefHtml('<span data-sc-brief="1">use <span data-sc-tok="p:p1">Thing</span></span>');
    expect(parts).toEqual(['use ', { t: 'product', id: 'p1' }]);
  });

  it('a chip with an unreadable token pastes as its words', () => {
    const parts = parseBriefHtml('<span data-sc-brief="1"><span data-sc-tok="zz:nope">Ghost</span></span>');
    expect(parts).toEqual(['Ghost']);
  });

  // a brief copied before the sc- rename is still sitting on somebody's
  // clipboard, so the pre-rename spelling has to keep pasting as chips
  it('still reads the pre-rename data-bt-* flavour', () => {
    const parts = parseBriefHtml('<span data-bt-brief="1">use <span data-bt-tok="p:p1">Thing</span></span>');
    expect(parts).toEqual(['use ', { t: 'product', id: 'p1' }]);
  });

  it('the wrapper is still required for the pre-rename flavour', () => {
    expect(parseBriefHtml('<b>bold</b><span data-bt-tok="t:app-on-device">fake</span>')).toBeNull();
  });
});

describe('slash query', () => {
  it('reads back to the slash across split text nodes', () => {
    root.append(document.createTextNode('shoot /fl'), document.createTextNode('at'));
    const last = root.lastChild as Text;
    const r = document.createRange();
    r.setStart(last, last.length);
    r.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    const before = textBeforeCaret(root);
    expect(before.slice(before.lastIndexOf('/') + 1)).toBe('flat');
  });

  it('stops at a chip', () => {
    renderLine(
      root,
      [
        { t: 'text', v: 'a /x ' },
        { t: 'product', id: 'p1' },
        { t: 'text', v: ' bc' },
      ],
      chipFor,
    );
    caret(readLine(root).length + 10);
    const last = root.lastChild as Text;
    const r = document.createRange();
    r.setStart(last, last.length);
    r.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    expect(textBeforeCaret(root)).not.toContain('/x');
  });
});

describe('caret offsets', () => {
  it('counts a chip as one character', () => {
    renderLine(
      root,
      [
        { t: 'text', v: 'ab' },
        { t: 'product', id: 'p1' },
        { t: 'text', v: ' cd' },
      ],
      chipFor,
    );
    caret(4); // "ab" + chip + one space
    expect(caretUnits(root)).toBe(4);
  });

  it('never parks the caret inside a chip', () => {
    renderLine(
      root,
      [
        { t: 'text', v: 'ab ' },
        { t: 'product', id: 'p1' },
        { t: 'text', v: ' cd' },
      ],
      chipFor,
    );
    caret(3); // exactly on the chip
    const node = window.getSelection()!.getRangeAt(0).startContainer;
    expect((node as HTMLElement).closest?.(`.${CHIP}`) ?? null).toBeNull();
  });
});

describe('keepCaret', () => {
  const ev = (el: Element) => {
    let prevented = false;
    keepCaret({
      target: el,
      preventDefault: () => {
        prevented = true;
      },
    });
    return prevented;
  };

  it('cancels mousedown on a button so the brief keeps its caret', () => {
    const b = document.createElement('button');
    document.body.appendChild(b);
    expect(ev(b)).toBe(true);
  });

  it('lets a search field take focus', () => {
    const i = document.createElement('input');
    document.body.appendChild(i);
    expect(ev(i)).toBe(false);
  });

  it('covers a control nested anywhere inside the guarded container', () => {
    const wrap = document.createElement('div');
    const inner = document.createElement('span');
    wrap.appendChild(inner);
    document.body.appendChild(wrap);
    expect(ev(inner)).toBe(true);
  });
});

describe('chip helpers', () => {
  it('reads a chip label without the remove button', () => {
    const el = chipFor({ t: 'product', id: 'p1' });
    expect(chipLabel(el)).toBe('P:p1');
  });

  it('normalizes a tint to one strength, and ignores greys', () => {
    expect(normalizeTint('#d96c3b')).toMatch(/^hsl\(\d+ 55% 55%\)$/);
    expect(normalizeTint('#808080')).toBeUndefined();
    expect(normalizeTint('not a colour')).toBeUndefined();
    expect(normalizeTint(null)).toBeUndefined();
  });
});

describe('sigilAtCaret: which menu the caret is asking for', () => {
  const caretAfter = (html: string) => {
    const root = document.createElement('div');
    root.innerHTML = html;
    document.body.appendChild(root); // attach first: a range on a detached node is dropped
    const last = root.lastChild as Text;
    const range = document.createRange();
    range.setStart(last, (last.textContent ?? '').length);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    return root;
  };

  it('reads a product query after $ at a word start', () => {
    expect(sigilAtCaret(caretAfter('try $mar'))).toEqual({ sigil: '$', query: 'mar' });
  });

  it('reads a scene query after / at a word start', () => {
    expect(sigilAtCaret(caretAfter('try /mar'))).toEqual({ sigil: '/', query: 'mar' });
  });

  it('reads a presenter query after @ at a word start', () => {
    expect(sigilAtCaret(caretAfter('a shot of @mar'))).toEqual({ sigil: '@', query: 'mar' });
  });

  it('reads a colour query after # at a word start', () => {
    expect(sigilAtCaret(caretAfter('in #morn'))).toEqual({ sigil: '#', query: 'morn' });
  });

  it('opens at the very start of the line', () => {
    expect(sigilAtCaret(caretAfter('@ma'))).toEqual({ sigil: '@', query: 'ma' });
  });

  it('leaves a hex colour alone: #F5C518 is not a colour menu', () => {
    expect(sigilAtCaret(caretAfter('keep the cap in brand#F5C518'))).toBeNull();
  });

  it('leaves a mid-word dollar alone: cost$20 is not a product query', () => {
    expect(sigilAtCaret(caretAfter('cost$20'))).toBeNull();
  });

  it('leaves an email alone: the @ has a letter in front of it', () => {
    expect(sigilAtCaret(caretAfter('mail tony@example'))).toBeNull();
  });

  it('closes once the query runs past a space', () => {
    expect(sigilAtCaret(caretAfter('@marco holding'))).toBeNull();
  });

  it('is null in ordinary prose', () => {
    expect(sigilAtCaret(caretAfter('a quiet morning shot'))).toBeNull();
  });
});

/**
 * What the picker does to the line, and what it must not do to it.
 *
 * A chip is swapped by replacing the element while keeping its uid, so the
 * slot survives and every caret index in the line is unchanged. The whole
 * focus contract rests on that: the picker takes focus for its search field,
 * so the caret has to be restored from a number recorded before the swap.
 */
describe('replacing a chip in place', () => {
  const line = (): SentenceToken[] => [
    { t: 'text', v: 'a shot of ' },
    { t: 'product', id: 'p1' },
    { t: 'text', v: ' in ' },
    { t: 'template', id: 't1' },
    { t: 'text', v: ' today' },
  ];

  /** How BriefInput swaps: same uid, new token, then renormalize. */
  const swap = (uid: string, t: SentenceToken) => {
    const el = root.querySelector<HTMLElement>(`[data-uid="${uid}"]`)!;
    const next = chipFor(t);
    next.dataset.uid = uid;
    el.replaceWith(next);
    normalizeLine(root);
  };

  beforeEach(() => {
    renderLine(root, line(), chipFor);
    for (const [i, c] of chips().entries()) (c as HTMLElement).dataset.uid = `u${i}`;
  });

  it('changes exactly one token and leaves the prose byte-identical', () => {
    const before = readLine(root);
    swap('u0', { t: 'product', id: 'p2' });
    const after = readLine(root);

    expect(after).toHaveLength(before.length);
    const differing = after.filter((t, i) => JSON.stringify(t) !== JSON.stringify(before[i]));
    expect(differing).toEqual([{ t: 'product', id: 'p2' }]);
    expect(after.filter((t) => t.t === 'text')).toEqual(before.filter((t) => t.t === 'text'));
  });

  it('keeps the chip in its own slot rather than appending it', () => {
    swap('u0', { t: 'product', id: 'p2' });
    expect(shape()).toEqual(['"a shot of "', '<product>', '" in "', '<template>', '" today"']);
    expect(chips()).toHaveLength(2);
  });

  it('leaves every caret index in the line untouched, wherever the caret was', () => {
    for (const at of [0, 3, 10, 11, 15, 16, 20]) {
      renderLine(root, line(), chipFor);
      for (const [i, c] of chips().entries()) (c as HTMLElement).dataset.uid = `u${i}`;
      caret(at);
      const before = caretUnits(root);
      swap('u0', { t: 'product', id: 'p2' });
      caret(before!);
      expect(caretUnits(root)).toBe(before);
    }
  });

  it('survives a swap repeated many times, which is the point of a picker', () => {
    const prose = readLine(root).filter((t) => t.t === 'text');
    for (let i = 0; i < 12; i++) swap('u1', { t: 'template', id: `t${i}` });
    expect(chips()).toHaveLength(2);
    expect(readLine(root).filter((t) => t.t === 'text')).toEqual(prose);
    expect(readLine(root).find((t) => t.t === 'template')).toEqual({ t: 'template', id: 't11' });
  });

  it('a swap does not disturb the other chip', () => {
    swap('u0', { t: 'product', id: 'p2' });
    expect(readLine(root).find((t) => t.t === 'template')).toEqual({ t: 'template', id: 't1' });
  });
});

describe('unitsBeforeChip', () => {
  beforeEach(() => {
    renderLine(
      root,
      [
        { t: 'text', v: 'a shot of ' },
        { t: 'product', id: 'p1' },
        { t: 'text', v: ' in ' },
        { t: 'template', id: 't1' },
        { t: 'text', v: ' today' },
      ],
      chipFor,
    );
  });

  it('counts characters before a chip, chips counting as one', () => {
    const [product, template] = chips();
    expect(unitsBeforeChip(root, product)).toBe(10);
    // 'a shot of ' + <product> + ' in '
    expect(unitsBeforeChip(root, template)).toBe(15);
  });

  it('is the seam a caret should take once the chip is gone', () => {
    const template = chips()[1];
    const at = unitsBeforeChip(root, template);
    template.remove();
    normalizeLine(root);
    setCaretUnits(root, at);
    // the caret is in real text, not stranded on a node that no longer exists
    expect(caretUnits(root)).toBe(at);
    expect(chips()).toHaveLength(1);
  });

  it('is zero for a chip that opens the line', () => {
    renderLine(
      root,
      [
        { t: 'product', id: 'p1' },
        { t: 'text', v: ' alone' },
      ],
      chipFor,
    );
    expect(unitsBeforeChip(root, chips()[0])).toBe(0);
  });
});

describe('chipHexWords', () => {
  const colorChip = (t: Extract<SentenceToken, { t: 'color' }>) => chipFor(t);

  const type = (value: string, at?: number) => {
    root.textContent = value;
    caret(at ?? value.length);
  };

  it('chips a finished 6-digit hex and leaves the surrounding words', () => {
    type('keep the cap #F5C518 exactly');
    expect(chipHexWords(root, colorChip)).toBe(true);
    expect(readLine(root).filter((t) => t.t === 'color')).toEqual([{ t: 'color', hex: '#F5C518' }]);
    expect(text()).toContain('keep the cap');
    expect(text()).toContain('exactly');
  });

  it('leaves a 3-digit hex alone until a terminator or commit', () => {
    type('#fff');
    expect(chipHexWords(root, colorChip)).toBe(false);
    expect(chips()).toHaveLength(0);

    type('#fff ');
    expect(chipHexWords(root, colorChip)).toBe(true);
    expect(readLine(root).filter((t) => t.t === 'color')).toEqual([{ t: 'color', hex: '#FFFFFF' }]);
  });

  it('chips a trailing 3-digit hex on commit', () => {
    type('#fff');
    expect(chipHexWords(root, colorChip, { commit: true })).toBe(true);
    expect(readLine(root).filter((t) => t.t === 'color')).toEqual([{ t: 'color', hex: '#FFFFFF' }]);
  });

  it('leaves a mid-word hash as prose', () => {
    type('cap#F5C518');
    expect(chipHexWords(root, colorChip, { commit: true })).toBe(false);
    expect(chips()).toHaveLength(0);
    expect(text()).toBe('cap#F5C518');
  });

  it('leaves a scene query that is not a hex', () => {
    type('in #ice');
    expect(chipHexWords(root, colorChip, { commit: true })).toBe(false);
    expect(chips()).toHaveLength(0);
    expect(text()).toBe('in #ice');
  });

  it('names a hex that the caller recognises', () => {
    type('#D96C3B');
    chipHexWords(root, colorChip, { nameFor: (hex) => (hex === '#D96C3B' ? 'Terracotta' : undefined) });
    expect(readLine(root).filter((t) => t.t === 'color')).toEqual([{ t: 'color', hex: '#D96C3B', name: 'Terracotta' }]);
  });

  it('chips two hexes in one run', () => {
    type('use #fff and #000000');
    expect(chipHexWords(root, colorChip)).toBe(true);
    expect(readLine(root).filter((t) => t.t === 'color')).toEqual([
      { t: 'color', hex: '#FFFFFF' },
      { t: 'color', hex: '#000000' },
    ]);
  });
});

describe('updateColorChip', () => {
  it('rewrites the token, swatch and label without replacing the node', () => {
    const el = chipFor({ t: 'color', hex: '#FFFFFF' });
    const sw = document.createElement('span');
    sw.className = 'sc-token-swatch';
    sw.style.background = '#FFFFFF';
    el.insertBefore(sw, el.firstChild);
    el.dataset.uid = 'u1';
    root.appendChild(el);

    updateColorChip(el, { t: 'color', hex: '#000000' });
    expect(el).toBe(root.firstChild);
    expect(decode(el.dataset.tok ?? '')).toEqual({ t: 'color', hex: '#000000' });
    expect(sw.style.background).toBe('rgb(0, 0, 0)');
    expect(chipLabel(el)).toBe('#000000');
  });
});
