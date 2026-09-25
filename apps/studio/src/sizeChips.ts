/**
 * Height, width and depth, said the same way on the record and in Details.
 * "about 30 cm tall and 19 cm across" is "Height 30 cm" and "Width 19 cm".
 * A dimension with no number is left off. A size that is not a measurement
 * stays one chip of its own words.
 */

const UNIT = 'mm|cm|inches|inch|in|m|"';

function unitOf(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const u = raw.toLowerCase();
  if (u === '"' || u === 'inch' || u === 'inches') return 'in';
  return u === 'mm' || u === 'cm' || u === 'm' || u === 'in' ? u : undefined;
}

export function plain(raw: string): string {
  const n = Number(raw.trim().replace(',', '.'));
  return raw.trim() && Number.isFinite(n) && n > 0 ? String(n) : '';
}

export type SizeAxis = 'height' | 'width' | 'depth';

export interface SizeDims {
  unit: string;
  height: string;
  width: string;
  depth: string;
}

export const SIZE_AXES: SizeAxis[] = ['height', 'width', 'depth'];
export const SIZE_LABEL: Record<SizeAxis, string> = { height: 'Height', width: 'Width', depth: 'Depth' };

/**
 * An axis is filled only when the words named it, so a missing one stays
 * blank. A size that never named its axes fills the fields in the order it
 * was written. Anything else, including two different units, starts blank.
 */
export function readDims(text: string): SizeDims {
  const blank: SizeDims = { unit: 'cm', height: '', width: '', depth: '' };
  const src = text.trim();
  if (!src || !new RegExp(UNIT, 'i').test(src)) return blank;

  const named: Partial<Record<SizeAxis, { value: string; unit?: string }>> = {};
  const take = (role: string, axis: SizeAxis) => {
    if (named[axis]) return;
    const m = src.match(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(${UNIT})?\\s*(?:${role})\\b`, 'i'));
    if (!m) return;
    const value = plain(m[1]);
    if (!value) return;
    named[axis] = { value, unit: unitOf(m[2]) };
  };
  take('tall|high', 'height');
  take('across|wide', 'width');
  take('long', 'width');
  take('deep', 'depth');

  const picked = SIZE_AXES.filter((axis) => named[axis]);
  if (picked.length) {
    const units = new Set(picked.map((axis) => named[axis]?.unit).filter((u): u is string => !!u));
    if (units.size > 1) return blank;
    return {
      unit: [...units][0] ?? 'cm',
      height: named.height?.value ?? '',
      width: named.width?.value ?? '',
      depth: named.depth?.value ?? '',
    };
  }

  const found: { value: string; unit?: string }[] = [];
  for (const m of src.matchAll(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(${UNIT})?`, 'gi'))) {
    const value = plain(m[1]);
    if (value) found.push({ value, unit: unitOf(m[2]) });
  }
  if (!found.length) return blank;
  const stated = found.map((f) => f.unit).filter((u): u is string => !!u);
  if (!stated.length || new Set(stated).size > 1) return blank;
  return {
    unit: stated[stated.length - 1],
    height: found[0]?.value ?? '',
    width: found[1]?.value ?? '',
    depth: found[2]?.value ?? '',
  };
}

export function sizeChips(text: string): string[] {
  const dims = readDims(text);
  const chips = SIZE_AXES.flatMap((axis) => (dims[axis] ? [`${SIZE_LABEL[axis]} ${dims[axis]} ${dims.unit}`] : []));
  if (chips.length) return chips;
  const src = text.trim();
  if (!src) return [];
  const prose = src.replace(/^about\s+/i, '');
  return [prose.charAt(0).toUpperCase() + prose.slice(1)];
}
