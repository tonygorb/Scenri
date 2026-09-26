import { thresholdsFor } from './bayer.js';
import { type Tones, lightness, pack } from './tones.js';

/**
 * How a picture being made looks: paper.design's Dithering Swirl
 * (packages/shaders, dithering.ts, the u_shape 6 branch, at 43cd68db), drawn
 * on the CPU through a Bayer 8x8 screen in 2px cells, in the quiet ink, its
 * dots covering at most 55% of the ground. The canvas is drawn at cell
 * resolution and scaled up with image-rendering: pixelated, so a feed tile is
 * some 37,000 cells, and what never changes as the swirl turns is worked out
 * once per size.
 *
 * Every movement here starts from rest and comes to rest, the way a thing
 * with weight moves: nothing leaps to full speed and then crawls.
 */
const CELL = 2;
const SCREEN = 8;
const CAP = 0.55;
const TAU = Math.PI * 2;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const fract = (x: number) => x - Math.floor(x);
/** From rest to rest (smoothstep, 3x² - 2x³): no speed at either end, most halfway. */
const ease = (x: number) => {
  const k = clamp01(x);
  return k * k * (3 - 2 * k);
};
/** Progress through the stretch [a, b] of a timeline 0..1, from rest to rest. */
const span = (q: number, a: number, b: number) => ease((q - a) / (b - a));

/**
 * The swirl's own turn at time t (performance seconds), in turns: paper's 4T
 * over a full circle, at the speed Tony picked (0.35 of paper's time per
 * second), each tile of a batch a little further round.
 */
const turnsAt = (t: number, index: number) => (4 * (0.35 * t + 0.8 * index)) / TAU;

/**
 * The swirl on a box of this short side: its own scale and density on a feed
 * tile or the stage; on a small one (a strip step, a rail tile) zoomed out, so
 * paper's empty centre stops filling the square and the arms reach in, and a
 * little denser, since a few dozen 2px dots otherwise read as empty. Down to
 * 0.3 of the scale and 1.42 of the density at 72px and under.
 */
function swirlFit(short: number) {
  const k = Math.min(1, Math.max(0.3, short / 240));
  return { short: short * k, gain: 1 + (1 - k) * 0.6 };
}

/**
 * A box of w x h cells and the parts of the swirl that never change as it
 * turns. Paper's density at a cell is smoothstep(0, 1, r^1.2) *
 * fract(1 / r^1.2 + (6 atan2(v, u) + 4T) / 2π); here that is
 * shape * fract(curl + arm + turns), with the 55% cap in the shape.
 */
type Grid = { w: number; h: number; shape: Float32Array; curl: Float64Array; arm: Float64Array; thr: Float32Array };

function gridFor(cssW: number, cssH: number): Grid {
  const w = Math.max(4, Math.round(cssW / CELL));
  const h = Math.max(4, Math.round(cssH / CELL));
  const W = w * CELL;
  const H = h * CELL;
  const { short, gain } = swirlFit(Math.min(W, H));
  const shape = new Float32Array(w * h);
  const curl = new Float64Array(w * h);
  const arm = new Float64Array(w * h);
  for (let y = 0, i = 0; y < h; y++)
    for (let x = 0; x < w; x++, i++) {
      const u = ((x + 0.5) * CELL - W / 2) / short;
      const v = -((y + 0.5) * CELL - H / 2) / short;
      const l = Math.hypot(u, v);
      shape[i] = gain * CAP * ease(l ** 1.2);
      curl[i] = 1 / Math.max(l, 1e-6) ** 1.2;
      arm[i] = (6 * Math.atan2(v, u)) / TAU;
    }
  return { w, h, shape, curl, arm, thr: thresholdsFor(SCREEN, w, h) };
}

/**
 * A job's first moments: the swirl comes in over 600ms, from rest to rest,
 * already in its own shape and turning at its own pace; only its density
 * rises, so its dots arrive in the screen's own order, the way a dithered
 * picture natively fades in. `born` is null once it is simply running.
 */
