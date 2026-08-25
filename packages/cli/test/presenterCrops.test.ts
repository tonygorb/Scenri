import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createCore, type Core } from '@scenri/core';
import { presenterCrops } from '../src/customAssets.js';

let home: string;
let core: Core;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-crops-'));
  core = createCore(home);
});
afterEach(() => {
  core.close();
  rmSync(home, { recursive: true, force: true });
});

/**
 * A studio frame the way the builder makes them: a standing figure on a
 * seamless white backdrop, with headroom above it. `left` moves the figure off
 * centre so a frame-centred crop can be told from a figure-centred one.
 */
async function studioFrame(opts: { figureLeft: number; figureTop: number; figureHeight: number }): Promise<string> {
  const W = 1024;
  const H = 1280;
  const fw = 224;
  const body = await sharp({
    create: { width: fw, height: opts.figureHeight, channels: 3, background: { r: 40, g: 40, b: 44 } },
  })
    .png()
    .toBuffer();
  const png = await sharp({ create: { width: W, height: H, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite([{ input: body, left: opts.figureLeft, top: opts.figureTop }])
    .png()
    .toBuffer();
  return core.images.save(png);
}

const meta = async (hash: string | undefined) => (hash ? sharp(core.images.read(hash)).metadata() : null);
const pixel = async (hash: string, x: number, y: number) => {
  const { data } = await sharp(core.images.read(hash))
    .extract({ left: x, top: y, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return [data[0], data[1], data[2]];
};

describe('a presenter avatar is measured from the figure, not the frame', () => {
  it('sizes and places the square against the standing figure', async () => {
    // figure 1150px tall, starting 100px down, and 12px left of centre
    const frame = await studioFrame({ figureLeft: 388, figureTop: 100, figureHeight: 1150 });
    const { avatarHash } = await presenterCrops(core, frame, 'generated');
    const m = await meta(avatarHash);

    // 0.27 of the FIGURE's height (311), not 0.16 of the frame's (205): the old
    // rule cut the chin off, because a head alone nearly filled its square
    expect(m!.width).toBe(311);
    expect(m!.height).toBe(311);

    // there is backdrop above the head — the square is not pinned to the frame
    // edge any more, so it spends no part of itself on empty ceiling
    expect(await pixel(avatarHash!, 155, 2)).toEqual([255, 255, 255]);
    // and the figure is inside it, on the square's own centre line
    expect(await pixel(avatarHash!, 155, 200)).toEqual([40, 40, 44]);
  });

  it('centres on the person when the person stands off centre', async () => {
    // figure pushed well to the left: a frame-centred square would miss it
    const frame = await studioFrame({ figureLeft: 150, figureTop: 120, figureHeight: 1100 });
    const { avatarHash } = await presenterCrops(core, frame, 'generated');
    const m = await meta(avatarHash);
    // the figure's own middle is at its centre column, not the frame's
    const mid = Math.round(m!.width! / 2);
    expect(await pixel(avatarHash!, mid, m!.height! - 4)).toEqual([40, 40, 44]);
  });

  it('keeps the card crop as it was: the grid never had this problem', async () => {
    const frame = await studioFrame({ figureLeft: 400, figureTop: 100, figureHeight: 1150 });
    const { previewHash } = await presenterCrops(core, frame, 'generated');
    const m = await meta(previewHash);
    // 55% of the frame height, 4:5, top anchored — unchanged
    expect(m!.height).toBe(705);
    expect(m!.width).toBe(564);
  });

  it('falls back to the old square when there is no figure to measure', async () => {
    // an all-over texture: nothing uniform to trim, so no bounding box
    const noisy = await sharp({
      create: {
        width: 1024,
        height: 1280,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
        noise: { type: 'gaussian', mean: 128, sigma: 70 },
      },
    })
      .png()
      .toBuffer();
    const hash = core.images.save(noisy);
    const { avatarHash } = await presenterCrops(core, hash, 'generated');
    const m = await meta(avatarHash);
    // still produces an avatar rather than nothing at all
    expect(m!.width).toBeGreaterThan(0);
    expect(m!.height).toBe(m!.width);
  });
});
