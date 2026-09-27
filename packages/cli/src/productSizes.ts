import { basename } from 'node:path';
import type { Core } from '@scenri/core';
import type { Analyzer } from './customAssets.js';
import { type KnownSize, readSize, resolveSize, sizeFromWords, sizeKey } from './productScale.js';

/**
 * How large each product really is, known without anyone being asked.
 *
 * A size is read once from the product's first photograph and kept, per brand,
 * in the settings store; a size the record came with (a store's listing) is
 * believed over that read, and a person's own correction over both. Nobody is
 * ever asked to fill it in: the product page shows it and lets it be changed.
 *
 * The size that holds reaches every compile as the product's `dimensions`, so
 * a presenter holding it is told how large it is too, not only the two-step
 * draw that needs the number (productScale.ts).
 */
export interface ProductSizes {
  /** What is known now, without reading anything. */
  known(brandId: string, product: { id: string; dimensions?: unknown }): KnownSize | null;
  /** Known, or read from its photograph once and kept. Null when nothing can read it. */
  ensure(
    brandId: string,
    product: { id: string; name: string; dimensions?: unknown; description?: string; photo: string | null },
    signal?: AbortSignal,
  ): Promise<KnownSize | null>;
  /**
   * A person's own size. Empty words take the correction back, and the record
   * or the read stands again; words with no unit to read are refused.
   */
  set(brandId: string, product: { id: string; dimensions?: unknown }, words: string): KnownSize | null | 'unreadable';
  /** Every product in a brand document, carrying the size that holds as its `dimensions`. */
  apply<T>(brandId: string, json: T): T;
}

/**
 * How long a read that found no size stands before the same photograph is read
 * again. A read is a high-effort Codex exec, two when the first answer is
 * rejected, and without this every later look at the product's page and every
 * Generate that could draw it at scale spent it again on the same photograph.
 */
const MISS_MS = 24 * 60 * 60 * 1000;
const missKey = (brandId: string, productId: string) => `product-size-miss:${brandId}:${productId}`;

export function createProductSizes(
  core: Core,
  reader: () => Promise<Analyzer | null>,
  clock: () => number = Date.now,
): ProductSizes {
  /** One read per product at a time: a page and a shot asking at once share it. */
  const reading = new Map<string, Promise<KnownSize | null>>();
  const stored = (brandId: string, id: string) => readSize(core.store.getSetting(sizeKey(brandId, id)));
  const known: ProductSizes['known'] = (brandId, p) => resolveSize(p.dimensions, stored(brandId, p.id));
  /** A miss stands for this photograph only; anything malformed is no miss at all. */
  const missed = (brandId: string, id: string, photo: string) => {
    try {
      const miss = JSON.parse(core.store.getSetting(missKey(brandId, id)) || 'null');
      const age = clock() - Number(miss?.at);
      return miss?.photo === photo && age >= 0 && age < MISS_MS;
    } catch {
      return false;
    }
  };

  return {
    known,

    async ensure(brandId, p, signal) {
      const now = known(brandId, p);
      if (now || !p.photo) return now;
      // The store names a picture by its content hash, so a replaced
      // photograph is a new name and is read at once, whatever missed before.
      const name = basename(p.photo);
      if (missed(brandId, p.id, name)) return null;
      const key = sizeKey(brandId, p.id);
      let read = reading.get(key);
      if (!read) {
        const photo = p.photo;
        read = (async () => {
          const analyzer = await reader();
          // Nothing could read it, so nothing was spent: a reader set up later reads it at once.
          if (!analyzer?.measure) return null;
          let got: { text: string; largestCm: number } | null = null;
          try {
            got = await analyzer.measure(
              { imagePath: photo, name: p.name, ...(p.description ? { description: p.description } : {}) },
              signal,
            );
          } catch {
            // A read that did not finish (the shot was cancelled, a timeout, a usage limit, a lost
            // sign-in) says nothing about the photograph, so nothing is remembered and the next look
            // reads again. Only the reader's own answer that it cannot size it is a miss.
            return null;
          }
          const n = Number(got?.largestCm);
          const text = String(got?.text ?? '').trim();
          if (!text || !Number.isFinite(n) || n <= 0) {
            core.store.setSetting(missKey(brandId, p.id), JSON.stringify({ photo: name, at: clock() }));
            return null;
          }
          const size: KnownSize = { text, largestCm: n, by: 'estimate' };
          core.store.setSetting(key, JSON.stringify(size));
          return size;
        })()
          // Anything else that throws is not a size either, and is not remembered.
          .catch(() => null)
          .finally(() => reading.delete(key));
        reading.set(key, read);
      }
      return read;
    },

    set(brandId, p, words) {
      const key = sizeKey(brandId, p.id);
      const before = stored(brandId, p.id);
      if (!words.trim()) {
        // Back to what the record says, or the read, whichever was there.
        if (before?.by === 'person') core.store.setSetting(key, '');
        return known(brandId, p);
      }
      const size = sizeFromWords(words);
      if (!size) return 'unreadable';
      const mine: KnownSize = { ...size, by: 'person' };
      core.store.setSetting(key, JSON.stringify(mine));
      return mine;
    },

    apply<T>(brandId: string, json: T): T {
      const products: any[] | undefined = (json as any)?.products;
      if (!Array.isArray(products) || !products.length) return json;
      let moved = false;
      const next = products.map((p) => {
        const size = p?.id ? known(brandId, p) : null;
        if (!size || size.text === p.dimensions) return p;
        moved = true;
        return { ...p, dimensions: size.text };
      });
      return moved ? ({ ...(json as any), products: next } as T) : json;
    },
  };
}
