import { createReadStream, mkdirSync, rmSync } from 'node:fs';
import { access, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Core } from '@scenri/core';

/**
 * Derivatives of the images the store holds, for every surface that shows a
 * picture smaller than it is: the feed tile (640 wide, WebP) and the small
 * surfaces (160 wide) such as the rail, the notification rows and the version
 * strip. Content-addressed like the originals, so a derivative is immutable
 * and needs no invalidation. Made when a shot lands and otherwise on first
 * request, never for the whole library at once: a hundred thousand images
 * would be hours of background work and gigabytes for pictures nobody opens.
 *
 * The original stays on `/api/images/:hash` for the stage, compare and export.
 */
const THUMB_WIDTHS = [640, 160] as const;
type ThumbWidth = (typeof THUMB_WIDTHS)[number];

export const isThumbWidth = (w: unknown): w is ThumbWidth => THUMB_WIDTHS.includes(w as ThumbWidth);

export interface ThumbStore {
  /** Where derivatives live: `<home>/thumbs`, a sibling of `images/`. */
  dir: string;
  /**
   * The derivative's path once it exists on disk, or null when it cannot be
   * made (an undecodable original, a full disk). Never throws; a failure is
   * remembered for the life of the process so a broken image costs one
   * attempt, not one per tile paint.
   */
  ensure(hash: string, w: ThumbWidth): Promise<string | null>;
  /** Both widths, fire and forget: what a landing shot asks for. */
  warm(hash: string): void;
  /** Wait for whatever is in flight: the drain before the process goes away. */
  settle(): Promise<void>;
  /** Remove every derivative: the danger zone's `scope=all`. */
  clear(): void;
  /** A readable stream of an existing derivative. */
  stream(path: string): ReturnType<typeof createReadStream>;
}

const QUALITY: Record<ThumbWidth, number> = { 640: 82, 160: 75 };

export function createThumbStore(core: Core, opts: { concurrency?: number } = {}): ThumbStore {
  const dir = join(core.home, 'thumbs');
  let enabled = true;
  try {
    // 0o700 like the images directory: user work, owner's eyes only
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch {
    enabled = false;
  }
  const pathFor = (hash: string, w: ThumbWidth) => join(dir, `${hash}-w${w}.webp`);
  const inflight = new Map<string, Promise<string | null>>();
  const failed = new Set<string>();
  const concurrency = Math.max(1, opts.concurrency ?? 2);
  let active = 0;
  const waiting: (() => void)[] = [];
  const acquire = () =>
    new Promise<void>((resolve) => {
      if (active < concurrency) {
        active++;
        resolve();
      } else waiting.push(resolve);
    });
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };

  async function make(hash: string, w: ThumbWidth): Promise<string | null> {
    const final = pathFor(hash, w);
    const tmp = `${final}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    await acquire();
    try {
      // The store's originals are orientation-baked at write time, so no
      // rotate() here. `withoutEnlargement`: a small original stays itself.
      await sharp(core.images.pathFor(hash))
        .resize({ width: w, withoutEnlargement: true })
        .webp({ quality: QUALITY[w], effort: 4 })
        .toFile(tmp);
      await rename(tmp, final);
      return final;
    } catch {
      await unlink(tmp).catch(() => {});
      failed.add(`${hash}-w${w}`);
      return null;
    } finally {
      release();
    }
  }

  return {
    dir,
    async ensure(hash, w) {
      if (!enabled || !/^[a-f0-9]{32}$/.test(hash)) return null;
      const key = `${hash}-w${w}`;
      if (failed.has(key)) return null;
      const final = pathFor(hash, w);
      try {
        await access(final);
        return final;
      } catch {
        /* not made yet */
      }
      let job = inflight.get(key);
      if (!job) {
        job = make(hash, w).finally(() => inflight.delete(key));
        inflight.set(key, job);
      }
      return job;
    },
    warm(hash) {
      for (const w of THUMB_WIDTHS) void this.ensure(hash, w);
    },
    async settle() {
      await Promise.allSettled([...inflight.values()]);
    },
    clear() {
      failed.clear();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      try {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
      } catch {
        enabled = false;
      }
    },
    stream: (path) => createReadStream(path),
  };
}

/** The size of a file, or null when it is not there: the async existence check the image routes use. */
export async function fileSize(path: string): Promise<number | null> {
  try {
    const s = await stat(path);
    return s.isFile() ? s.size : null;
  } catch {
    return null;
  }
}
