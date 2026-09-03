import type { DB } from '../db.js';
import { imagesForBrand, productsFor, variantsForBrand, type LibraryProduct } from './rows.js';

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
  };
}
