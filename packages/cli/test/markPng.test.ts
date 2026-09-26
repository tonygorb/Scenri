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

// Real encodes (AVIF, a 3000px JPEG, three formats in a row) run past vitest's
// 5 s default on a Windows runner: 5.8 s measured on CI, 2026-09-27.
describe('capReferenceEdge', { timeout: 30_000 }, () => {
  let home: string;
  let core: Core;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'sc-capref-'));
    core = createCore(home);
  });
  afterEach(() => {
    core.close();
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
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

  it('a missing path comes back unchanged: the engine surfaces that error, not us', async () => {
    const ghost = join(home, 'not-there.png');
    expect(await capReferenceEdge(core, ghost, 1024)).toBe(ghost);
  });

  // A catalog import keeps the bytes the store served, and OpenAI reads PNG,
  // JPEG, WebP and GIF only. An AVIF inside the cap went to Codex as it was,
  // under a .png name; Codex put a line of text where the picture should have
  // been and drew anyway, so the shot came back without the product.
  it('re-encodes an AVIF inside the cap to a lossless PNG in the store, and memoises it', async () => {
    const avif = await sharp(await png(64, 48))
      .avif()
      .toBuffer();
    // Saved the way a catalog import saves it: named for what sharp reads.
    const path = core.images.pathFor(core.images.save(avif, 'heif'));
    const sent = await capReferenceEdge(core, path, 1024);
    expect(sent).not.toBe(path);
    const m = await sharp(sent).metadata();
    expect([m.format, m.width, m.height]).toEqual(['png', 64, 48]);
    // Lossless: the pixels sent are exactly the pixels the AVIF decodes to.
    expect((await sharp(sent).raw().toBuffer()).equals(await sharp(avif).raw().toBuffer())).toBe(true);
    expect(await capReferenceEdge(core, path, 1024)).toBe(sent);
  });

  it('hands JPEG, WebP and GIF inside the cap back as they are', async () => {
    for (const fmt of ['jpeg', 'webp', 'gif'] as const) {
      const path = core.images.pathFor(
        core.images.save(
          await sharp(await png(500, 400))
            .toFormat(fmt)
            .toBuffer(),
          fmt,
        ),
      );
      expect(await capReferenceEdge(core, path, 1024)).toBe(path);
    }
  });

  // Stray bytes before a marker are a harmless libjpeg warning that browsers
  // and engines read through, but they fail a downscale under sharp's default
  // failOn. A JPEG like that is still a JPEG: it goes on as it is, as it always
  // did, and is never refused as a format that cannot be read.
  it('hands back a sendable picture whose downscale trips a decoder warning, never refuses it', async () => {
    const jpeg = await sharp(await png(3000, 2000))
      .jpeg()
      .toBuffer();
    const marker = jpeg.indexOf(Buffer.from([0xff, 0xdb]));
    const warned = Buffer.concat([jpeg.subarray(0, marker), Buffer.from([1, 2, 3]), jpeg.subarray(marker)]);
    const path = core.images.pathFor(core.images.save(warned, 'jpeg'));
    await expect(capReferenceEdge(core, path, 2048)).resolves.toBe(path);
  });

  // An HEVC HEIC the bundled sharp cannot open fell through to the raw bytes.
  // Two stand-ins cover both places sharp gives up: bytes that are no picture
  // at all, and an AVIF cut short, whose header still reads but whose pixels
  // do not, which is where an unsupported codec shows.
  it('refuses a picture it cannot decode with a sentence a person can act on, never the raw bytes', async () => {
    const avif = await sharp(await png(64, 48))
      .avif()
      .toBuffer();
    const cut = avif.subarray(0, avif.length - 16);
    expect((await sharp(cut).metadata()).format).toBe('heif');
    for (const buf of [Buffer.from('not a picture at all'), cut]) {
      const path = core.images.pathFor(core.images.save(buf, 'heif'));
      await expect(capReferenceEdge(core, path, 1024)).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringMatching(/Save it as a JPEG or PNG/),
      });
    }
  });
});
