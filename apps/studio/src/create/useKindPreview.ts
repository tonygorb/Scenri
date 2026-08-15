import { useMemo } from 'react';
import { assetUrl } from '../api.js';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { customPresentersOf, customScenesOf } from '../brandAssets.js';
import type { CreateKind } from '../createDraft.js';

export interface KindPreview {
  /** What to show on the card, or null when there is genuinely nothing yet. */
  url: string | null;
  /** How many of these this brand already has. Zero is worth saying out loud. */
  count: number;
  /** True when the picture is the user's own work rather than our catalog. */
  own: boolean;
}

/**
 * A face for each of the three ingredients, taken from this brand's own work
 * first.
 *
 * The point is that the picker is not a poster. Show someone their own bottle,
 * their own cast and their own room and the dialog stops being a generic
 * chooser and starts being their studio — and it keeps improving as they use
 * it, which no fixed set of stock images can do. The catalog is only the
 * fallback for a brand that has not made anything yet, so the card is never an
 * empty rectangle.
 *
 * Deliberately not Home's `createThumbs`: that one de-duplicates across four
 * cards and prefers our catalog for its glyphs. This one prefers yours.
 */
export function useKindPreview(): Record<CreateKind, KindPreview> {
  const { brand, products } = useBrand();
  const { scenes, presenters, demoProducts, showcase } = useAppData();

  return useMemo(() => {
    const mine = {
      presenters: customPresentersOf(brand),
      scenes: customScenesOf(brand),
    };

    // No card may borrow another's picture: three identical rectangles would
    // say the three things are interchangeable, which is the opposite of this
    // dialog's whole point.
    const taken = new Set<string>();
    const claim = (url: string | null | undefined): string | null => {
      if (!url || taken.has(url)) return null;
      taken.add(url);
      return url;
    };
    const firstUrl = <T>(list: T[], pick: (x: T) => string | null | undefined): string | null => {
      for (const x of list) {
        const url = claim(pick(x));
        if (url) return url;
      }
      return null;
    };
    /*
     * A finished shot from the showcase, which is real photography rather than
     * a cut-out on white. The catalog's packshots and roster portraits are
     * lit for a white page; dropped into a dark dialog they read as stickers,
     * so they are the last resort rather than the first.
     */
    const fromShowcase = (kind: 'product' | 'character' | 'template') =>
      firstUrl(
        showcase.filter((sh) => (sh.brief?.tokens ?? []).some((t: any) => t?.t === kind)),
        (sh) => sh.previewUrl,
      );

    // newest first: the thing you just made is the thing you recognise
    const ownProduct = firstUrl([...products].reverse(), (p: any) => assetUrl(p?.shots?.[0]?.file));
    const ownPresenter = firstUrl(mine.presenters, (p) => p.previewUrl);
    const ownScene = firstUrl(mine.scenes, (s) => s.previewUrl);

    return {
      product: {
        url: ownProduct ?? fromShowcase('product') ?? firstUrl(demoProducts, (d) => d.previewUrl) ?? null,
        count: products.length,
        own: !!ownProduct,
      },
      presenter: {
        url:
          ownPresenter ?? fromShowcase('character') ?? firstUrl(presenters, (p) => p.previewUrl ?? p.avatarUrl) ?? null,
        count: mine.presenters.length,
        own: !!ownPresenter,
      },
      scene: {
        // scene previews are already photographs of a place, so they lead
        url: ownScene ?? firstUrl(scenes, (sc) => sc.previewUrl) ?? fromShowcase('template') ?? null,
        count: mine.scenes.length,
        own: !!ownScene,
      },
    };
  }, [brand, products, scenes, presenters, demoProducts, showcase]);
}