const FORM_S = 0.6;
const formAt = (t: number, born: number | null) => (born === null ? 1 : ease((t - born) / FORM_S));

export type Field = {
  /** Sizes the canvas for a css box of cssW x cssH. */
  size(cssW: number, cssH: number): void;
  /** Draws the frame for time t, in seconds on the performance clock. */
  draw(t: number): void;
};

/** The waiting look, running: dots of ink, clear between them so the host's own ground shows. */
export function swirlField(canvas: HTMLCanvasElement, tones: Tones, index: number, born: number | null): Field {
  const ctx = canvas.getContext('2d');
  const on = pack(tones.ink);
  let grid: Grid | null = null;
  let data: ImageData | null = null;
  let d32 = new Uint32Array(0);
  return {
    size(cssW, cssH) {
      if (!ctx) return;
      grid = gridFor(cssW, cssH);
      canvas.width = grid.w;
      canvas.height = grid.h;
      data = ctx.createImageData(grid.w, grid.h);
      d32 = new Uint32Array(data.data.buffer);
    },
    draw(t) {
      if (!ctx || !grid || !data) return;
      const form = formAt(t, born);
      const turns = turnsAt(t, index);
      const { shape, curl, arm, thr } = grid;
      for (let i = 0; i < d32.length; i++) d32[i] = shape[i] * form * fract(curl[i] + arm[i] + turns) > thr[i] ? on : 0;
      ctx.putImageData(data, 0, 0);
    },
  };
}

/** A timed drawing over a picture: `ms` long, drawn at progress p in 0..1. */
export type Drawer = { ms: number; draw(p: number): void };

/**
 * The swirl, the picture's own tones in the same grain, and the picture
 * itself, as one surface. `paint(m, r, turns)` draws a cell clear, so the
 * photograph under the canvas shows, once its place in the order is below r;
 * any other cell is a dot or the ground, of a density moved from the swirl's
 * (m = 0) to the picture's own tones (m = 1), which are its lightness in the
 * ink's terms.
 *
 * The order: the cells whose grain is furthest from the picture turn first,
 * so the picture comes up by its own tones (its light first on the dark
 * theme, its shadows first on the light one, as a print develops), and those
 * already close to it turn last, so nothing is left speckling at the end;
 * within a tone the screen spreads them evenly. Ranked, so every picture,
 * dark or bright, develops at one pace.
 */
function swirlAndPicture(
  canvas: HTMLCanvasElement,
  picture: HTMLImageElement,
  tones: Tones,
  cssW: number,
  cssH: number,
): ((m: number, r: number, turns: number) => void) | null {
  const ctx = canvas.getContext('2d');
  const { w, h, shape, curl, arm, thr } = gridFor(cssW, cssH);
  canvas.width = w;
  canvas.height = h;
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const sx = small.getContext('2d', { willReadFrequently: true });
  if (!ctx || !sx) return null;
  sx.imageSmoothingQuality = 'high';
  // cropped as the picture under the canvas is (object-fit: cover), so each cell samples what it covers
  const fit = Math.max(w / picture.naturalWidth, h / picture.naturalHeight);
  const sw = w / fit;
  const sh = h / fit;
  sx.drawImage(picture, (picture.naturalWidth - sw) / 2, (picture.naturalHeight - sh) / 2, sw, sh, 0, 0, w, h);
  const px = sx.getImageData(0, 0, w, h).data;
  const inkIsLighter = lightness(...tones.ink) > lightness(...tones.ground);
  const tone = new Float32Array(w * h);
  const key = new Float32Array(w * h);
  for (let i = 0; i < tone.length; i++) {
    const j = i * 4;
    const l = lightness(px[j], px[j + 1], px[j + 2]);
    tone[i] = CAP * (inkIsLighter ? l : 1 - l);
    const grain = tone[i] > thr[i] ? tones.ink : tones.ground;
    const far = (Math.abs(grain[0] - px[j]) + Math.abs(grain[1] - px[j + 1]) + Math.abs(grain[2] - px[j + 2])) / 765;
    key[i] = (1 - far + thr[i]) / 2;
  }
  const order = evenly(key);
  const on = pack(tones.ink);
  const off = pack(tones.ground);
  const data = ctx.createImageData(w, h);
  const d32 = new Uint32Array(data.data.buffer);
  return (m, r, turns) => {
    for (let i = 0; i < d32.length; i++) {
      if (order[i] < r) {
        d32[i] = 0;
        continue;
      }
      const s = shape[i] * fract(curl[i] + arm[i] + turns);
      d32[i] = s + (tone[i] - s) * m > thr[i] ? on : off;
    }
    ctx.putImageData(data, 0, 0);
  };
}

