import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { centralFidelity, centralRegion } from '../../src/outpaint/fidelity.js';
import { planExpand } from '../../src/expandRules.js';
import { conditioningCanvas } from '../../src/outpaint/conditioning.js';

const SIZE = 96;

/** A picture with a bright block in it, so "the subject" has a findable place. */
async function scene(opts: { blockAt?: number; tone?: number; blockSize?: number } = {}): Promise<Buffer> {
  const { blockAt = 30, tone = 0, blockSize = 24 } = opts;
  const raw = Buffer.alloc(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 3;
      const inBlock = x >= blockAt && x < blockAt + blockSize && y >= 30 && y < 30 + blockSize;
      const base = inBlock ? 230 : 40 + Math.round((y / SIZE) * 30);
      raw[i] = Math.min(255, Math.max(0, base + tone));
      raw[i + 1] = Math.min(255, Math.max(0, base + tone));
      raw[i + 2] = Math.min(255, Math.max(0, base + tone));
    }
  }
  return sharp(raw, { raw: { width: SIZE, height: SIZE, channels: 3 } })
    .png()
    .toBuffer();
}

const planFor = () => {
  const plan = planExpand({ width: SIZE, height: SIZE }, 16 / 9);
  if (!plan) throw new Error('expected a plan');
  return plan;
};

/** An answer that kept the picture exactly, with whatever margin. */
async function answerKeeping(source: Buffer) {
  const plan = planFor();
  return { plan, image: await conditioningCanvas(source, plan, 'grey') };
}

describe('centralRegion', () => {
  it('lifts the window the plan put the picture in', async () => {
    const src = await scene();
    const { plan, image } = await answerKeeping(src);
    const region = await centralRegion(image, plan, { width: SIZE, height: SIZE });
    const meta = await sharp(region).metadata();
    expect([meta.width, meta.height]).toEqual([SIZE, SIZE]);
  });

  it('reads the same window out of an answer rendered at another size', async () => {
    const src = await scene();
    const { plan, image } = await answerKeeping(src);
    // Exactly what codex does: its own native size, right proportions.
    const native = await sharp(image)
      .resize(Math.round(plan.width * 1.4), Math.round(plan.height * 1.4), { fit: 'fill' })
      .png()
      .toBuffer();
    const region = await centralRegion(native, plan, { width: SIZE, height: SIZE });
    const meta = await sharp(region).metadata();
    expect([meta.width, meta.height]).toEqual([SIZE, SIZE]);
  });
});

describe('centralFidelity', () => {
  it('scores an untouched picture as preserved', async () => {
    const src = await scene();
    const { plan, image } = await answerKeeping(src);
    const score = await centralFidelity(image, src, plan);
    expect(score.overall).toBeGreaterThan(0.97);
    expect(score.luma).toBeGreaterThan(0.99);
    expect(score.edges).toBeGreaterThan(0.9);
    expect(score.colour).toBeGreaterThan(0.99);
  });

  it('notices a subject that moved', async () => {
    const src = await scene({ blockAt: 30 });
    const drifted = await scene({ blockAt: 55 });
    const { plan, image } = await answerKeeping(drifted);
    const score = await centralFidelity(image, src, plan);
    // The grade is untouched, so only the structural signals may fall — which
    // is the whole reason they are reported separately.
    expect(score.colour).toBeGreaterThan(0.95);
    expect(score.luma).toBeLessThan(0.9);
    expect(score.edges).toBeLessThan(0.6);
    expect(score.overall).toBeLessThan(0.85);
  });

  it('notices a subject that changed size while staying put', async () => {
    const src = await scene({ blockAt: 30, blockSize: 24 });
    const grown = await scene({ blockAt: 30, blockSize: 44 });
    const { plan, image } = await answerKeeping(grown);
    const score = await centralFidelity(image, src, plan);
    expect(score.edges).toBeLessThan(0.8);
    expect(score.overall).toBeLessThan(0.95);
  });

  it('separates a pure grade shift from a structural one', async () => {
    const src = await scene({ tone: 0 });
    const graded = await scene({ tone: 45 });
    const { plan, image } = await answerKeeping(graded);
    const score = await centralFidelity(image, src, plan);
    // Nothing moved: structure is intact and the colour signal carries the drift.
    expect(score.luma).toBeGreaterThan(0.98);
    expect(score.colour).toBeLessThan(0.5);
    expect(score.overall).toBeLessThan(0.95);
  });

  it('scores an unrelated picture as not the same shot', async () => {
    const src = await scene();
    const noise = Buffer.alloc(SIZE * SIZE * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 97) % 256;
    const other = await sharp(noise, { raw: { width: SIZE, height: SIZE, channels: 3 } })
      .png()
      .toBuffer();
    const { plan, image } = await answerKeeping(other);
    const score = await centralFidelity(image, src, plan);
    expect(score.overall).toBeLessThan(0.5);
  });

  it('refuses a source it cannot measure', async () => {
    const plan = planFor();
    const src = await scene();
    const { image } = await answerKeeping(src);
    await expect(centralFidelity(image, Buffer.from('nope'), plan)).rejects.toThrow();
  });
});
