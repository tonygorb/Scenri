/**
 * A pure-grade refinement keeps the photograph's own pixels.
 *
 * Every refine used to ship the model's full repaint, and a repaint invents a
 * little each time: five consecutive "warmer light"s measured an embossed
 * pattern on a plain dress and skin hardening a step per hop, while the face
 * everyone approved drifted further from itself. But a tonal ask needs no new
 * pixels at all. The model's answer is used as a COLOUR RECIPE instead: fit
 * the per-channel tone mapping between what the model was given and what it
 * returned, apply that mapping to the original photograph deterministically,
 * ship the original. Texture, skin, fabric, resolution and identity are
 * pixel-frozen; only the grade moves. The same doctrine as
 * preserveOutsideChange, extended from "outside the change" to "everything
 * except the tone curve".
 *
 * Two guards keep it honest. The instruction gate is a conservative
 * allowlist: only a sentence made entirely of tonal vocabulary engages the
 * path, so "warmer light" qualifies and "remove the cup" or "warmer light and
 * fix the collar" never do. And the evidence gate measures whether the fitted
 * grade actually explains the model's answer: where it does not - the model
 * moved a shadow's geometry, re-lit a face directionally - the model's own
 * frame ships, exactly as before. Wrong never means worse than today.
 */
import sharp from 'sharp';

/** The fit and the gate both run at this thumbnail edge: grade is a global
 * property, and 160px of it is as measurable as 1600. */
const FIT_EDGE = 160;

/**
 * Mean per-pixel, per-channel error (0-255) the fitted grade may leave
 * against the model's own answer and still count as "the answer was a grade".
 * Above it, the model did something a tone curve cannot say, and its frame
 * ships. 12 is deliberately forgiving of the model's texture noise (which the
 * composite is built to discard) while catching real geometry: a moved
 * shadow, a re-lit face, a repainted garment all measure well past it.
 */
export const GRADE_GATE_MEAN_DELTA = 12;

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

type Raw = { data: Buffer; width: number; height: number };

const rawAt = async (png: Buffer, edge?: number): Promise<Raw> => {
  let img = sharp(png);
  if (edge) img = img.resize(edge, edge, { fit: 'fill' });
  const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
};

/**
 * Per-channel quantile-matching LUTs from the model's input to its output.
 * Classic histogram matching: the mapping that makes the input's tonal
 * distribution the output's. Captures warmth, contrast, lift, crush and
 * split-tone tendencies; cannot capture geometry, which is the point.
 */
const fitLuts = (input: Raw, output: Raw): Uint8Array[] => {
  const luts: Uint8Array[] = [];
  for (let c = 0; c < 3; c++) {
    const histIn = new Float64Array(256);
    const histOut = new Float64Array(256);
    for (let i = c; i < input.data.length; i += 3) histIn[input.data[i]]++;
    for (let i = c; i < output.data.length; i += 3) histOut[output.data[i]]++;
    const cdf = (h: Float64Array) => {
      const total = h.reduce((a, b) => a + b, 0) || 1;
      const out = new Float64Array(256);
      let acc = 0;
      for (let v = 0; v < 256; v++) {
        acc += h[v];
        out[v] = acc / total;
      }
      return out;
    };
    const cin = cdf(histIn);
    const cout = cdf(histOut);
    const lut = new Uint8Array(256);
    let j = 0;
    for (let v = 0; v < 256; v++) {
      while (j < 255 && cout[j] < cin[v]) j++;
      lut[v] = j;
    }
    luts.push(lut);
  }
  return luts;
};

const applyLuts = (raw: Raw, luts: Uint8Array[]): void => {
  const d = raw.data;
  for (let i = 0; i < d.length; i += 3) {
    d[i] = luts[0][d[i]];
    d[i + 1] = luts[1][d[i + 1]];
    d[i + 2] = luts[2][d[i + 2]];
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
 * Ship the original's pixels wearing the model's grade - or nothing, when the
 * answer was more than a grade and the model's own frame should ship instead.
 */
export async function gradeComposite(
  originalPng: Buffer,
  modelInputPng: Buffer,
  modelOutputPng: Buffer,
): Promise<GradeCompositeResult | null> {
  try {
    const smallIn = await rawAt(modelInputPng, FIT_EDGE);
    const smallOut = await rawAt(modelOutputPng, FIT_EDGE);
    const luts = fitLuts(smallIn, smallOut);

    // The evidence gate: grade the small input and measure what is left
    // unexplained against the small output.
    const graded = { data: Buffer.from(smallIn.data), width: smallIn.width, height: smallIn.height };
    applyLuts(graded, luts);
    const residual = meanDelta(graded, smallOut);
    if (residual > GRADE_GATE_MEAN_DELTA) return null;

    const full = await rawAt(originalPng);
    applyLuts(full, luts);
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
