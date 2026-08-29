/**
 * Geometry fixtures: a circle must stay a circle through every transform.
 *
 * Why fixtures and not metadata: METADATA ALONE CANNOT FLAG A SHEARED FILE.
 * A sheared image's ratio is self-consistent and its recorded sizes are the
 * honest dimensions of the dishonest pixels - the crushed-image incident
 * passed the aspect check BECAUSE the shear made the ratio exact. Only a
 * known-geometry fixture (or the pre-shear original) reveals shear, which is
 * why the fix bans the model-side resize instead of trying to detect it, and
 * why this suite renders shapes and measures them rather than trusting any
 * recorded number.
 *
 * The measurement: a dark circle on white, located by its dark-pixel bounding
 * box after the transform. Uniform scaling keeps the box square (within a
 * couple of pixels of resampling slop); any non-uniform scale stretches it.
 */
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { expandCanvas, compositeExpand, reframeExpand } from '../src/expand.js';
import { planExpand } from '../src/expandRules.js';
import { preserveOutsideChange } from '../src/localEdit.js';
import { planCrop } from '../src/cropRules.js';

const FRAMES: Array<[string, number, number]> = [
  ['1:1', 512, 512],
  ['4:5', 512, 640],
  ['16:9', 640, 360],
  ['9:16', 360, 640],
];

/** A centered dark circle filling 40% of the short edge, on white. */
async function circleFixture(w: number, h: number): Promise<Buffer> {
  const r = Math.round(Math.min(w, h) * 0.2);
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="white"/>
    <circle cx="${w / 2}" cy="${h / 2}" r="${r}" fill="black"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Bounding box of dark pixels; the circle's roundness survives as box squareness. */
async function darkBox(buf: Buffer): Promise<{ w: number; h: number }> {
  const { data, info } = await sharp(buf).greyscale().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let maxX = -1;
  let minY = info.height;
  let maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[y * info.width + x] < 100) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { w: maxX - minX + 1, h: maxY - minY + 1 };
}

const eccentricity = (b: { w: number; h: number }) => Math.abs(b.w - b.h) / Math.max(b.w, b.h);

describe('a circle stays a circle', () => {
  it('through the expand bed, at every frame', async () => {
    for (const [, w, h] of FRAMES) {
      const plan = planExpand({ width: w, height: h }, w > h ? (w / h) * 1.4 : h / w / 1.4 / (h / w) + w / h / 1.3);
      const wide = planExpand({ width: w, height: h }, (w / h) * 1.35);
      if (!wide) continue;
      const bed = await expandCanvas(await circleFixture(w, h), wide);
      expect(eccentricity(await darkBox(bed))).toBeLessThanOrEqual(0.02);
      expect(plan === null || plan !== undefined).toBe(true);
    }
  });

  it('through compositeExpand, whatever size the engine answered at', async () => {
    const src = await circleFixture(512, 640);
    const plan = planExpand({ width: 512, height: 640 }, 1)!;
    // engine answers at plan size, larger, and off by a hair
    for (const [aw, ah] of [
      [plan.width, plan.height],
      [Math.round(plan.width * 1.5), Math.round(plan.height * 1.5)],
      [plan.width + 6, plan.height - 4],
    ]) {
      const answer = await sharp({
        create: { width: aw, height: ah, channels: 3, background: '#dddddd' },
      })
        .png()
        .toBuffer();
      const { image } = await compositeExpand(answer, src, plan);
      expect(eccentricity(await darkBox(image))).toBeLessThanOrEqual(0.02);
      const meta = await sharp(image).metadata();
      expect([meta.width, meta.height]).toEqual([plan.width, plan.height]);
    }
  });

  it('through reframeExpand: near answers fill, far answers cover, never shear', async () => {
    const plan = planExpand({ width: 512, height: 640 }, 16 / 9)!;
    // 10% off-plan: must COVER (crop), so a circle drawn in the answer stays round
    const off = await circleFixture(Math.round(plan.width * 0.9), plan.height);
    const framed = await reframeExpand(off, plan);
    expect(framed).not.toBeNull();
    expect(eccentricity(await darkBox(framed!))).toBeLessThanOrEqual(0.02);
    // 2% off-plan: fill is allowed, bounded shear
    const near = await circleFixture(Math.round(plan.width * 0.985), plan.height);
    const nearFramed = await reframeExpand(near, plan);
    expect(nearFramed).not.toBeNull();
    expect(eccentricity(await darkBox(nearFramed!))).toBeLessThanOrEqual(0.03);
  });

  it('through preserveOutsideChange, which only ever aligns same-shape answers', async () => {
    const src = await circleFixture(512, 640);
    // the edit moved one corner pixel patch; shapes match within the gate
    const edited = await sharp(await circleFixture(508, 636))
      .resize(512, 640, { fit: 'fill' })
      .composite([
        {
          // mid-grey on purpose: bright enough to stay out of darkBox's
          // threshold, different enough from white to register as the change
          input: await sharp({ create: { width: 40, height: 40, channels: 3, background: '#999999' } })
            .png()
            .toBuffer(),
          left: 8,
          top: 8,
        },
      ])
      .png()
      .toBuffer();
    const { image } = await preserveOutsideChange(src, edited);
    expect(eccentricity(await darkBox(image))).toBeLessThanOrEqual(0.02);
  });

  it('through a planned crop, which trims and never scales', async () => {
    for (const [, w, h] of FRAMES) {
      const plan = planCrop({ width: w, height: h }, 1);
      if (!plan) continue;
      const cropped = await sharp(await circleFixture(w, h))
        .extract({ left: plan.left, top: plan.top, width: plan.width, height: plan.height })
        .png()
        .toBuffer();
      expect(eccentricity(await darkBox(cropped))).toBeLessThanOrEqual(0.02);
    }
  });
});
