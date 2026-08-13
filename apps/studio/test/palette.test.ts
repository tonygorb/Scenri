import { describe, it, expect } from 'vitest';
import { flattenPalette, isInShots, normalizeHex, rebuildPalette, ROLE_NAMES } from '../src/brand/palette.js';

const full = {
  primary: { hex: '#1F3D2B', name: 'Forest' },
  secondary: { hex: '#E8DCC8', name: 'Oat' },
  accent: [{ hex: '#D96C3B', name: 'Terracotta' }],
  neutrals: [{ hex: '#111111' }, { hex: '#FAFAF7' }],
  usage: 'Forest dominates packaging.',
};

describe('flattenPalette', () => {
  it('reads primary, secondary, accents then neutrals, tagging each with its slot', () => {
    expect(flattenPalette(full)).toEqual([
      { hex: '#1F3D2B', name: 'Forest', slot: 'primary' },
      { hex: '#E8DCC8', name: 'Oat', slot: 'secondary' },
      { hex: '#D96C3B', name: 'Terracotta', slot: 'accent' },
      { hex: '#111111', name: 'Neutral', slot: 'neutral' },
      { hex: '#FAFAF7', name: 'Neutral 2', slot: 'neutral' },
    ]);
  });

  // Placeholders follow the slot, not the position: a positional list called a
  // brand's first neutral "Accent 2" whenever it happened to have one accent.
  it('names unnamed swatches after their slot, numbering within it', () => {
    const many = flattenPalette({
      primary: { hex: '#000001' },
      accent: [{ hex: '#000002' }, { hex: '#000003' }],
      neutrals: [{ hex: '#000004' }, { hex: '#000005' }],
    });
    expect(many.map((s) => s.name)).toEqual(['Primary', 'Accent', 'Accent 2', 'Neutral', 'Neutral 2']);
    expect(ROLE_NAMES).toContain('Accent 2');
  });

  it('normalizes case and skips entries with no usable colour', () => {
    expect(flattenPalette({ primary: { hex: '#1f3d2b' }, accent: [{ name: 'nope' }, { hex: 'red' }] })).toEqual([
      { hex: '#1F3D2B', name: 'Primary', slot: 'primary' },
    ]);
  });

  it('is empty for a brand with no palette at all', () => {
    expect(flattenPalette(undefined)).toEqual([]);
    expect(flattenPalette({})).toEqual([]);
  });
});

describe('rebuildPalette', () => {
  // The regression this module exists for: the old editor rebuilt by position,
  // so every edit folded a brand's neutrals into its accents, permanently.
  it('round-trips a full palette without losing neutrals or usage', () => {
    expect(rebuildPalette(flattenPalette(full), full)).toEqual(full);
  });

  it('keeps a neutral a neutral when its colour is edited', () => {
    const edited = flattenPalette(full).map((s) => (s.hex === '#111111' ? { ...s, hex: '#222222' } : s));
    const out = rebuildPalette(edited, full);
    expect(out.neutrals).toEqual([{ hex: '#222222' }, { hex: '#FAFAF7' }]);
    expect(out.accent).toEqual([{ hex: '#D96C3B', name: 'Terracotta' }]);
  });

  it('drops a placeholder name rather than persisting it as a real one', () => {
    const out = rebuildPalette([{ hex: '#111111', name: 'Primary', slot: 'primary' }]);
    expect(out.primary).toEqual({ hex: '#111111' });
  });

  // Slots come from position, not from a control: only "is it a neutral" and
  // "is it first" change anything downstream.
  it('derives primary, secondary and accents from list order', () => {
    const out = rebuildPalette([
      { hex: '#111111', name: 'A', slot: 'accent' },
      { hex: '#222222', name: 'B', slot: 'primary' },
      { hex: '#333333', name: 'C', slot: 'secondary' },
      { hex: '#444444', name: 'D', slot: 'neutral' },
    ]);
    expect(out.primary).toEqual({ hex: '#111111', name: 'A' });
    expect(out.secondary).toEqual({ hex: '#222222', name: 'B' });
    expect(out.accent).toEqual([{ hex: '#333333', name: 'C' }]);
    expect(out.neutrals).toEqual([{ hex: '#444444', name: 'D' }]);
  });

  it('re-derives the primary when the one above it is held back', () => {
    const list = flattenPalette(full);
    const out = rebuildPalette(
      list.map((c) => (c.slot === 'primary' ? { ...c, slot: 'neutral' as const } : c)),
      full,
    );
    expect(out.primary).toEqual({ hex: '#E8DCC8', name: 'Oat' });
    expect(out.neutrals?.[0]).toEqual({ hex: '#1F3D2B', name: 'Forest' });
  });

  it('omits empty groups so an empty palette is {} and not a shape of nothings', () => {
    expect(rebuildPalette([])).toEqual({});
    expect(rebuildPalette([], { usage: 'Forest first.' })).toEqual({ usage: 'Forest first.' });
  });

  it('skips a swatch whose hex never became valid', () => {
    expect(rebuildPalette([{ hex: 'nope', name: 'X', slot: 'accent' }])).toEqual({});
  });
});

describe('isInShots', () => {
  it('is the one distinction that changes what a model receives', () => {
    expect(isInShots({ hex: '#000000', name: '', slot: 'accent' })).toBe(true);
    expect(isInShots({ hex: '#000000', name: '', slot: 'primary' })).toBe(true);
    expect(isInShots({ hex: '#000000', name: '', slot: 'neutral' })).toBe(false);
  });
});

describe('normalizeHex', () => {
  it('accepts what a person actually types', () => {
    expect(normalizeHex('abc123')).toBe('#ABC123');
    expect(normalizeHex('  #AbC123 ')).toBe('#ABC123');
    expect(normalizeHex('#fff')).toBe('#FFFFFF');
  });
  // The schema pattern is exactly six digits and rejects the whole document on
  // a miss, so anything else has to be stopped before it reaches state.
  it('rejects everything the schema would reject', () => {
    expect(normalizeHex('rgb(1,2,3)')).toBeNull();
    expect(normalizeHex('#12345678')).toBeNull();
    expect(normalizeHex('#12345')).toBeNull();
    expect(normalizeHex('')).toBeNull();
    expect(normalizeHex('#GGGGGG')).toBeNull();
  });
});
