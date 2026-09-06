import { useEffect, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { type Brand, type FeedNode, thumbUrl, assetThumbUrl, thumbOf } from '../../api.js';
import { useAppData } from '../../app/AppShell.js';
import { attachableMarks, markLabel } from '../../brand/marks.js';
import { customScenesOf } from '../../brandAssets.js';
import { findIngredient } from '../../composer/ingredientOptions.js';
import { isPreviewKind } from '../../composer/ChipPreview.js';
import { normalizeTint } from '../../composer/line.js';
import { vibrantTintOf } from '../../composer/sceneTint.js';
import { type PeekAt, useIngredientPeek } from '../../composer/useIngredientPeek.js';
import { characterAvatar, presenterAvatar } from '../../presenterVisual.js';
import { presenterPath, productPath, scenePath } from '../../routes.js';

/**
 * The stored brief, read back in the composer's own voice: the sentence that
 * was typed with its ingredient chips inline, in the order they were said,
 * and what the refinement carried riding after it in the same voice. One
 * statement — there is no separate chips row and no separate prose.
 *
 * Nothing here navigates away from the shot directly: a chip peeks on hover
 * and pins its preview card on click, and the card is the door — to the
 * catalog page for the things that have one, to the lightbox for the images
 * themselves. A second click on the chip, Escape, or a click anywhere else
 * puts the card away.
 */
export function BriefLine({
  brief,
  prompt,
  brand,
  saidRef,
  expanded,
  clamped,
}: {
  brief: FeedNode['brief'];
  /** The compiled prompt, the only record shots made before briefs have. */
  prompt?: string | null;
  brand: Brand | null;
  /** The clamped sentence element, so the caller can measure the clamp. */
  saidRef?: Ref<HTMLDivElement>;
  /** Whether the caller's more-toggle has released the clamp. */
  expanded?: boolean;
  /** Whether the clamp is biting, so the last row can dissolve into the release. */
  clamped?: boolean;
}) {
  const { scenes, presenters, demoProducts } = useAppData();
  const peek = useIngredientPeek('.sc-ingredient');

  const ownTokens: any[] = brief?.tokens ?? [];
  // What a refinement carried from the shot it refines, recorded apart from
  // what it asked for. Both are the shot's truth, spoken in one voice.
  const products: any[] = (brand?.json?.products ?? []) as any[];
  const cast: any[] = (brand?.json?.characters ?? []) as any[];
  const ownScenes = customScenesOf(brand);
  const marks = attachableMarks(brand?.json);

  // A custom scene's chip colour, read from its preview the way the catalog
  // colours were authored. Cached per URL by sceneTint, and the state update
  // bails when the key already resolved, so re-renders cost nothing.
  const [autoTints, setAutoTints] = useState<Record<string, string>>({});
  useEffect(() => {
    for (const t of ownTokens) {
      if (t?.t !== 'template') continue;
      const own = ownScenes.find((x) => x.id === t.id);
      if (!own?.previewUrl || normalizeTint(own.previewColor)) continue;
      const key = `t${t.id}`;
      void vibrantTintOf(own.previewUrl).then((hex) => {
        const tint = normalizeTint(hex ?? undefined);
        if (tint) setAutoTints((s) => (s[key] ? s : { ...s, [key]: tint }));
      });
    }
  });

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
    /** The image the chip itself IS, for the hover peek and the lightbox. */
    previewHash?: string;
    /** A brand-owned scene, wearing the iris treatment the composer gives it. */
    custom?: boolean;
  };

  // The one lookup every surface uses (ingredientOptions.ts, findIngredient):
  // the brand's own record first, then the shipped one of the same id. A demo
  // product is not in the brand's own products[] — it is resolved at
  // generation time — so without the fallback every Scenri Library product
  // credited itself as the bare word "product".
  const sources = { products, demoProducts, cast, presenters, scenes: [...ownScenes, ...scenes] };
  const chipOf = (t: any): Chip | null => {
    const found = findIngredient(t, sources);
    if (found?.kind === 'product') {
      const { product: p, demo } = found;
      return {
        key: `p${t.id}`,
        kind: 'product',
        label: p?.name ?? demo?.name ?? 'product',
        thumb: p ? assetThumbUrl(p?.shots?.[0]?.file, 'micro') : (demo?.previewUrl ?? null),
        // ProductPage resolves demo ids too, so a library product is as
        // openable as one of the brand's own.
        to: brand && (p || demo) ? productPath(brand, t.id) : undefined,
      };
    }
    if (found?.kind === 'presenter') {
      const { character: c, presenter: pr } = found;
      // A roster entry is the brand's own copy; only the presenter it was cast
      // from has a page. A person built here is the exception: they are a
      // roster entry that owns their page, under their own id.
      const pid = pr?.id ?? c?.presenterId ?? (c?.origin === 'custom' ? c.id : undefined);
      // The canonical avatar chain — this row used to skip the roster's own
      // square avatar and press the 4:5 card into its 15px circle uncorrected.
      const av = c ? characterAvatar(c) : pr ? presenterAvatar(pr) : { src: null };
      return {
        key: `h${t.id}`,
        kind: 'presenter',
        label: c?.name ?? pr?.name ?? 'someone',
        thumb: av.src,
        crop: av.crop,
        to: brand && pid ? presenterPath(brand, pid) : undefined,
      };
    }
    if (found?.kind === 'scene') {
      const s = found.scene;
      return {
        key: `t${t.id}`,
        kind: 'scene',
        label: s?.name ?? 'a scene no longer in the catalog',
        thumb: s?.previewUrl ?? null,
        to: brand && s ? scenePath(brand, s.id) : undefined,
        // The composer tints a scene chip with the scene's own preview
        // colour; the record of that shot says it the same way.
        tint: normalizeTint(s?.previewColor),
        custom: found.custom,
      };
    }
    if (t?.t === 'color') {
      return { key: `c${t.hex}`, kind: 'color', label: t.name ?? t.hex, swatch: t.hex };
    }
    // A custom reference and a brand mark are as much of the shot's truth as
    // a product is; they used to be the two ingredients the record silently
    // dropped, which is exactly the invisible-context report.
    if (t?.t === 'ref') {
      return {
        key: `r${t.imageHash}`,
        kind: 'ref',
        label: t.label ?? 'reference image',
        thumb: thumbUrl(t.imageHash, 'micro'),
        previewHash: t.imageHash,
      };
    }
    if (t?.t === 'mark') {
      const m = marks.find((x) => x.hash === t.imageHash);
      return {
        key: `m${t.imageHash}`,
        kind: 'mark',
        label: m ? markLabel(brand?.json, m) : 'brand mark',
        thumb: thumbUrl(t.imageHash, 'micro'),
        previewHash: t.imageHash,
      };
    }
    return null;
  };

  const renderChip = (c: Chip) => {
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
    // A custom scene's tint arrives from its own preview (sceneTint), the same
    // scoring that authored the catalog colours; catalog chips carry theirs.
    const tint = c.tint ?? (c.custom ? autoTints[c.key] : undefined);
    const style = tint ? ({ '--tint': tint } as CSSProperties) : undefined;
    // A missing thumbnail is not a missing door: the card shows its blank
    // plate and still opens the page, so every catalog chip behaves the same
    // way whether or not its picture loaded.
    const src = (c.previewHash ? thumbUrl(c.previewHash, 'tile') : thumbOf(c.thumb, 'tile')) ?? (c.to ? '' : null);
    if (src !== null && isPreviewKind(c.kind)) {
      const kind = c.kind;
      const open = peek.isOpen(c.key);
      const at: PeekAt = { key: c.key, src, kind, label: c.label, to: c.to };
      return (
        <button
          type="button"
          className="sc-ingredient"
          key={c.key}
          data-kind={c.kind}
          data-tinted={tint ? '' : undefined}
          style={style}
          title={open ? undefined : `${c.label}. Preview.`}
          aria-label={`${c.label}. Preview.`}
          {...peek.bind(at)}
        >
          {body}
        </button>
      );
    }
    return (
      <span
        className="sc-ingredient"
        key={c.key}
        data-kind={c.kind}
        data-tinted={tint ? '' : undefined}
        style={style}
        title={`${c.kind}: ${c.label}`}
      >
        {body}
      </span>
    );
  };

  // The sentence, in the order it was said: text runs stay prose, everything
  // else becomes the chip the composer would show for it. Only what this
  // shot asked for: what a refinement carries is the composer's band to
  // say, where it can also be left out; saying it here too was the same
  // list twice on one screen.
  const sentence: ReactNode[] = [];
  for (const t of ownTokens) {
    if (t.t === 'text') {
      const v = t.v.trim();
      if (v) sentence.push(v);
      continue;
    }
    const c = chipOf(t);
    if (c) sentence.push(renderChip(c));
  }

  if (!sentence.length && !prompt) return null;

  // Inline flow, not a flex row: a chip sits in the sentence exactly where it
  // was typed, so the record wraps like prose. Explicit spaces between
  // pieces, because adjacent JSX expressions render with none.
  const spaced = sentence.flatMap((piece, i) => (i ? [' ', piece] : [piece]));

  return (
    <>
      <div
        ref={saidRef}
        className="sc-brief-said"
        data-expanded={expanded || undefined}
        data-clamped={clamped || undefined}
        dir="auto"
      >
        {spaced.length ? spaced : prompt || ''}
      </div>
      {peek.surface}
    </>
  );
}
