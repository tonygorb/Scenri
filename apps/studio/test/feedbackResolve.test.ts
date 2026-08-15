import { beforeEach, describe, expect, it } from 'vitest';
import { areaChain, areaOf } from '../src/feedback/registry.js';
import { imageIndex, resolveNode, resolveTarget } from '../src/feedback/resolve.js';
import { kindOf } from '../src/feedback/payload.js';

const mount = (html: string) => {
  document.body.innerHTML = `<div id="root">${html}</div>`;
  return (sel: string) => document.querySelector(sel) as Element;
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('registry', () => {
  it('answers with the nearest surface, not the outermost', () => {
    const q = mount(`
      <div class="sc-shell"><div class="sc-canvas"><div class="sc-feed">
        <div class="sc-cell"><img alt="" src="/api/images/${'a'.repeat(32)}" /></div>
      </div></div></div>`);
    expect(areaOf(q('img'))).toBe('Shot tile');
  });

  it('keeps the whole trail, which is what makes a report greppable', () => {
    const q = mount('<div class="sc-canvas"><div class="sc-feed"><div class="sc-cell"><b>x</b></div></div></div>');
    expect(areaChain(q('b'))).toEqual(['Shot tile', 'Shot feed', 'Create canvas']);
  });

  it('prefers the stage over the overlay that contains it', () => {
    const q = mount('<div class="sc-ovl"><div class="sc-ovl-stage"><img alt="" /></div></div>');
    expect(areaOf(q('img'))).toBe('Shot stage');
  });

  it('returns null rather than guessing when nothing is recognised', () => {
    const q = mount('<div class="whatever"><span>x</span></div>');
    expect(areaOf(q('span'))).toBeNull();
  });
});

describe('resolveTarget', () => {
  it('climbs to the tagged ancestor for identity', () => {
    const q = mount(
      '<div class="sc-cell" data-fb="shot" data-fb-node="n1" data-fb-variant="2"><button>Open</button></div>',
    );
    const t = resolveTarget(q('button'));
    expect(t.fb).toBe('shot');
    expect(t.nodeId).toBe('n1');
    expect(t.variant).toBe(2);
    expect(t.area).toBe('Shot tile');
  });

  it('prefers aria-label over title over text', () => {
    const q = mount('<button aria-label="Close" title="t">x</button>');
    expect(resolveTarget(q('button')).accessibleName).toBe('Close');
    const q2 = mount('<button title="Only title">x</button>');
    expect(resolveTarget(q2('button')).accessibleName).toBe('Only title');
    const q3 = mount('<button>Just text</button>');
    expect(resolveTarget(q3('button')).accessibleName).toBeNull();
    expect(resolveTarget(q3('button')).text).toBe('Just text');
  });

  it('pulls the content hash out of a generated image', () => {
    const hash = 'b'.repeat(32);
    const q = mount(`<div class="sc-cell"><img alt="" src="/api/images/${hash}" /></div>`);
    expect(resolveTarget(q('img')).imageHash).toBe(hash);
    // and from the tile around it, so clicking the frame still identifies it
    expect(resolveTarget(q('.sc-cell')).imageHash).toBe(hash);
  });
});

describe('node recovery', () => {
  const nodes = [
    { id: 'n1', images: ['a'.repeat(32), 'b'.repeat(32)] },
    { id: 'n2', images: ['c'.repeat(32)] },
  ];

  it('maps every variant of every shot back to its index', () => {
    const idx = imageIndex(nodes);
    expect(idx.get('b'.repeat(32))).toEqual({ nodeId: 'n1', index: 1 });
    expect(idx.get('c'.repeat(32))).toEqual({ nodeId: 'n2', index: 0 });
  });

  it('falls back to the hash when nothing is tagged', () => {
    const q = mount(`<div class="sc-prov"><img alt="" src="/api/images/${'b'.repeat(32)}" /></div>`);
    const t = resolveTarget(q('img'));
    expect(t.nodeId).toBeNull();
    expect(resolveNode(t, imageIndex(nodes))).toEqual({ nodeId: 'n1', variant: 1 });
  });

  it('prefers the tagged id over the hash, since a thumb may show another shot', () => {
    const q = mount(
      `<div data-fb-node="n2" data-fb-variant="0"><img alt="" src="/api/images/${'a'.repeat(32)}" /></div>`,
    );
    expect(resolveNode(resolveTarget(q('img')), imageIndex(nodes)).nodeId).toBe('n2');
  });

  it('infers kind from the same value that fills the report, so they cannot disagree', () => {
    expect(kindOf('n1')).toBe('generation');
    expect(kindOf(null)).toBe('ui');
  });
});
