import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { assetUrl, imgUrl, type Brand, type TreeNode } from '../../api.js';
import { useAppData } from '../../app/AppShell.js';
import { attachableMarks, markLabel } from '../../brand/marks.js';
import { customScenesOf } from '../../brandAssets.js';
import { normalizeTint } from '../../composer/line.js';
import { byContextOrder } from '../../contextChips.js';
import { characterAvatar, presenterAvatar } from '../../presenterVisual.js';
import { presenterPath, productPath, scenePath } from '../../routes.js';

/**
 * What went into the shot, named. A brief already stores its tokens, so the
 * ingredients are a read of the record rather than a guess from the pixels.
 */
export function Ingredients({ brief, brand }: { brief: TreeNode['brief']; brand: Brand | null }) {
  const { scenes, presenters, demoProducts } = useAppData();

  const ownTokens: any[] = brief?.tokens ?? [];
  // What a refinement carried from the shot it refines, recorded apart from
  // what it asked for. Both are the shot's truth; the carried ones read quieter.
  const carriedTokens: any[] = (brief as any)?.inherited ?? [];
  const tokens = [
    ...ownTokens.map((t: any) => ({ ...t, _inherited: false })),
    ...carriedTokens.map((t: any) => ({ ...t, _inherited: true })),
  ];
  if (!tokens.length) return null;
  const products: any[] = (brand?.json?.products ?? []) as any[];
  const cast: any[] = (brand?.json?.characters ?? []) as any[];
  const ownScenes = customScenesOf(brand);
  const marks = attachableMarks(brand?.json);

  type Chip = {
    key: string;
    kind: string;
    label: string;
    thumb?: string | null;
    /** The thumb is a card standing in for an avatar — pull the framing up. */
    crop?: 'top';
    swatch?: string;
    /** Where this ingredient lives in the catalog, when it has a page at all. */
    to?: string;
    tint?: string;
    /** Carried from the shot this one refines, not attached in its own brief. */
    inherited?: boolean;
  };
  const rawChips: Chip[] = tokens.flatMap((t: any): Chip[] => {
    if (t?.t === 'product') {
      const p = products.find((x) => x.id === t.id);
      // A demo product is not in the brand's own products[] — it is resolved at
      // generation time — so without this fallback every Scenri Library product
      // credited itself as the bare word "product".
      const demo = p ? null : demoProducts.find((x) => x.id === t.id);
      return [
        {
          key: `p${t.id}`,
          kind: 'product',
          inherited: !!t._inherited,
          label: p?.name ?? demo?.name ?? 'product',
          thumb: p ? assetUrl(p?.shots?.[0]?.file) : (demo?.previewUrl ?? null),
          // ProductPage resolves demo ids too, so a library product is as
          // openable as one of the brand's own.
          to: brand && (p || demo) ? productPath(brand, t.id) : undefined,
        },
      ];
    }
    if (t?.t === 'character') {
      const c = cast.find((x) => x.id === t.id);
      const pr = c ? null : presenters.find((x) => x.id === t.id);
      // A roster entry is the brand's own copy; only the presenter it was cast
      // from has a page. A person built here is the exception: they are a
      // roster entry that owns their page, under their own id.
      const pid = pr?.id ?? c?.presenterId ?? (c?.origin === 'custom' ? c.id : undefined);
      // The canonical avatar chain — this row used to skip the roster's own
      // square avatar and press the 4:5 card into its 15px circle uncorrected.
      const av = c ? characterAvatar(c) : pr ? presenterAvatar(pr) : { src: null };
      return [
        {
          key: `h${t.id}`,
          kind: 'presenter',
          inherited: !!t._inherited,
          label: c?.name ?? pr?.name ?? 'someone',
          thumb: av.src,
          crop: av.crop,
          to: brand && pid ? presenterPath(brand, pid) : undefined,
        },
      ];
    }
    if (t?.t === 'template') {
      // The brand's own scenes first, the same precedence the compiler uses.
      const s = ownScenes.find((x) => x.id === t.id) ?? scenes.find((x) => x.id === t.id);
      return [
        {
          key: `t${t.id}`,
          kind: 'scene',
          inherited: !!t._inherited,
          label: s?.name ?? 'a scene no longer in the catalog',
          thumb: s?.previewUrl ?? null,
          to: brand && s ? scenePath(brand, s.id) : undefined,
          // The composer tints a scene chip with the scene's own preview
          // colour; the record of that shot says it the same way.
          tint: normalizeTint(s?.previewColor),
        },
      ];
    }
    if (t?.t === 'color') {
      return [
        {
          key: `c${t.hex}`,
          kind: 'color',
          inherited: !!t._inherited,
          label: t.name ?? t.hex,
          swatch: t.hex,
        },
      ];
    }
    // A custom reference and a brand mark are as much of the shot's truth as
    // a product is; they used to be the two ingredients this row silently
    // dropped, which is exactly the invisible-context report.
    if (t?.t === 'ref') {
      return [
        {
          key: `r${t.imageHash}`,
          kind: 'ref',
          inherited: !!t._inherited,
          label: 'reference image',
          thumb: imgUrl(t.imageHash),
        },
      ];
    }
    if (t?.t === 'mark') {
      const m = marks.find((x) => x.hash === t.imageHash);
      return [
        {
          key: `m${t.imageHash}`,
          kind: 'mark',
          inherited: !!t._inherited,
          label: m ? markLabel(brand?.json, m) : 'brand mark',
          thumb: imgUrl(t.imageHash),
        },
      ];
    }
    return [];
  });
  // one canonical reading order, everywhere context is shown
  const chips = rawChips.sort(byContextOrder);
  if (!chips.length) return null;

  return (
    <div className="sc-ingredients">
      {chips.map((c) => {
        const body = (
          <>
            {c.thumb ? (
              <img src={c.thumb} alt="" data-crop={c.crop} />
            ) : c.swatch ? (
              <i style={{ background: c.swatch }} />
            ) : null}
            {c.label}
          </>
        );
        const style = c.tint ? ({ '--tint': c.tint } as CSSProperties) : undefined;
        const said = c.inherited ? `Carried from the shot it refines: ${c.label}` : undefined;
        // Only the ingredients that have a catalog page become links; a colour
        // and a deleted scene stay exactly as static as they read.
        return c.to ? (
          <Link
            className="sc-ingredient"
            key={c.key}
            to={c.to}
            data-kind={c.kind}
            data-tinted={c.tint ? '' : undefined}
            data-inherited={c.inherited || undefined}
            style={style}
            title={said ?? `Open ${c.kind} ${c.label}`}
          >
            {body}
          </Link>
        ) : (
          <span
            className="sc-ingredient"
            key={c.key}
            data-kind={c.kind}
            data-tinted={c.tint ? '' : undefined}
            data-inherited={c.inherited || undefined}
            style={style}
            title={said ?? `${c.kind}: ${c.label}`}
          >
            {body}
          </span>
        );
      })}
    </div>
  );
}
