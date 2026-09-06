import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import type { Core } from '@scenri/core';
import { driftDiff } from '../diff.js';
import { toMarkPng } from './shared.js';
import { buildBrandBundle } from '../exportBrand.js';
import { fileSize, isThumbWidth, THUMB_WIDTH_LIST, type ThumbStore } from '../thumbs.js';

const IMMUTABLE = 'public, max-age=31536000, immutable';

export function registerImageRoutes(app: FastifyInstance, deps: { core: Core; thumbs: ThumbStore }): void {
  const { core, thumbs } = deps;
  // ---- images / diff / the brand bundle
  /**
   * The original, streamed. It used to be read whole into memory on the
   * event loop with readFileSync, 2 MB at a time, once per tile. The hash is
   * the content, so it is the ETag too: a browser that has it gets a 304.
   */
  app.get('/api/images/:hash', async (req, reply) => {
    const hash = String((req.params as any).hash);
    if (!/^[a-f0-9]{32}$/.test(hash)) return reply.status(404).send({ error: 'image not found' });
    const path = core.images.pathFor(hash);
    const size = await fileSize(path);
    if (size === null) return reply.status(404).send({ error: 'image not found' });
    const etag = `"${hash}"`;
    reply.header('cache-control', IMMUTABLE).header('etag', etag);
    if (req.headers['if-none-match'] === etag) return reply.status(304).send();
    reply.header('content-type', 'image/png').header('content-length', String(size));
    return reply.send(createReadStream(path));
  });

  /**
   * A derivative sized for a tile (640) or a small surface (160), WebP. Made
   * on first request when a landing shot did not already make it. When one
   * cannot be made the answer is a redirect to the original with no-store,
   * so the tile still shows and the next load tries the derivative again.
   */
  app.get('/api/images/:hash/thumb', async (req, reply) => {
    const hash = String((req.params as any).hash);
    const w = Number((req.query as any)?.w);
    if (!isThumbWidth(w)) return reply.status(400).send({ error: `w must be one of ${THUMB_WIDTH_LIST}` });
    if (!/^[a-f0-9]{32}$/.test(hash)) return reply.status(404).send({ error: 'image not found' });
    const etag = `"${hash}-w${w}"`;
    if (req.headers['if-none-match'] === etag) return reply.status(304).header('cache-control', IMMUTABLE).send();
    if ((await fileSize(core.images.pathFor(hash))) === null)
      return reply.status(404).send({ error: 'image not found' });
    const path = await thumbs.ensure(hash, w);
    if (!path) return reply.header('cache-control', 'no-store').redirect(`/api/images/${hash}`, 307);
    const size = await fileSize(path);
    if (size === null) return reply.header('cache-control', 'no-store').redirect(`/api/images/${hash}`, 307);
    reply
      .header('content-type', 'image/webp')
      .header('cache-control', IMMUTABLE)
      .header('etag', etag)
      .header('content-length', String(size));
    return reply.send(thumbs.stream(path));
  });

  // upload an arbitrary image (moodboard, reference) into the content store
  app.post('/api/images', async (req, reply) => {
    const part = await (req as any).file();
    if (!part) return reply.status(400).send({ error: 'multipart file field required' });
    const buf: Buffer = await part.toBuffer();
    if (buf.length === 0) return reply.status(400).send({ error: 'empty file' });
    // .rotate() with no argument bakes in EXIF orientation, and it has to come
    // before .png(), which drops the tag. Without it a photo taken in portrait
    // on a phone is stored in its sensor orientation and lies on its side for
    // the rest of its life, because nothing downstream can recover the tag.
    // catalogImport does it in this order for the same reason.
    //
    // An SVG takes the mark path instead: this generic route rasterized
    // vectors at their intrinsic viewBox (density 72), so an SVG logo dropped
    // in the composer arrived as a thumbnail-resolution reference while the
    // brand-kit route rendered the same file at density 384. Photos keep the
    // byte-identical old path.
    const fmt = (
      await sharp(buf)
        .metadata()
        .catch(() => null)
    )?.format;
    const png = fmt === 'svg' ? await toMarkPng(buf) : await sharp(buf).rotate().png().toBuffer();
    return { hash: core.images.save(png) };
  });

  app.post('/api/diff', async (req, reply) => {
    const { imageA, imageB } = req.body as any;
    if (!core.images.has(String(imageA)) || !core.images.has(String(imageB)))
      return reply.status(404).send({ error: 'image not found' });
    const d = await driftDiff(core.images.read(String(imageA)), core.images.read(String(imageB)));
    const heatmapHash = core.images.save(d.heatmap);
    return { score: d.score, heatmapHash, width: d.width, height: d.height };
  });

  /**
   * The brand as a portable `.brand` bundle.
   *
   * GET, not POST: the client is then a plain anchor with a download
   * attribute, with no blob juggling and no second copy of the filename rule.
   */
  app.get('/api/brands/:id/export', async (req, reply) => {
    const brandId = String((req.params as any).id);
    if (!core.store.getBrand(brandId)) return reply.status(404).send({ error: 'brand not found' });
    const { zip, filename } = await buildBrandBundle(core, brandId);
    reply.header('content-type', 'application/zip').header('content-disposition', `attachment; filename="${filename}"`);
    return reply.send(zip);
  });
}
