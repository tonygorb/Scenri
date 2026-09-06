import { useMemo } from 'react';
import { X } from '@phosphor-icons/react';
import { type Brand, type FeedNode, assetThumbUrl, thumbUrl } from '../api.js';
import { useAppData } from '../app/AppShell.js';
import { attachableMarks, markLabel } from '../brand/marks.js';
import { customScenesOf } from '../brandAssets.js';
import { characterAvatar, presenterAvatar } from '../presenterVisual.js';
import { findIngredient } from './ingredientOptions.js';
import { byContextOrder } from '../contextChips.js';
import { carriedKeyOf, mergeCarried } from './line.js';

/**
 * What the next refinement will carry from the shot on the stage, and the
 * one thing you can do about it: leave something out.
 *
 * A refinement borrows the identity of the shot it refines (the product,
 * the person, the mark, the reference) so the engine keeps them the same.
 * That is right until the ask is to take one of them away: "remove the
 * person" used to ship the person along as a reference anyway, and the
 * record then listed them as carried. So the band says what the next
 * refinement keeps and lets you drop a chip; what is dropped is left out of
 * the request by key (`drop`) and never recorded. Said as "Keeping", forward:
 * "carried over" read as a fact about this shot, and on the Original there
 * was nothing carried at all. Nothing here is a scene: the world is kept
 * through the photograph, never as a token.
 */
export interface CarriedItem {
  /** The wire key the server leaves it out by. */
  key: string;
  kind: 'product' | 'presenter' | 'mark' | 'ref';
  label: string;
  thumb: string | null;
  crop?: 'top';
}

/** The identities the server would carry for a refinement of `target`: its own, then what it carried, one per thing. */
export function useCarried(brand: Brand | null, target: FeedNode | null): CarriedItem[] {
  const { presenters, demoProducts } = useAppData();
  return useMemo(() => {
    if (!target?.brief) return [];
    const products: any[] = (brand?.json?.products ?? []) as any[];
    const cast: any[] = (brand?.json?.characters ?? []) as any[];
    const marks = attachableMarks(brand?.json);
    const sources = { products, demoProducts, cast, presenters, scenes: customScenesOf(brand) };
    const { own, carried } = mergeCarried(
      target.brief.tokens ?? [],
      (target.brief as { inherited?: any[] }).inherited ?? [],
    );
    const items: CarriedItem[] = [];
    const seen = new Set<string>();
    for (const t of [...own, ...carried] as any[]) {
      if (!['product', 'character', 'mark', 'ref'].includes(t?.t)) continue;
      const key = carriedKeyOf(t);
      if (seen.has(key)) continue;
      let item: CarriedItem | null = null;
      if (t.t === 'mark') {
        const m = marks.find((x) => x.hash === t.imageHash);
        item = {
          key,
          kind: 'mark',
          label: m ? markLabel(brand?.json, m) : 'Brand mark',
          thumb: thumbUrl(t.imageHash, 'micro'),
        };
      } else if (t.t === 'ref') {
        item = { key, kind: 'ref', label: 'Reference', thumb: thumbUrl(t.imageHash, 'micro') };
      } else {
        const found = findIngredient(t, sources);
        if (found?.kind === 'product') {
          const { product: p, demo } = found;
          if (p || demo) {
            item = {
              key,
              kind: 'product',
              label: p?.name ?? demo?.name ?? 'product',
              thumb: p ? assetThumbUrl(p?.shots?.[0]?.file, 'micro') : (demo?.previewUrl ?? null),
            };
          }
        } else if (found?.kind === 'presenter') {
          const { character: c, presenter: pr } = found;
          if (c || pr) {
            const av = c ? characterAvatar(c) : pr ? presenterAvatar(pr) : { src: null as string | null };
            item = { key, kind: 'presenter', label: c?.name ?? pr?.name ?? 'someone', thumb: av.src, crop: av.crop };
          }
        }
      }
      if (!item) continue;
      seen.add(key);
      items.push(item);
    }
    // the record's order, so the band and the record read the same way
    return items.sort(byContextOrder);
  }, [brand, target, presenters, demoProducts]);
}

export function CarriedBand({ items, onLeaveOut }: { items: CarriedItem[]; onLeaveOut: (key: string) => void }) {
  if (!items.length) return null;
  return (
    <div className="sc-carried-band" data-testid="carried-band">
      <span className="sc-carried-lb">Keeping</span>
      {items.map((it) => (
        <span key={it.key} className="sc-token sc-target-chip sc-carried-chip" data-kind={it.kind} title={it.label}>
          {it.thumb ? <img src={it.thumb} alt="" data-crop={it.crop} /> : null}
          {it.label}
          <button
            type="button"
            onClick={() => onLeaveOut(it.key)}
            aria-label={`Stop keeping ${it.label} in this refinement`}
          >
            <X size={12} />
          </button>
        </span>
      ))}
    </div>
  );
}
