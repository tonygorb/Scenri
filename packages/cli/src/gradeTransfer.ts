/**
 * A pure-grade refinement keeps the photograph's own pixels.
 *
 * Every refine used to ship the model's full repaint, and a repaint invents a
 * little each time: five consecutive "warmer light"s measured an embossed
 * pattern on a plain dress and skin hardening a step per hop, while the face
 * everyone approved drifted further from itself. But a tonal ask needs no new
 * pixels at all. The model's answer is used as a COLOUR RECIPE instead: fit
 * the tone transform between what the model was given and what it returned,
 * apply that transform to the original photograph deterministically, ship the
 * original. Texture, skin, fabric, resolution and identity are pixel-frozen;
 * only the grade moves. The same doctrine as preserveOutsideChange, extended
 * from "outside the change" to "everything except the tone curve".
 *
 * The transform is Reinhard colour transfer: an AFFINE match of per-channel
 * mean and spread in the decorrelated l-alpha-beta space, slope-clamped, in
 * floating point end to end. The first version fitted per-channel
 * quantile-matching LUTs instead, and a five-hop chain showed why the
 * literature warns against it: matching a repaint's full histogram imports
 * phantom contrast, independent RGB channels split hues, and stacked 8-bit
 * LUTs quantize into visible banding. An affine in a decorrelated space can
 * do none of those things, composes smoothly across a chain, and a slope
 * clamp keeps any single hop inside what a grade can honestly be. Highlights
 * near clipping roll off to identity: log-space chroma is unreliable there,
 * and a blown window must stay white, never tinted.
 *
 * Two guards keep it honest. The instruction gate is a conservative
 * allowlist and carries the semantics: only a sentence made entirely of
 * tonal vocabulary engages the path, so "warmer light" qualifies and
 * "remove the cup" or "warmer light and fix the collar" never do. The
 * residual gate is a catastrophe guard only - it refuses a grade fitted to
 * an unrelated frame, never referees how the model interpreted a tonal ask,
 * because the model's unrequested extras are exactly what this path is built
 * to discard. Wrong never means worse than today.
 */
import sharp from 'sharp';

/** The fit runs at this thumbnail edge: grade is a global property, and
 * 160px of it is as measurable as 1600. */
const FIT_EDGE = 160;
/** The gate judges far blurrier, where a re-render's pixel misalignment
 * averages away and only structural difference survives. */
const GATE_EDGE = 32;

/**
 * The catastrophe threshold, measured on real codex re-renders
 * (2026-08-30, affine transform): genuine tonal hops leave a 14-25 mean
 * residual at the gate edge purely from generative micro-shift; a same-person
 * different-pose frame measures 49 and an unrelated scene 84. The threshold
 * sits between the bands.
 */
export const GRADE_GATE_MEAN_DELTA = 40;

/** How far a single hop's contrast scale may move, per channel. A grade is
 * never wilder than this; a fit that wants more is being pulled by content. */
const SLOPE_CLAMP = 1.8;

/** Words that talk about tone, light quality, or overall mood. */
const TONAL_WORD =
  /^(warm(er)?|cool(er)?|bright(er)?|dark(er)?|deep(er)?|soft(er)?|hard(er)?|punch(ier|y)?|rich(er)?|flat(ter)?|mood(y|ier)?|golden|overcast|sun(ny|lit)?|cloudy|dusk|dawn|evening|morning|night|daylight|light|lighting|lit|glow(ing)?|exposure|contrast|saturation|desaturat(e|ed)|muted|vivid|tone[sd]?|tint(ed)?|grade[d]?|grading|temperature|white|balance|shadows?|highlights?|blacks?|whites?|filmic|cinematic|dramatic|airy|hazy|misty|crisp)$/i;
/** Connective tissue a tonal sentence is allowed to carry. */
const NEUTRAL_WORD =
  /^(a|an|the|it|its|this|that|make|makes|keep|slightly|slight|touch|bit|little|more|less|much|very|again|overall|whole|image|frame|shot|picture|photo|look|feel|and|of|in|with|to|too|just|please|now|even)$/i;

/**
 * True only for an instruction made entirely of tonal vocabulary. Anything
 * that names an object, a person, a garment or an action falls through to
 * the ordinary re-render path.
 */
export function isGradeOnlyInstruction(text: string): boolean {
  const words = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return false;
  let tonal = 0;
  for (const w of words) {
    if (TONAL_WORD.test(w)) tonal++;
    else if (!NEUTRAL_WORD.test(w)) return false;
  }
  return tonal > 0;
}

// ---------------------------------------------------------- colour plumbing

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const EPS = 1e-6;

/** sRGB bytes to Reinhard's l-alpha-beta (log-LMS, decorrelated). */
const toLab = (r: number, g: number, b: number): [number, number, number] => {
  const R = srgbToLinear(r / 255);
  const G = srgbToLinear(g / 255);
  const B = srgbToLinear(b / 255);
  const L = Math.log10(Math.max(EPS, 0.3811 * R + 0.5783 * G + 0.0402 * B));
  const M = Math.log10(Math.max(EPS, 0.1967 * R + 0.7244 * G + 0.0782 * B));
  const S = Math.log10(Math.max(EPS, 0.0241 * R + 0.1288 * G + 0.8444 * B));
  return [(L + M + S) / Math.sqrt(3), (L + M - 2 * S) / Math.sqrt(6), (L - M) / Math.sqrt(2)];
};

