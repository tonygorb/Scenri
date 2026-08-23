import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { preserveOutsideChange } from '../src/localEdit.js';
import { judgeChange, MAX_CHANGED } from '../src/localEditRules.js';

const W = 320;
const H = 320;

/** A photograph-ish base: a gradient, so "unchanged" is a real claim. */
const base = async () =>
  sharp({
    create: { width: W, height: H, channels: 3, background: { r: 120, g: 90, b: 70 } },
  })
    .composite([
      {
        input: await sharp({ create: { width: W, height: 60, channels: 3, background: { r: 30, g: 40, b: 60 } } })
          .png()
          .toBuffer(),
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toBuffer();

/** The same picture with one small object dropped into it. */
const withProp = async (src: Buffer, size = 40) =>
  sharp(src)
    .composite([
      {
        input: await sharp({
          create: { width: size, height: size, channels: 3, background: { r: 240, g: 240, b: 240 } },
        })
          .png()
          .toBuffer(),
        left: 30,
        top: 220,
      },
    ])
    .png()
    .toBuffer();

const raw = (buf: Buffer, region?: { left: number; top: number; width: number; height: number }) =>
  (region ? sharp(buf).extract(region) : sharp(buf)).removeAlpha().raw().toBuffer();

describe('preserving everything the instruction did not name', () => {
  it('returns the far side of the frame byte for byte after a small change', async () => {
    const src = await base();
    // the engine added the prop AND drifted the whole frame slightly, which is
    // exactly what was measured happening in practice
    const drifted = await sharp(await withProp(src))
      .modulate({ brightness: 1.02 })
      .png()
      .toBuffer();

    const { image, outcome, changed } = await preserveOutsideChange(src, drifted);
    expect(outcome).toBe('composited');
    expect(changed).toBeGreaterThan(0);

    // the opposite corner from the prop never moves
    const far = { left: W - 60, top: 20, width: 50, height: 30 };
    expect(await raw(image, far)).toEqual(await raw(src, far));
  });

  it('lets the requested change through', async () => {
    const src = await base();
    const edited = await withProp(src);
    const { image, outcome } = await preserveOutsideChange(src, edited);
    expect(outcome).toBe('composited');

    // the prop really is in the result, not composited away
    const at = { left: 40, top: 230, width: 20, height: 20 };
    const after = await raw(image, at);
    const before = await raw(src, at);
    expect(Buffer.compare(after, before)).not.toBe(0);
    expect(after[0]).toBeGreaterThan(200); // the prop's own near-white
  });

  // Splicing two different renders together puts a seam through the middle of
  // the picture, which is worse than an honest re-render.
  it('keeps the engine picture when the whole frame was re-rendered', async () => {
    const src = await base();
    const different = await sharp({
      create: { width: W, height: H, channels: 3, background: { r: 10, g: 140, b: 200 } },
    })
      .png()
      .toBuffer();

    const { image, outcome, changed } = await preserveOutsideChange(src, different);
    expect(outcome).toBe('too-much-changed');
    expect(changed).toBeGreaterThan(MAX_CHANGED);
    expect(await raw(image)).toEqual(await raw(different));
  });

  it('keeps the engine picture, and says why, when the shape changed', async () => {
    const src = await base();
    const reshaped = await sharp(await base())
      .resize(W * 2, H, { fit: 'fill' })
      .png()
      .toBuffer();
    const { outcome } = await preserveOutsideChange(src, reshaped);
    expect(outcome).toBe('shape-changed');
  });

  it('says so when the engine did nothing at all', async () => {
    const src = await base();
    const { outcome, image } = await preserveOutsideChange(src, src);
    expect(outcome).toBe('no-change');
    expect(await raw(image)).toEqual(await raw(src));
  });

  // Post-processing is never allowed to cost somebody their picture.
  it('hands back the engine picture rather than throwing when something is wrong', async () => {
    const src = await base();
    const rubbish = Buffer.from('not an image at all');
    const { image, outcome } = await preserveOutsideChange(src, rubbish);
    expect(outcome).toBe('error');
    expect(image).toBe(rubbish);
  });
});

describe('judging what moved', () => {
  it('treats a change spread over the whole frame as not local', () => {
    expect(judgeChange({ changed: 0.05, spread: 0.95 })).toBe('scattered');
  });
  it('treats a small contained change as local', () => {
    expect(judgeChange({ changed: 0.05, spread: 0.2 })).toBe('composited');
  });
  it('treats nothing, and almost nothing, as nothing', () => {
    expect(judgeChange({ changed: 0, spread: 0 })).toBe('no-change');
    expect(judgeChange({ changed: 0.0001, spread: 0.01 })).toBe('no-change');
  });
});
