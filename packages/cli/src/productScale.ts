import type { BrandContext, EngineAdapter, EngineResult, GenerateRequest, OnImageLanded } from '@scenri/core';
import type { ScalePlan } from './brief.js';

/**
 * A product alone in a place, at its real size.
 *
 * Image models draw a small object far too large when it stands alone in a
 * room-scale world: measured 2026-09-22 on GPT Image 2 and 2.5 (the model
 * Codex draws with), a signet ring came out 2 to 7 times its size in every
 * wording tried, about 5 of 40 small products passing a blind scale judge.
 * Published since as GenScale's "product magnification bias" (arXiv
 * 2609.00525): the model sizes any object at a typical share of the frame,
 * and stated sizes help without solving it.
 *
 * What worked, 7 of 7: two draws. First the place itself, empty, at the
 * magnification the product is really photographed at, so the frame spans
 * about four times the product's size; the model draws an empty surface at a
 * stated magnification faithfully, because there is no object to inflate.
 * Then the product is placed on that picture at a quarter of its width,
 * which is both its true size and the share the model gives any object, so
 * the bias and the truth agree. The model cannot choose the magnification
 * itself (asked to, it drew the same view for a ring and a chair), so the
 * product's real size is data: the record's own words when a person or a
 * store gave them, otherwise one estimate read from its photo and kept.
 */

/** Above this, a product is photographed in the room as the place describes it. */
export const SMALL_PRODUCT_CM = 45;

export interface ProductSize {
  /** As a person reads it, e.g. "about 2 cm across". */
  text: string;
  /** The object's largest dimension as it stands in a photograph, in centimetres. */
  largestCm: number;
}

const UNIT_CM: Record<string, number> = { mm: 0.1, cm: 1, m: 100, in: 2.54, inch: 2.54, inches: 2.54, '"': 2.54 };

/**
 * The largest dimension written in a size, in centimetres, or null when the
 * words carry no unit to read ("large", "one size"). A number without its own
 * unit takes the next unit written after it, so "20 x 30 cm" is two lengths.
 */
export function largestCm(text: string | null | undefined): number | null {
  if (!text) return null;
  const re = /(\d+(?:[.,]\d+)?)\s*(mm|cm|m|inches|inch|in|")?(?![a-z])/gi;
  const found: { n: number; unit: string | undefined }[] = [];
  for (const m of String(text).matchAll(re))
    found.push({ n: Number(m[1].replace(',', '.')), unit: m[2]?.toLowerCase() });
  if (!found.some((f) => f.unit)) return null;
  let best = 0;
  for (let i = 0; i < found.length; i++) {
    const unit = found[i].unit ?? found.slice(i + 1).find((f) => f.unit)?.unit;
    if (!unit) continue;
    best = Math.max(best, found[i].n * UNIT_CM[unit]);
  }
  return best > 0 ? Math.round(best * 10) / 10 : null;
}

/**
 * How much of the place the empty frame spans: four product lengths, within
 * what a camera can do. Four, because the model places any object at about a
 * quarter of the frame whatever it is told (asked for an eighth, it drew a
 * quarter, 2 of 2), so the span is chosen to make that quarter true.
 */
export function spanCm(size: number): number {
  return Math.min(180, Math.max(6, Math.round(size * 4)));
}

/** Only a product smaller than a piece of furniture needs its own magnification. */
export function needsOwnScale(size: ProductSize | null): size is ProductSize {
  return !!size && size.largestCm > 0 && size.largestCm <= SMALL_PRODUCT_CM;
}

const clean = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.\s]+$/, '');

/** Where the camera stands for a span, at a standard lens: about twice the span. */
function distance(span: number): string {
  const cm = Math.round(span * 2);
  return cm >= 100 ? `${Math.round(cm / 10) / 10} metres` : `${cm} centimetres`;
}

/**
 * The first draw: the place, empty, at the product's magnification.
 *
 * Short and led by the lens. The place's room-scale words never lead it: a
 * plate that carried the scene's whole description (its foreground, middle
 * ground and back wall) was drawn as that room at every span asked for, 32 to
 * 150 centimetres alike (measured 2026-09-22), while a plate that named only
 * the surface and the camera was drawn at the span. So with the scene's own
 * picture attached the words only point at it; without one, the description
 * comes in as what the surface is made of, never as the view.
 */
