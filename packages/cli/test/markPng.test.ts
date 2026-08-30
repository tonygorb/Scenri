import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createCore, type Core } from '@scenri/core';
import { capReferenceEdge, MARK_MAX_EDGE, MARK_MIN_EDGE, MARK_TINY_EDGE, toMarkPng } from '../src/routes/shared.js';

/** A solid PNG of the given size, optionally with an alpha hole to prove transparency survives. */
const png = (w: number, h: number, alpha = false) =>
  sharp({
    create: { width: w, height: h, channels: 4, background: { r: 200, g: 40, b: 40, alpha: alpha ? 0.5 : 1 } },
  })
    .png()
    .toBuffer();

const edgeOf = async (buf: Buffer) => {
  const m = await sharp(buf).metadata();
  return { w: m.width ?? 0, h: m.height ?? 0, edge: Math.max(m.width ?? 0, m.height ?? 0) };
};

describe('toMarkPng', () => {
  it('caps an oversized export to the max edge, shape kept', async () => {
    const out = await edgeOf(await toMarkPng(await png(4096, 2048)));
    expect(out.edge).toBe(MARK_MAX_EDGE);
    expect(out.w / out.h).toBeCloseTo(2, 5);
  });

  // The floor is the fix for the tester report: a 300-500px logo export used
  // to pass through untouched, its fine lettering subpixel before any
  // provider ever saw it.
  it('raises a small source to the min edge, shape kept', async () => {
    const out = await edgeOf(await toMarkPng(await png(400, 300)));
    expect(out.edge).toBe(MARK_MIN_EDGE);
    expect(out.w / out.h).toBeCloseTo(4 / 3, 5);
  });

  it('a source already comfortable stays exactly its size', async () => {
    const out = await edgeOf(await toMarkPng(await png(1500, 1000)));
    expect([out.w, out.h]).toEqual([1500, 1000]);
  });

  it('a favicon-class source keeps its bytes: upscaling it would only launder a hopeless file', async () => {
    const out = await edgeOf(await toMarkPng(await png(32, 32)));
    expect(out.edge).toBe(32);
    expect(out.edge).toBeLessThan(MARK_TINY_EDGE);
  });

  it('alpha survives both the plain and the floored path', async () => {
    for (const size of [1500, 400]) {
      const m = await sharp(await toMarkPng(await png(size, size, true))).metadata();
      expect(m.hasAlpha).toBe(true);
    }
  });

  it('an SVG rasterizes from its density, never its viewBox', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><rect width="100" height="50" fill="#123456"/></svg>',
    );
    const out = await edgeOf(await toMarkPng(svg));
    // density 384 alone lifts the 100px viewBox well past the floor threshold,
    // and whatever lands under MIN is floored: either way the stored mark is
    // a usable reference, never a thumbnail
    expect(out.edge).toBeGreaterThanOrEqual(MARK_MIN_EDGE / 2);
  });

  it('bakes EXIF orientation in before the tag is dropped', async () => {
    const rotated = await sharp(await png(300, 100))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const out = await edgeOf(await toMarkPng(rotated));
    // orientation 6 swaps the axes; the floor then scales the swapped shape
    expect(out.h).toBeGreaterThan(out.w);
  });
});

describe('capReferenceEdge', () => {
  let home: string;
  let core: Core;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'sc-capref-'));
    core = createCore(home);
  });
  afterEach(() => {
    core.close();
    rmSync(home, { recursive: true, force: true });
  });

  it('hands back a source already inside the cap untouched', async () => {
    const path = core.images.pathFor(core.images.save(await png(500, 500)));
    expect(await capReferenceEdge(core, path, 1024)).toBe(path);
  });

  it('downscales past the cap into the store, and memoises the answer', async () => {
    const path = core.images.pathFor(core.images.save(await png(3000, 1500)));
    const capped = await capReferenceEdge(core, path, 1024);
    expect(capped).not.toBe(path);
    const m = await sharp(capped).metadata();
    expect(Math.max(m.width ?? 0, m.height ?? 0)).toBe(1024);
    expect(await capReferenceEdge(core, path, 1024)).toBe(capped);
  });

  it('an unreadable path comes back unchanged: the engine surfaces that error, not us', async () => {
    const ghost = join(home, 'not-there.png');
    expect(await capReferenceEdge(core, ghost, 1024)).toBe(ghost);
  });
});
