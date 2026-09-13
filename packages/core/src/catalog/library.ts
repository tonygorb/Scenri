import type { DB } from '../db.js';
import { imagesForBrand, productsFor, variantsForBrand, type LibraryProduct } from './rows.js';

/**
 * What a product grid and an ingredient search actually need.
 *
 * The full read carries every image, every hidden image and every variant, and
 * a 600-product store measured 0.78 MB of it - 2.9 MB at gymshark's 2,201 -
 * of which the card reads one field. Variants alone are 813 bytes a product
 * and no client surface reads them at all. This shape is 177 bytes a product,
 * 7.4 times smaller, and it is everything the studio touches outside the
 * product page.
 */
export interface LibraryEntry {
  id: string;
  name: string;
  origin: 'manual' | 'catalog';
  category?: string | null;
  variant?: string | null;
  material?: string | null;
  dimensions?: string | null;
  status?: string;
  /** The first picture only, kept as a one-element `shots` so callers read it unchanged. */
  shots: { file: string; locked?: boolean; angle?: string | null; alt?: string | null }[];
  /** How many pictures the product really has, since `shots` is trimmed. */
  shotCount: number;
}

const lighten = (p: LibraryProduct): LibraryEntry => ({
  id: p.id,
  name: p.name,
  origin: p.origin,
  category: p.category ?? null,
  variant: p.variant ?? null,
  material: p.material ?? null,
  dimensions: p.dimensions ?? null,
  status: p.status,
  shots: p.shots.slice(0, 1),
  shotCount: p.shots.length,
});

export function libraryMethods(db: DB) {
  return {
    listLibraryProducts(brandId: string, brandJson: any): LibraryProduct[] {
      const manual: LibraryProduct[] = ((brandJson?.products ?? []) as any[]).map((p) => ({
        id: p.id,
        name: p.name,
        origin: 'manual' as const,
        category: p.category ?? null,
        variant: p.variant ?? null,
        material: p.material ?? null,
        dimensions: p.dimensions ?? null,
        shots: (p.shots ?? []).map((s: any) => ({
          file: s.file,
          locked: s.locked ?? true,
          angle: s.angle ?? null,
          alt: s.alt ?? s.angle ?? null,
        })),
      }));

      // Three queries for the whole library, whatever its size. This was one
      // query per product for its images and one more for its variants, and
      // the studio read it every four seconds: a 576-product store was 1,153
      // queries per tick.
      const imagesBy = imagesForBrand(db, brandId);
      const variantsBy = variantsForBrand(db, brandId);
      const catalog = productsFor(db, brandId).map((p): LibraryProduct => {
        const images = imagesBy.get(p.id) ?? [];
        const shot = (i: (typeof images)[number]) => ({
          file: i.assetRef!,
          locked: true,
          angle: i.angle,
          alt: i.alt,
          local: String(i.sourceUrl).startsWith('local:'),
        });
        // One picture, one reference. Images are content-addressed, so a store
        // that lists the same file twice arrives as two rows pointing at one
        // asset — which would show as two identical thumbnails, take two of
        // the three slots a shot gets, and make every write to the set fail on
        // an ambiguous handle.
        const seen = new Set<string>();
        const usable = images.filter((i) => i.assetRef && !seen.has(i.assetRef) && seen.add(i.assetRef));
        // Only what the user still counts as this product reaches `shots`, and
        // `shots` is the whole of what the compiler ever sees.
        const shots = usable.filter((i) => !i.excluded).map(shot);
        const hiddenShots = usable.filter((i) => i.excluded).map(shot);
        return {
          id: `cat-${p.id}`,
          name: p.title,
          origin: 'catalog',
          url: p.url,
          descriptionHtml: p.descriptionHtml,
          vendor: p.vendor,
          productType: p.productType,
          tags: p.tags,
          category: p.category,
          variant: p.variant,
          material: p.material,
          dimensions: p.dimensions,
          price: p.price,
          compareAtPrice: p.compareAtPrice,
          currency: p.currency,
          available: p.available,
          status: p.status,
          shots,
          hiddenShots,
          variants: variantsBy.get(p.id) ?? [],
        };
      });

      return [...manual, ...catalog];
    },

    /**
     * The whole library, in the shape the studio reads.
     *
     * Newest first, so an import lands where someone is watching and nothing
     * already on screen moves under them. Manual products keep their place at
     * the head - they are the ones a person made by hand.
     */
    listLibraryIndex(brandId: string, brandJson: any): LibraryEntry[] {
      return this.listLibraryProducts(brandId, brandJson).map((p) =>
        // Only what came from a store. A manual product's pictures are already
        // in the brand document this was built from, so trimming them saves
        // nothing - and the product page asks the server for the whole record
        // only for catalog products, so a hand-made product with four
        // references was left showing one, everywhere, for good.
        p.origin === 'catalog' ? lighten(p) : { ...lighten(p), shots: p.shots, shotCount: p.shots.length },
      );
    },

    /** One product, whole, for the page that shows all of its pictures. */
    libraryProduct(brandId: string, brandJson: any, productId: string): LibraryProduct | null {
      return this.listLibraryProducts(brandId, brandJson).find((p) => p.id === productId) ?? null;
    },
  };
}
