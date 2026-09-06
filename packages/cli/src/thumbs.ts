import { createReadStream, mkdirSync, rmSync } from 'node:fs';
import { access, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Core } from '@scenri/core';

/**
 * Derivatives of the images the store holds, for every surface that shows a
 * picture smaller than it is: the feed tile (640 wide, WebP), the picker tile
 * (320) and the small surfaces (160 wide) such as the rail, the notification
 * rows and the version strip. Content-addressed like the originals, so a
 * derivative is immutable and needs no invalidation. Made when a shot lands
 * and otherwise on first request, never for the whole library at once: a
 * hundred thousand images would be hours of background work and gigabytes
 * for pictures nobody opens.
 *
 * The original stays on `/api/images/:hash` for the stage, compare and export.
 *
 * The curated catalog JPEGs (a presenter's avatar, a scene's preview) live
 * outside the store, so `ensureFile` derives from a path under a caller-chosen
 * key instead of a hash. Same directory, same queue, same failure memo, and
 * the danger zone's `clear()` takes them with everything else.
 */
const THUMB_WIDTHS = [640, 320, 160] as const;
type ThumbWidth = (typeof THUMB_WIDTHS)[number];
/** What a landing shot pre-makes: the feed tile and the chip. The picker's 320 is made on first request. */
const WARM_WIDTHS: readonly ThumbWidth[] = [640, 160];

export const isThumbWidth = (w: unknown): w is ThumbWidth => THUMB_WIDTHS.includes(w as ThumbWidth);
export const THUMB_WIDTH_LIST = THUMB_WIDTHS.join(', ');

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
  /**
   * The same, for a file outside the store. `key` names the source and must
   * change when the source does (the route builds it from the file's mtime),
   * because a derivative is immutable once written.
   */
  ensureFile(key: string, sourcePath: string, w: ThumbWidth): Promise<string | null>;
  /** The warm widths, fire and forget: what a landing shot asks for. */
  warm(hash: string): void;
  /** Wait for whatever is in flight: the drain before the process goes away. */
  settle(): Promise<void>;
  /** Remove every derivative: the danger zone's `scope=all`. */
  clear(): void;
  /** A readable stream of an existing derivative. */
  stream(path: string): ReturnType<typeof createReadStream>;
}

const QUALITY: Record<ThumbWidth, number> = { 640: 82, 320: 80, 160: 75 };
/** A file key: letters, digits and dashes. A store hash is 32 hex and is namespaced apart below. */
const FILE_KEY = /^[a-z0-9-]{1,120}$/;

export function createThumbStore(core: Core, opts: { concurrency?: number } = {}): ThumbStore {
  const dir = join(core.home, 'thumbs');
  let enabled = true;
  try {
    // 0o700 like the images directory: user work, owner's eyes only
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch {
    enabled = false;
  }
  const pathFor = (key: string, w: ThumbWidth) => join(dir, `${key}-w${w}.webp`);
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

  async function make(key: string, source: string, w: ThumbWidth): Promise<string | null> {
    const final = pathFor(key, w);
    const tmp = `${final}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    await acquire();
    try {
      // The store's originals are orientation-baked at write time, and the
      // curated JPEGs ship upright, so no rotate() here. `withoutEnlargement`:
      // a small original stays itself.
      await sharp(source)
        .resize({ width: w, withoutEnlargement: true })
        .webp({ quality: QUALITY[w], effort: 4 })
        .toFile(tmp);
      await rename(tmp, final);
      return final;
    } catch {
      await unlink(tmp).catch(() => {});
      failed.add(`${key}-w${w}`);
      return null;
    } finally {
      release();
    }
  }

  async function ensureKey(key: string, source: string, w: ThumbWidth): Promise<string | null> {
    if (!enabled) return null;
    const memo = `${key}-w${w}`;
    if (failed.has(memo)) return null;
    const final = pathFor(key, w);
    try {
      await access(final);
      return final;
    } catch {
      /* not made yet */
    }
    let job = inflight.get(memo);
    if (!job) {
      job = make(key, source, w).finally(() => inflight.delete(memo));
      inflight.set(memo, job);
    }
    return job;
  }

  return {
    dir,
    async ensure(hash, w) {
      if (!/^[a-f0-9]{32}$/.test(hash)) return null;
      return ensureKey(hash, core.images.pathFor(hash), w);
    },
    async ensureFile(key, sourcePath, w) {
      if (!FILE_KEY.test(key)) return null;
      // `f-` keeps a file key out of the hash namespace, whatever it is called
      return ensureKey(`f-${key}`, sourcePath, w);
    },
    warm(hash) {
      for (const w of WARM_WIDTHS) void this.ensure(hash, w);
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
