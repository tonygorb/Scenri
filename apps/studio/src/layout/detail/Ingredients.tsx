import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { assetUrl, type Brand, type TreeNode } from '../../api.js';
import { useAppData } from '../../app/AppShell.js';
import { customScenesOf } from '../../brandAssets.js';
import { normalizeTint } from '../../composer/line.js';
import { characterAvatar, presenterAvatar } from '../../presenterVisual.js';
import { presenterPath, productPath, scenePath } from '../../routes.js';

/**
 * What went into the shot, named. A brief already stores its tokens, so the
 * ingredients are a read of the record rather than a guess from the pixels.
 */
export function Ingredients({ brief, brand }: { brief: TreeNode['brief']; brand: Brand | null }) {
  const { scenes, presenters, demoProducts } = useAppData();

  const tokens = brief?.tokens ?? [];
  if (!tokens.length) return null;
  const products: any[] = (brand?.json?.products ?? []) as any[];
  const cast: any[] = (brand?.json?.characters ?? []) as any[];
  const ownScenes = customScenesOf(brand);

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
  };
  const chips: Chip[] = tokens.flatMap((t: any): Chip[] => {
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
          label: t.name ?? t.hex,
          swatch: t.hex,
        },
      ];
    }
    return [];
  });
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
        // Only the ingredients that have a catalog page become links; a colour
        // and a deleted scene stay exactly as static as they read.
        return c.to ? (
          <Link
            className="sc-ingredient"
            key={c.key}
            to={c.to}
            data-kind={c.kind}
            data-tinted={c.tint ? '' : undefined}
            style={style}
            title={`Open ${c.kind} ${c.label}`}
          >
            {body}
          </Link>
        ) : (
          <span
            className="sc-ingredient"
            key={c.key}
            data-kind={c.kind}
            data-tinted={c.tint ? '' : undefined}
            style={style}
            title={`${c.kind}: ${c.label}`}
          >
            {body}
          </span>
        );
      })}
    </div>
  );
}