const fromLab = (l: number, a: number, bb: number): [number, number, number] => {
  const L = l / Math.sqrt(3) + a / Math.sqrt(6) + bb / Math.sqrt(2);
  const M = l / Math.sqrt(3) + a / Math.sqrt(6) - bb / Math.sqrt(2);
  const S = l / Math.sqrt(3) - (2 * a) / Math.sqrt(6);
  const Rl = 10 ** L;
  const Ml = 10 ** M;
  const Sl = 10 ** S;
  const R = 4.4679 * Rl - 3.5873 * Ml + 0.1193 * Sl;
  const G = -1.2186 * Rl + 2.3809 * Ml - 0.1624 * Sl;
  const B = 0.0497 * Rl - 0.2439 * Ml + 1.2045 * Sl;
  const clamp = (x: number) => Math.max(0, Math.min(255, Math.round(linearToSrgb(Math.max(0, Math.min(1, x))) * 255)));
  return [clamp(R), clamp(G), clamp(B)];
};

type Raw = { data: Buffer; width: number; height: number };

const rawAt = async (png: Buffer, edge?: number): Promise<Raw> => {
  let img = sharp(png);
  if (edge) img = img.resize(edge, edge, { fit: 'fill' });
  const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
};

interface ChannelAffine {
  k: number;
  mi: number;
  mo: number;
}

const labStats = (raw: Raw) => {
  const n = raw.data.length / 3;
  const mu = [0, 0, 0];
  const sq = [0, 0, 0];
  for (let i = 0; i < raw.data.length; i += 3) {
    const lab = toLab(raw.data[i], raw.data[i + 1], raw.data[i + 2]);
    for (let c = 0; c < 3; c++) {
      mu[c] += lab[c];
      sq[c] += lab[c] * lab[c];
    }
  }
  for (let c = 0; c < 3; c++) {
    mu[c] /= n;
    sq[c] = Math.sqrt(Math.max(1e-9, sq[c] / n - mu[c] * mu[c]));
  }
  return { mu, sd: sq };
};

const fitAffine = (input: Raw, output: Raw): ChannelAffine[] => {
  const a = labStats(input);
  const b = labStats(output);
  return [0, 1, 2].map((c) => ({
    k: Math.max(1 / SLOPE_CLAMP, Math.min(SLOPE_CLAMP, b.sd[c] / a.sd[c])),
    mi: a.mu[c],
    mo: b.mu[c],
  }));
};

/**
 * Apply the affine in place. Near-clipped highlights roll off toward
 * identity: log-space chroma is unreliable up there, and a blown window
 * must stay white, never tinted.
 */
const applyAffine = (raw: Raw, T: ChannelAffine[]): void => {
  const d = raw.data;
  for (let i = 0; i < d.length; i += 3) {
    const peak = Math.max(d[i], d[i + 1], d[i + 2]);
    // full strength to 225, fading to none at 255: a wide band, so texture
    // sitting right at the roll-off blends smoothly instead of mottling
    const w = peak <= 225 ? 1 : Math.max(0, (255 - peak) / 30);
    const lab = toLab(d[i], d[i + 1], d[i + 2]);
    const out = fromLab(
      (lab[0] - T[0].mi) * T[0].k + T[0].mo,
      (lab[1] - T[1].mi) * T[1].k + T[1].mo,
      (lab[2] - T[2].mi) * T[2].k + T[2].mo,
    );
    d[i] = Math.round(d[i] * (1 - w) + out[0] * w);
    d[i + 1] = Math.round(d[i + 1] * (1 - w) + out[1] * w);
    d[i + 2] = Math.round(d[i + 2] * (1 - w) + out[2] * w);
  }
};

const meanDelta = (a: Raw, b: Raw): number => {
  const n = Math.min(a.data.length, b.data.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(a.data[i] - b.data[i]);
  return n ? sum / n : 255;
};

export interface GradeCompositeResult {
  /** The original photograph wearing the model's grade, at the original's own size. */
  image: Buffer;
  /** How much of the model's answer the grade explains (lower is better). */
  residual: number;
}

/**
 * Ship the original's pixels wearing the model's grade - or nothing, when
 * the answer came from an unrelated frame and the model's own output should
 * ship instead.
 */
export async function gradeComposite(
  originalPng: Buffer,
  modelInputPng: Buffer,
  modelOutputPng: Buffer,
): Promise<GradeCompositeResult | null> {
  try {
    const T = fitAffine(await rawAt(modelInputPng, FIT_EDGE), await rawAt(modelOutputPng, FIT_EDGE));

    // The catastrophe gate, judged blurry: grade the gate-size input and
    // measure what no tone transform could explain against the gate-size
    // output.
    const gateIn = await rawAt(modelInputPng, GATE_EDGE);
    const gateOut = await rawAt(modelOutputPng, GATE_EDGE);
    applyAffine(gateIn, T);
    const residual = meanDelta(gateIn, gateOut);
    if (residual > GRADE_GATE_MEAN_DELTA) return null;

    const full = await rawAt(originalPng);
    applyAffine(full, T);
    const image = await sharp(full.data, {
      raw: { width: full.width, height: full.height, channels: 3 },
    })
      .png()
      .toBuffer();
    return { image, residual };
  } catch {
    // any failure means today's behaviour, never a broken image
    return null;
  }
}
