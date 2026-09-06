import type { FastifyReply, FastifyRequest } from 'fastify';
import { existsSync, readFileSync, statSync } from 'node:fs';
import sharp from 'sharp';
import type { BrandContext, Core, GenerateRequest } from '@scenri/core';
import { fileSize, isThumbWidth, THUMB_WIDTH_LIST, type ThumbStore } from '../thumbs.js';

/** Human-readable "A", "A and B", "A, B and C" for error copy. */
export function joinNames(labels: string[]): string {
  const uniq = [...new Set(labels)];
  if (uniq.length <= 1) return uniq[0] ?? '';
  return `${uniq.slice(0, -1).join(', ')} and ${uniq[uniq.length - 1]}`;
}

export function brandContext(core: Core, brandId: string): BrandContext {
  const brand = core.store.getBrand(brandId);
  if (!brand) throw new Error('brand not found');
  const assetPaths: Record<string, string> = {};
  const json = brand.json as any;
  for (const logo of json.logos ?? []) {
    const ref = String(logo.file ?? '');
    if (ref.startsWith('asset:') && core.images.has(ref.slice(6))) assetPaths[ref] = core.images.pathFor(ref.slice(6));
  }
  return { brand: brand.json, assetPaths };
}

export const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** `asset:<hash>` → `<hash>`; anything else (a URL, a relative path) → null. */
export const assetHash = (ref: unknown): string | null => {
  const s = String(ref ?? '');
  return s.startsWith('asset:') ? s.slice(6) : null;
};

export const LOGO_ROLES = ['primary', 'mark', 'wordmark', 'monochrome', 'alternate'] as const;
export const LOGO_BACKGROUNDS = ['light', 'dark', 'any'] as const;

/**
 * Normalize an uploaded product shot: whatever arrived, store a PNG.
 *
 * `.rotate()` takes no argument on purpose. That form applies the EXIF
 * orientation tag, and it has to run before `.png()`, which drops the tag: a
 * shot taken in portrait on a phone otherwise stores in its sensor orientation
 * and lies on its side permanently, with nothing downstream able to recover it.
 */
export const toPng = (buf: Buffer): Promise<Buffer> => sharp(buf).rotate().png().toBuffer();

/** One standard image, for asking an engine what it charges. */
export const COST_PROBE = {
  prompt: '',
  brand: { brand: {}, assetPaths: {} },
  width: 1024,
  height: 1024,
  count: 1,
} as GenerateRequest;

/**
 * The same for a brand mark, with two differences that only matter for marks.
 *
 * `density` because a vector mark otherwise rasterizes at its intrinsic box —
 * for a favicon that is 16px, which is unusable as a reference image. The size
 * cap because a mark arriving as a 6000px export is a reference the model never
 * reads at that resolution, and every attachment is copied per generation.
 */
export const MARK_MAX_EDGE = 2048;
/**
 * The floor. The cap above was the only rule, so a 300px logo export stayed
 * 300px silently, its fine lettering subpixel before any provider saw it —
 * measured as the small-type mutation testers reported. A source in
 * [TINY, MIN) is upscaled to MIN on its long edge (lanczos3, shapes kept, no
 * invented detail; deterministic, so the content-addressed dedupe holds).
 * Below TINY the bytes stay as they are: upscaling a favicon only launders a
 * hopeless source into a plausible-looking file, and the small size is the
 * honest signal the warning surfaces read. WARN is where those surfaces
 * start speaking — above the tiny class, below what survives generation.
 */