export function platePrompt(opts: {
  place?: string;
  light?: string;
  shot?: string;
  span: number;
  picture: boolean;
}): string {
  const shot = opts.shot ? clean(opts.shot) : '';
  const where = opts.picture
    ? 'one empty surface of the place in the attached photograph, its floor or a ledge where an object would stand'
    : 'one empty surface of a place, its floor or a ledge where an object would stand';
  // A view the shot asks for leads, and the default one steps aside: "seen
  // from directly above" behind "sharp across the lower two thirds, the place
  // far behind" was drawn as the default view.
  // Light keeps its real size too: a close plate of the loft kept the room's
  // window-bar stripes, three to a frame, and a judge read the watch on it
  // at three times its size from them alone (measured 2026-09-22).
  const grain =
    "the surface's own material is large and sharp, down to its finest particles, each grain, fibre or fleck at its true size for that span";
  const view = shot
    ? ` The view is the one the shot asks for: ${shot}. At that magnification ${grain}, and whatever else of the place the view takes in is only large soft out-of-focus light and shadow;`
    : ` At that magnification ${grain}, across the lower two thirds of the frame, and the rest of the place is only large soft out-of-focus light and shadow far behind;`;
  const light =
    opts.span <= 40
      ? ' Light keeps its real size as well: at this magnification a pattern cast by window bars, blinds or leaves is far larger than the frame, so the frame holds one broad patch of that light, or one soft edge of it, and never a row of stripes.'
      : ' Light keeps its real size as well: any pattern it casts, from window bars, blinds or leaves, is as large as it really is against this span.';
  return (
    'Full-bleed photograph filling the entire frame edge to edge with no border, frame, letterbox band or matte of any kind. ' +
    `A close photograph of ${where}, taken with the camera about ${distance(opts.span)} from it: ` +
    `the whole frame spans only about ${opts.span} centimetres of that surface from left to right.` +
    view +
    ' no wall, step or furnishing of the place stands within that span.' +
    (!opts.picture && opts.place
      ? ` The place, described as a whole only so its surface and light are right; the photograph does not show this view: ${clean(opts.place)}.`
      : '') +
    (opts.light ? ` The light: ${clean(opts.light)}.` : '') +
    light +
    (shot
      ? ' No product, no person, no hands, no text and no logos anywhere in the frame, and no object the shot does not ask for.'
      : ' The surface is empty: no product, no object, no person, no hands, no text, no logos anywhere in the frame.')
  );
}

/**
 * The second draw: the product placed on the first, at a quarter of its width.
 *
 * `product` carries the lines that already guard the product's identity and
 * facts in a normal shot, so the placement is held to the same standard; the
 * shot's own words ride too, so a product asked to lie on its side does.
 */
export function placeInstruction(opts: {
  name: string;
  size: ProductSize;
  span: number;
  shot?: string;
  product: string[];
}): string {
  const shot = opts.shot ? clean(opts.shot) : '';
  const lines = opts.product.map(clean).filter(Boolean);
  return (
    `input.png is a photograph of a surface whose frame spans about ${opts.span} centimetres from left to right. ` +
    `Place ${opts.name} on that surface where the light falls, at its true real-world size, ${clean(opts.size.text)}: ` +
    "about a quarter of the frame's width. The surface's grain and texture around it stay exactly the scale they are. " +
    (shot ? `The shot asks for: ${shot}. ` : '') +
    'Keep everything else in input.png exactly as it is: the camera, framing, focus, surface, light and shadow. ' +
    'The product rests in genuine contact with the surface and casts a true contact shadow in the same light. ' +
    (lines.length ? `${lines.join('. ')}. ` : '') +
    'Add no other object, no person, no hands and no text'
  );
}

/** Where a product's size is kept: per brand, so two brands never share a guess. */
export const sizeKey = (brandId: string, productId: string) => `product-size:${brandId}:${productId}`;

/** Who said a size: the reader of its photo, the record it came with, or the person. */
export type SizeSource = 'estimate' | 'record' | 'person';
export interface KnownSize extends ProductSize {
  by: SizeSource;
}

/** A size as stored, read back; anything malformed is treated as unknown. */
export function readSize(raw: string | null | undefined): KnownSize | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    const n = Number(v?.largestCm);
    const text = String(v?.text ?? '').trim();
    const by: SizeSource = v?.by === 'person' ? 'person' : 'estimate';
    return text && Number.isFinite(n) && n > 0 ? { text, largestCm: n, by } : null;
  } catch {
    return null;
  }
}

