import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { conditioningCanvas } from '../../src/outpaint/conditioning.js';
import { planExpand } from '../../src/expandRules.js';

/** A picture with a distinct left edge, right edge, top row and bottom row. */
async function striped(width: number, height: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      raw[i] = Math.round((x / Math.max(1, width - 1)) * 255);
      raw[i + 1] = Math.round((y / Math.max(1, height - 1)) * 255);
      raw[i + 2] = 60;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

const pixels = (buf: Buffer) => sharp(buf).raw().toBuffer({ resolveWithObject: true });

describe('conditioningCanvas', () => {
  it('renders the planned frame and leaves the source at its own scale', async () => {
    const src = await striped(64, 64);
    const plan = planExpand({ width: 64, height: 64 }, 16 / 9);
    if (!plan) throw new Error('expected a plan');

    const canvas = await conditioningCanvas(src, plan, 'grey');
    const meta = await sharp(canvas).metadata();
    expect([meta.width, meta.height]).toEqual([plan.width, plan.height]);

    // The whole point: the photograph is placed, never resampled.
    const placed = await sharp(canvas)
      .extract({ left: plan.left, top: plan.top, width: 64, height: 64 })
      .raw()
      .toBuffer();
    const original = await sharp(src).raw().toBuffer();
    expect(Buffer.compare(placed, original)).toBe(0);
    // Three channels: an opaque fill makes no transparency claim.
    expect((await sharp(canvas).metadata()).channels).toBe(3);
  });

  it('states nothing in the new area under a grey fill', async () => {
    const src = await striped(64, 64);
    const plan = planExpand({ width: 64, height: 64 }, 16 / 9);
    if (!plan) throw new Error('expected a plan');

    const { data, info } = await pixels(await conditioningCanvas(src, plan, 'grey'));
    const at = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };
    expect(at(1, 32)).toEqual([128, 128, 128]);
    expect(at(info.width - 2, 32)).toEqual([128, 128, 128]);
  });

  it("continues the picture's own border outward under an edge fill", async () => {
    const src = await striped(64, 64);
    const plan = planExpand({ width: 64, height: 64 }, 16 / 9);
    if (!plan) throw new Error('expected a plan');

    const { data, info } = await pixels(await conditioningCanvas(src, plan, 'edge'));
    const at = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };
    // The source's leftmost column is red=0; its rightmost is red=255. Every
    // column of the corresponding margin carries that same value.
    const [lr] = at(0, 32);
    const [rr] = at(info.width - 1, 32);
    expect(lr).toBeLessThan(8);
    expect(rr).toBeGreaterThan(247);
    // Green rises with y in the source, and the margin inherits that too, so
    // the fill carries the picture's vertical gradient rather than flattening it.
    expect(at(0, 8)[1]).toBeLessThan(at(0, 56)[1]);
  });

  it('grows upward and downward when the frame grows taller', async () => {
    const src = await striped(64, 64);
    const plan = planExpand({ width: 64, height: 64 }, 9 / 16);
    if (!plan) throw new Error('expected a plan');
    expect(plan.axis).toBe('height');

    const { data, info } = await pixels(await conditioningCanvas(src, plan, 'edge'));
    const at = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };
    // Top margin carries the source's top row (green=0), bottom its last (green=255).
    expect(at(32, 0)[1]).toBeLessThan(8);
    expect(at(32, info.height - 1)[1]).toBeGreaterThan(247);
    // And the horizontal gradient survives in both.
    expect(at(8, 0)[0]).toBeLessThan(at(56, 0)[0]);
  });

  it('marks the new area as unpainted under a transparent fill', async () => {
    const src = await striped(64, 64);
    const plan = planExpand({ width: 64, height: 64 }, 16 / 9);
    if (!plan) throw new Error('expected a plan');

    const canvas = await conditioningCanvas(src, plan, 'transparent');
    const { data, info } = await pixels(canvas);
    expect(info.channels).toBe(4);
    const alpha = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3];
    expect(alpha(1, 32)).toBe(0);
    expect(alpha(info.width - 2, 32)).toBe(0);
    // The photograph itself stays fully opaque.
    expect(alpha(plan.left + 32, 32)).toBe(255);
  });

  it('refuses a source it cannot measure', async () => {
    const plan = planExpand({ width: 64, height: 64 }, 16 / 9);
    if (!plan) throw new Error('expected a plan');
    await expect(conditioningCanvas(Buffer.from('not an image'), plan, 'grey')).rejects.toThrow();
  });
});
