import { useMemo } from 'react';
import { ArrowCounterClockwise, X } from '@phosphor-icons/react';
import { type Brand, type FeedNode, assetThumbUrl, thumbOf, thumbUrl } from '../api.js';
import { useAppData } from '../app/AppShell.js';
import { attachableMarks, markLabel } from '../brand/marks.js';
import { customScenesOf } from '../brandAssets.js';
import { byContextOrder } from '../contextChips.js';
import { characterAvatar, presenterAvatar } from '../presenterVisual.js';
import { presenterPath, productPath } from '../routes.js';
import { findIngredient } from './ingredientOptions.js';
import { carriedKeyOf, mergeCarried } from './line.js';
import { type PeekAt, useIngredientPeek } from './useIngredientPeek.js';

/**
 * What the next refinement keeps from the shot on the stage, and the one
 * thing you can do about it: stop keeping something.
 *
 * A refinement borrows the identity of the shot it refines (the product,
 * the person, the mark, the reference) so the engine keeps them the same.
 * That is right until the ask is to take one of them away: "remove the
 * person" used to ship the person along as a reference anyway, and the
 * record then listed them as carried. So the band says what the next
 * refinement keeps and lets you switch a chip off; a chip that is off stays
 * in the band, muted, so it can be switched back on before the send, and is
 * left out of the request by key (`drop`) and never recorded. The
 * refinement made without it does not list it at all: it was never carried
 * into that version, so there is nothing to switch. Said as "Keeping",
 * forward: "carried over" read as a fact about this shot, and on the
 * Original there was nothing carried at all. Nothing here is a scene: the
 * world is kept through the photograph, never as a token.
 */
export interface CarriedItem {
  /** The wire key the server leaves it out by. */
  key: string;
  kind: 'product' | 'presenter' | 'mark' | 'ref';
  label: string;
  thumb: string | null;
  crop?: 'top';
  /** The picture the hover peek shows, at a readable size. */
  src: string | null;
  /** The catalog page, when the thing has one: the peek card is a door to it. */
  to?: string;
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
          src: thumbUrl(t.imageHash, 'tile'),
        };
      } else if (t.t === 'ref') {
        item = {
          key,
          kind: 'ref',
          label: 'Reference',
          thumb: thumbUrl(t.imageHash, 'micro'),
          src: thumbUrl(t.imageHash, 'tile'),
        };
      } else {
        const found = findIngredient(t, sources);
        if (found?.kind === 'product') {
          const { product: p, demo } = found;
          if (p || demo) {
            const thumb = p ? assetThumbUrl(p?.shots?.[0]?.file, 'micro') : (demo?.previewUrl ?? null);
            item = {
              key,
              kind: 'product',
              label: p?.name ?? demo?.name ?? 'product',
              thumb,
              src: thumbOf(thumb, 'tile'),
              to: brand ? productPath(brand, t.id) : undefined,
            };
          }
        } else if (found?.kind === 'presenter') {
          const { character: c, presenter: pr } = found;
          if (c || pr) {
            const av = c ? characterAvatar(c) : pr ? presenterAvatar(pr) : { src: null as string | null };
            const pid = pr?.id ?? c?.presenterId ?? (c?.origin === 'custom' ? c.id : undefined);
            item = {
              key,
              kind: 'presenter',
              label: c?.name ?? pr?.name ?? 'someone',
              thumb: av.src,
              crop: av.crop,
              src: thumbOf(av.src, 'tile'),
              to: brand && pid ? presenterPath(brand, pid) : undefined,
            };
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

export function CarriedBand({
  items,
  off,
  onToggle,
}: {
  items: CarriedItem[];
  /** The keys switched off: still shown, muted, and left out of the request. */
  off: readonly string[];
  onToggle: (key: string) => void;
}) {
  // The same peek every read-only ingredient chip has: hovering shows the
  // picture, a click pins the card, and the card is the door to the page.
  const peek = useIngredientPeek('.sc-carried-chip');
  if (!items.length) return null;
  return (
    <div className="sc-carried-band" data-testid="carried-band">
      <span className="sc-carried-lb">Keeping</span>
      {items.map((it) => {
        const isOff = off.includes(it.key);
        const at: PeekAt | null = it.src
          ? { key: it.key, src: it.src, kind: it.kind, label: it.label, to: it.to }
          : null;
        return (
          <span
            key={it.key}
            className="sc-token sc-target-chip sc-carried-chip"
            data-kind={it.kind}
            data-off={isOff || undefined}
            title={peek.isOpen(it.key) ? undefined : isOff ? `${it.label}: not kept in this refinement` : it.label}
            {...(at ? peek.bind(at) : {})}
          >
            {it.thumb ? <img src={it.thumb} alt="" data-crop={it.crop} /> : null}
            {it.label}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggle(it.key);
              }}
              aria-pressed={isOff}
              aria-label={isOff ? `Keep ${it.label} again` : `Stop keeping ${it.label} in this refinement`}
            >
              {isOff ? <ArrowCounterClockwise size={12} /> : <X size={12} />}
            </button>
          </span>
        );
      })}
      {peek.surface}
    </div>
  );
}