/** How long a landing, and a refinement's start, take: Material 3's extra-long3. */
const LAND_MS = 900;

/**
 * A picture landing where it was waited for. Two movements that overlap, each
 * from rest to rest: the swirl's dots gather into the picture's own tones,
 * the swirl braking evenly to a stop as they do, and then the picture
 * develops through that grain, cell by cell from the middle out, into the
 * photograph. Nothing is faded over the whole and nothing is cut. The first
 * frame is the waiting swirl at `t0` (when the landing began, performance
 * seconds), exactly; the last is the photograph.
 */
export function develop(
  canvas: HTMLCanvasElement,
  picture: HTMLImageElement,
  tones: Tones,
  index: number,
  cssW: number,
  cssH: number,
  t0: number,
): Drawer {
  const paint = swirlAndPicture(canvas, picture, tones, cssW, cssH);
  const d = LAND_MS / 1000;
  return {
    ms: LAND_MS,
    draw(q) {
      // braking evenly from its running pace to rest at 0.6: its clock stands at t0 + d(b - b²/1.2)
      const b = Math.min(q, 0.6);
      paint?.(span(q, 0, 0.6), span(q, 0.35, 1), turnsAt(t0 + d * (b - (b * b) / 1.2), index));
    },
  };
}

/**
 * A refinement's start, from the picture being refined, which the stage was
 * showing: the landing played back. The picture goes back into its own grain
 * from the edges in, and that grain is stirred into the swirl, which spins up
 * evenly from rest to the running swirl's very pace and place at the end, so
 * the waiting look carries straight on from the last frame. `t0` is when it
 * began; the first frame is the picture.
 */
export function fromPicture(
  canvas: HTMLCanvasElement,
  picture: HTMLImageElement,
  tones: Tones,
  index: number,
  cssW: number,
  cssH: number,
  t0: number,
): Drawer {
  const paint = swirlAndPicture(canvas, picture, tones, cssW, cssH);
  const d = LAND_MS / 1000;
  return {
    ms: LAND_MS,
    draw(q) {
      // spinning up evenly from rest at 0.4: its clock reaches t0 + d, at full pace, at the end
      const a = Math.max(0, q - 0.4);
      paint?.(1 - span(q, 0.4, 1), 1 - span(q, 0, 0.65), turnsAt(t0 + d - (d * (0.36 - a * a)) / 1.2, index));
    },
  };
}

/** Values 0..1 replaced by their rank, 0..1, so they are spread evenly: a histogram of 1024 steps, fine enough for a screen. */
function evenly(key: Float32Array): Float32Array {
  const steps = 1024;
  const at = (k: number) => Math.min(steps - 1, Math.floor(k * steps));
  const count = new Uint32Array(steps);
  for (let i = 0; i < key.length; i++) count[at(key[i])]++;
  const below = new Float64Array(steps);
  for (let b = 1; b < steps; b++) below[b] = below[b - 1] + count[b - 1];
  const out = new Float32Array(key.length);
  for (let i = 0; i < key.length; i++) {
    const b = at(key[i]);
    out[i] = (below[b] + count[b] / 2) / key.length;
  }
  return out;
}