/** A size in a person's own words, or null when there is no unit to read it by. */
export function sizeFromWords(words: string): ProductSize | null {
  const text = words.replace(/\s+/g, ' ').trim().slice(0, 80);
  const n = largestCm(text);
  return text && n ? { text, largestCm: n } : null;
}

/**
 * The size that holds: the person's own correction first, then what the
 * record itself says (a store's listing, a hand-made product's own field),
 * and only then the estimate read from its photo.
 */
export function resolveSize(dimensions: unknown, stored: KnownSize | null): KnownSize | null {
  if (stored?.by === 'person') return stored;
  const written = sizeFromWords(typeof dimensions === 'string' ? dimensions : '');
  if (written) return { ...written, by: 'record' };
  return stored;
}

/**
 * The two draws, for every shot a run asks for.
 *
 * The plates are one ordinary generation of `count` pictures of the place,
 * with the scene's own picture as the world to match; each plate is handed to
 * an edit that places the product the moment it lands, as many at once as the
 * engine draws at once. Only placements reach the run: a slot shows its
 * picture as soon as its product is in it, and a slot whose placement failed
 * says why.
 */
export async function drawAtScale(o: {
  engine: EngineAdapter;
  images: { pathFor(hash: string): string };
  brand: BrandContext;
  plan: ScalePlan;
  size: ProductSize;
  width: number;
  height: number;
  count: number;
  signal: AbortSignal;
  onImage: OnImageLanded;
}): Promise<EngineResult> {
  const span = spanCm(o.size.largestCm);
  const plates: GenerateRequest = {
    prompt: platePrompt({ span, picture: true, light: o.plan.light, shot: o.plan.shot }),
    brand: o.brand,
    width: o.width,
    height: o.height,
    count: o.count,
    referenceImages: [o.images.pathFor(o.plan.sceneHash)],
    referenceRoles: ['scene'],
  };
  const instruction = placeInstruction({
    name: o.plan.name,
    size: o.size,
    span,
    shot: o.plan.shot,
    product: o.plan.productLines,
  });
  let cost = 0;
  const done = new Map<number, string>();
  const failed = new Map<number, string>();
  const begun = new Set<number>();
  const jobs: Promise<void>[] = [];
  const limit = Math.max(1, o.engine.capabilities().imageConcurrency ?? 1);
  let active = 0;
  const waiting: (() => void)[] = [];
  const turn = () =>
    new Promise<void>((go) => {
      if (active < limit) {
        active++;
        go();
      } else
        waiting.push(() => {
          active++;
          go();
        });
    });
  const place = (slot: number, plate: string) => {
    if (begun.has(slot)) return;
    begun.add(slot);
    const job = (async () => {
      await turn();
      try {
        if (o.signal.aborted) return;
        const r = await o.engine.edit(
          {
            instruction,
            sourceImage: o.images.pathFor(plate),
            brand: o.brand,
            referenceImages: [o.images.pathFor(o.plan.productHash)],
            referenceRoles: ['product'],
            width: o.width,
            height: o.height,
          },
          o.signal,
        );
        cost += r.costUsd;
        const hash = r.images[0];
        if (!hash) throw new Error('the product could not be placed in this shot');
        done.set(slot, hash);
        o.onImage(slot, hash);
      } catch (err) {
        if (!o.signal.aborted) failed.set(slot, String((err as Error)?.message ?? err));
      } finally {
        active--;
        waiting.shift()?.();
      }
    })();
    jobs.push(job);
  };
  // A plate batch that failed part way still hands over the plates that
  // landed: their placements finish and the run keeps them.
  let raw: { variantIndexes?: number[]; partialFailures?: string[] } | undefined;
  let plateError: unknown = null;
  try {
    const drawn = await o.engine.generate(plates, o.signal, place);
    cost += drawn.costUsd;
    raw = drawn.raw as typeof raw;
    for (const [k, hash] of drawn.images.entries()) place(raw?.variantIndexes?.[k] ?? k, hash);
  } catch (err) {
    plateError = err;
  }
  await Promise.all(jobs);
  if (o.signal.aborted) throw plateError ?? new Error('cancelled');
  const slots = [...done.keys()].sort((a, b) => a - b);
  const reasons = [...failed.values(), ...(raw?.partialFailures ?? [])];
  if (!slots.length) throw plateError ?? new Error(reasons[0] ?? 'the product could not be placed in this shot');
  return {
    images: slots.map((s) => done.get(s) as string),
    costUsd: cost,
    raw: { requested: o.count, variantIndexes: slots, partialFailures: reasons },
  };
}
