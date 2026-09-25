import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import type { Core } from '@scenri/core';
import { driftDiff } from '../diff.js';
import { readImagePart, toMarkPng } from './shared.js';
import { buildBrandBundle } from '../exportBrand.js';
import { fileSize, isThumbWidth, THUMB_WIDTH_LIST, type ThumbStore } from '../thumbs.js';

// Private: a stored picture may be a photograph of a person, and over plain
// LAN http a shared cache between a phone and this computer could keep a copy.
// Still immutable, because the hash is the content and a tile should not cost
// a revalidation. What a browser already holds it keeps until its cache lets
// go, deleted or not: the price of no request per tile.
const IMMUTABLE = 'private, max-age=31536000, immutable';

/**
 * The stored original's longest edge. Engines read references at 2048, so this
 * only stops a 256 MP file being kept whole; a 48 MP phone photo fits inside.
 */
const STORED_MAX_EDGE = 8192;

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
    // existence before the 304, as the original route does: a deleted picture
    // revalidates to a 404, never to "keep showing it"
    if ((await fileSize(core.images.pathFor(hash))) === null)
      return reply.status(404).send({ error: 'image not found' });
    if (req.headers['if-none-match'] === etag) return reply.status(304).header('cache-control', IMMUTABLE).send();
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

  // One decode at a time. A 1.5 MB phone JPEG carrying an EXIF rotation
  // decodes whole, near a gigabyte, and two at once held 1.7 GB. Queued, never
  // refused, so a burst of photos still lands every one; sharp's own pixel
  // limit stays, so a 200 MP camera photo is still taken.
  let decoding: Promise<unknown> = Promise.resolve();
  const oneAtATime = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = decoding.then(fn, fn);
    decoding = run.catch(() => undefined);
    return run;
  };

  // upload an arbitrary image (moodboard, reference, a photograph of a person)
  // into the content store
  app.post('/api/images', async (req, reply) => {
    // Through the shared reader, like every sibling upload route. This one used
    // to decode inline, so anything sharp could not read threw past it into the
    // error handler and reached the person as a 500 carrying libvips's own
    // words: "VipsJpeg: premature end of JPEG image". A half-downloaded
    // holiday photo is an ordinary thing to choose, and it is not a server
    // fault.
    const part = await readImagePart(core, req, (buf) =>
      oneAtATime(async () => {
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
        // byte-identical old path: the resize is a no-op inside STORED_MAX_EDGE.
        const fmt = (
          await sharp(buf)
            .metadata()
            .catch(() => null)
        )?.format;
        if (fmt === 'svg') return await toMarkPng(buf);
        return await sharp(buf)
          .rotate()
          .resize({ width: STORED_MAX_EDGE, height: STORED_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
          .png()
          .toBuffer();
      }),
    );
    if ('error' in part) return reply.status(400).send({ error: part.error });
    return { hash: part.hash };
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