export const MARK_MIN_EDGE = 1024;
export const MARK_TINY_EDGE = 256;
export const MARK_WARN_EDGE = 512;
export const toMarkPng = async (buf: Buffer): Promise<Buffer> => {
  const out = await sharp(buf, { density: 384 })
    .rotate()
    .resize({ width: MARK_MAX_EDGE, height: MARK_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
  // Measure the OUTPUT: rotate() above has already resolved any EXIF swap.
  const meta = await sharp(out).metadata();
  const edge = Math.max(meta.width ?? 0, meta.height ?? 0);
  if (edge >= MARK_TINY_EDGE && edge < MARK_MIN_EDGE) {
    return sharp(out)
      .resize({ width: MARK_MIN_EDGE, height: MARK_MIN_EDGE, fit: 'inside', kernel: 'lanczos3' })
      .png()
      .toBuffer();
  }
  return out;
};

/**
 * A reference copy no larger than the engine wants to read.
 *
 * Engines that declare `maxReferenceEdge` read references at reduced
 * resolution anyway; the full-size bytes only slow the upload that runs
 * inside the exec's own time budget. The stored original is untouched — the
 * downscaled copy goes back into the content-addressed store (same source,
 * same derived hash every run) and is memoised so repeats skip the re-encode.
 * A source already inside the cap is handed back as-is.
 */
const cappedRefs = new Map<string, string>();
export async function capReferenceEdge(core: Core, path: string, maxEdge: number): Promise<string> {
  const key = `${path}#${maxEdge}`;
  const hit = cappedRefs.get(key);
  if (hit) return hit;
  let out = path;
  try {
    const meta = await sharp(path).metadata();
    if ((meta.width ?? 0) > maxEdge || (meta.height ?? 0) > maxEdge) {
      const buf = await sharp(path)
        .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
      out = core.images.pathFor(core.images.save(buf));
    }
  } catch {
    // An unreadable reference is the engine's error to surface, not ours to eat
    // here — but it is NOT a result worth remembering. Memoising the fallback
    // pinned the full-resolution original for that key for the life of the
    // process, so one transient sharp failure quietly degraded every later run
    // that touched the same reference. Return it, do not record it.
    return path;
  }
  cappedRefs.set(key, out);
  return out;
}

/**
 * The half of an upload every asset route shares: read the multipart file,
 * reject the empty and the unreadable, and store the normalized bytes.
 *
 * Returns a result rather than throwing, because each caller has its own
 * 404-first ordering and its own idea of what a bad file means.
 */
export const readImagePart = async (
  core: Core,
  req: any,
  normalize: (buf: Buffer) => Promise<Buffer>,
): Promise<{ hash: string; fields: any; filename?: string } | { error: string }> => {
  const part = await req.file();
  if (!part) return { error: 'multipart file field required' };
  const buf: Buffer = await part.toBuffer();
  if (buf.length === 0) return { error: 'empty file' };
  try {
    return { hash: core.images.save(await normalize(buf)), fields: part.fields ?? {}, filename: part.filename };
  } catch {
    // sharp throws on anything it cannot decode. Without this the user gets a
    // 500 through setErrorHandler for the entirely ordinary act of dragging a
    // PDF onto a dropzone.
    return { error: 'that file is not an image we can read' };
  }
};

// A generated look's own jpg can be regenerated at the same filename (a
// rejected preview, redone). `max-age=0, must-revalidate` (an earlier fix)
// still left every already-open tab showing pre-regeneration bytes
// indefinitely — a browser that cached the URL under an old, longer-lived
// policy has no reason to ever re-ask, hard reload included in at least
// one observed browser/OS combination, and there is no way to reach into
// a user's disk cache from the server to evict the old entry. The actual
// fix is to stop reusing the same URL for different content: `mtimeQS`
// appends the file's own mtime as a query string everywhere a preview/
// reference-frame URL is built, so a regenerated file is a genuinely new
// URL the browser has never cached anything under. That makes it safe to
// cache aggressively again — correctness now comes from the URL changing,
// not from asking the server to re-check.
export const mtimeQS = (path: string) => (existsSync(path) ? `?v=${Math.round(statSync(path).mtimeMs)}` : '');
export const serveJpeg = (req: FastifyRequest, reply: FastifyReply, path: string) => {
  const etag = `"${statSync(path).mtimeMs}"`;
  reply.header('cache-control', 'public, max-age=31536000, immutable').header('etag', etag);
  if (req.headers['if-none-match'] === etag) return reply.status(304).send();
  return reply.header('content-type', 'image/jpeg').send(readFileSync(path));
};

/**
 * The key a curated file's derivatives are filed under: the file's own mtime
 * is part of it, the same way `mtimeQS` puts it in the URL, so a regenerated
 * preview gets fresh derivatives without anyone invalidating anything.
 */
export const fileKey = (prefix: string, id: string, path: string) =>
  `${prefix}-${id}-${Math.round(statSync(path).mtimeMs)}`;

/**
 * A curated JPEG at the size a surface asked for. Without `w` it is the JPEG
 * exactly as before; with a valid `w` it is a WebP derivative made through the
 * thumb store (a 1024px avatar was 200 KB in an 88px picker tile, twenty of
 * them a 4 MB tab). Same immutable caching as the store's own derivatives; a
 * derivative that cannot be made falls back to the JPEG with `no-store`, so
 * the tile still shows and the next load tries again.
 */
export const serveJpegSized = async (
  req: FastifyRequest,
  reply: FastifyReply,
  path: string,
  thumbs: ThumbStore,
  key: string,
) => {
  const raw = (req.query as { w?: unknown } | undefined)?.w;
  if (raw === undefined || raw === '') return serveJpeg(req, reply, path);
  const w = Number(raw);
  if (!isThumbWidth(w)) return reply.status(400).send({ error: `w must be one of ${THUMB_WIDTH_LIST}` });
  const immutable = 'public, max-age=31536000, immutable';
  const etag = `"${key}-w${w}"`;
  if (req.headers['if-none-match'] === etag) return reply.status(304).header('cache-control', immutable).send();
  const made = await thumbs.ensureFile(key, path, w);
  const size = made ? await fileSize(made) : null;
  if (!made || size === null) {
    const back = new URL(req.url, 'http://scenri.local');
    back.searchParams.delete('w');
    return reply.header('cache-control', 'no-store').redirect(`${back.pathname}${back.search}`, 307);
  }
  reply
    .header('content-type', 'image/webp')
    .header('cache-control', immutable)
    .header('etag', etag)
    .header('content-length', String(size));
  return reply.send(thumbs.stream(made));
};
