export type RGB = [number, number, number];

/** The two colours a picture being made is drawn in: dots of ink on its host's own ground. */
export type Tones = { ink: RGB; ground: RGB };

/**
 * The tones for the box `el` stands in, read when its drawing starts: the
 * ground is the host's own (--sc-raised) and the ink is the page's text colour
 * (--sc-fg) at 22% over it, a quiet grey in either theme.
 */
export function tonesOf(el: Element): Tones {
  const cs = getComputedStyle(el);
  const fg = rgbOf(cs.getPropertyValue('--sc-fg').trim() || '#f5f5f5');
  const ground = rgbOf(cs.getPropertyValue('--sc-raised').trim() || '#1a1a1a');
  return { ink: [0, 1, 2].map((i) => Math.round(fg[i] * 0.22 + ground[i] * 0.78)) as RGB, ground };
}

/** An opaque pixel for a Uint32Array over ImageData (little-endian RGBA). */
export const pack = (c: RGB) => ((255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;

/** Relative luminance on the encoded values, 0..1: near enough to how light a colour looks. */
export const lightness = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

export const prefersStill = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Calls `f` when the page's theme changes (the data-theme attribute, or the system scheme). */
export function onThemeChange(f: () => void): () => void {
  const mo = new MutationObserver(f);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', f);
  return () => {
    mo.disconnect();
    mq.removeEventListener('change', f);
  };
}

/** A CSS colour as numbers, through a 1x1 canvas (hex, rgb(), a name; not var()). */
function rgbOf(css: string): RGB {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const x = c.getContext('2d');
  if (!x) return [110, 110, 110];
  x.fillStyle = css;
  x.fillRect(0, 0, 1, 1);
  const d = x.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}
