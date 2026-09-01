import { useEffect, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { useNavigate } from 'react-router';
import { assetUrl, imgUrl, type Brand, type TreeNode } from '../../api.js';
import { useAppData } from '../../app/AppShell.js';
import { attachableMarks, markLabel } from '../../brand/marks.js';
import { customScenesOf } from '../../brandAssets.js';
import { ChipPreview, isPreviewKind, type PreviewKind } from '../../composer/ChipPreview.js';
import { ImageLightbox } from '../../composer/ImageLightbox.js';
import { identityKeyOf, normalizeTint } from '../../composer/line.js';
import { vibrantTintOf } from '../../composer/sceneTint.js';
import { useHoverPreview } from '../../composer/useHoverPreview.js';
import { byContextOrder } from '../../contextChips.js';
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
  worldTemplateId,
  saidRef,
  expanded,
  hideCarried,
}: {
  brief: TreeNode['brief'];
  /** The compiled prompt, the only record shots made before briefs have. */
  prompt?: string | null;
  brand: Brand | null;
  /** The clamped sentence element, so the caller can measure the clamp. */
  saidRef?: Ref<HTMLDivElement>;
  /** Whether the caller's more-toggle has released the clamp. */
  expanded?: boolean;
  /**
   * The scene the thread was shot in, for a refinement whose own brief names
   * none: a refine keeps its world through the photograph, never as a token,
   * so without this the record was silent about the one ingredient every
   * refine keeps. Display only, resolved by the caller from the lineage.
   */
  worldTemplateId?: string | null;
  /**
   * The sidebar's header already names the carried identities and the world
   * as the source's own cards. Saying them again here is duplication, so
   * carried products, presenters, scenes and the world chip leave the record;
   * carried marks and references have no card up there and stay.
   */
  hideCarried?: boolean;
}) {
  const { scenes, presenters, demoProducts } = useAppData();
  const navigate = useNavigate();
  /** One card for hover-peeks and for chips pinned open by a click alike:
   *  `to` makes the card a door to a catalog page, its absence makes it a
   *  window onto the image (the lightbox). */
  type Peek = { key: string; src: string; kind: PreviewKind; label: string; el: HTMLElement; to?: string };
  const hover = useHoverPreview<Peek>();
  const { shown: hovered, closeNow: closePeek } = hover;
  const [pinned, setPinned] = useState<Peek | null>(null);
  const peek = pinned ?? hovered;
  const closeCard = () => {
    setPinned(null);
    closePeek();
  };
  // A pinned card stays until it is told to go: Escape and the card's own
  // logic close it, and so does a press anywhere that is not a chip or the
  // card itself — without this the card simply could not be put away.
  useEffect(() => {
    if (!pinned) return;
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('.sc-chip-preview') || t?.closest('.sc-ingredient')) return;
      setPinned(null);
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [pinned]);
  const [lightbox, setLightbox] = useState<{ src: string; kind: PreviewKind; label: string | null } | null>(null);

  const ownTokens: any[] = brief?.tokens ?? [];
  // What a refinement carried from the shot it refines, recorded apart from
  // what it asked for. Both are the shot's truth, spoken in one voice.
  const carriedTokens: any[] = (brief as any)?.inherited ?? [];
  const products: any[] = (brand?.json?.products ?? []) as any[];
  const cast: any[] = (brand?.json?.characters ?? []) as any[];
  const ownScenes = customScenesOf(brand);
  const marks = attachableMarks(brand?.json);

  // A custom scene's chip colour, read from its preview the way the catalog
  // colours were authored. Cached per URL by sceneTint, and the state update
  // bails when the key already resolved, so re-renders cost nothing.
  const [autoTints, setAutoTints] = useState<Record<string, string>>({});
  useEffect(() => {
    for (const t of [...ownTokens, ...carriedTokens]) {
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
    /** Carried from the shot this one refines, not attached in its own brief. */
    inherited?: boolean;
    /** The thread's world, kept through the photograph rather than any token. */
    world?: boolean;
    /** A brand-owned scene, wearing the iris treatment the composer gives it. */
    custom?: boolean;
  };

  const chipOf = (t: any, inherited: boolean): Chip | null => {
    if (t?.t === 'product') {
      const p = products.find((x) => x.id === t.id);
      // A demo product is not in the brand's own products[] — it is resolved at
      // generation time — so without this fallback every Scenri Library product
      // credited itself as the bare word "product".
      const demo = p ? null : demoProducts.find((x) => x.id === t.id);
      return {
        key: `p${t.id}`,
        kind: 'product',
        inherited,
        label: p?.name ?? demo?.name ?? 'product',
        thumb: p ? assetUrl(p?.shots?.[0]?.file) : (demo?.previewUrl ?? null),
        // ProductPage resolves demo ids too, so a library product is as
        // openable as one of the brand's own.
        to: brand && (p || demo) ? productPath(brand, t.id) : undefined,
      };
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
      return {
        key: `h${t.id}`,
        kind: 'presenter',
        inherited,
        label: c?.name ?? pr?.name ?? 'someone',
        thumb: av.src,
        crop: av.crop,
        to: brand && pid ? presenterPath(brand, pid) : undefined,
      };
    }
    if (t?.t === 'template') {
      // The brand's own scenes first, the same precedence the compiler uses.
      const own = ownScenes.find((x) => x.id === t.id);
      const s = own ?? scenes.find((x) => x.id === t.id);
      return {
        key: `t${t.id}`,
        kind: 'scene',
        inherited,
        label: s?.name ?? 'a scene no longer in the catalog',
        thumb: s?.previewUrl ?? null,
        to: brand && s ? scenePath(brand, s.id) : undefined,
        // The composer tints a scene chip with the scene's own preview
        // colour; the record of that shot says it the same way.
        tint: normalizeTint(s?.previewColor),
        custom: !!own,
      };
    }
    if (t?.t === 'color') {
      return { key: `c${t.hex}`, kind: 'color', inherited, label: t.name ?? t.hex, swatch: t.hex };
    }
    // A custom reference and a brand mark are as much of the shot's truth as
    // a product is; they used to be the two ingredients the record silently
    // dropped, which is exactly the invisible-context report.
    if (t?.t === 'ref') {
      return {
        key: `r${t.imageHash}`,
        kind: 'ref',
        inherited,
        label: 'reference image',
        thumb: imgUrl(t.imageHash),
        previewHash: t.imageHash,
      };
    }
    if (t?.t === 'mark') {
      const m = marks.find((x) => x.hash === t.imageHash);
      return {
        key: `m${t.imageHash}`,
        kind: 'mark',
        inherited,
        label: m ? markLabel(brand?.json, m) : 'brand mark',
        thumb: imgUrl(t.imageHash),
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
    const said = c.world
      ? `The world this thread was shot in: ${c.label}. A refine keeps it in the picture without asking for it again.`
      : c.inherited
        ? `Carried from the shot it refines: ${c.label}`
        : undefined;
    // A missing thumbnail is not a missing door: the card shows its blank
    // plate and still opens the page, so every catalog chip behaves the same
    // way whether or not its picture loaded.
    const src = (c.previewHash ? imgUrl(c.previewHash) : c.thumb) ?? (c.to ? '' : null);
    if (src !== null && isPreviewKind(c.kind)) {
      const kind = c.kind;
      const open = peek?.key === c.key;
      const at: Omit<Peek, 'el'> = { key: c.key, src, kind, label: c.label, to: c.to };
      return (
        <button
          type="button"
          className="sc-ingredient"
          key={c.key}
          data-kind={c.kind}
          data-tinted={tint ? '' : undefined}
          data-inherited={c.inherited || undefined}
          data-world={c.world || undefined}
          style={style}
          data-open={open || undefined}
          title={open ? undefined : (said ?? `${c.label}. Preview.`)}
          aria-haspopup="dialog"
          aria-label={`${c.label}. Preview.`}
          onPointerEnter={(e) => e.pointerType === 'mouse' && !pinned && hover.open({ ...at, el: e.currentTarget })}
          onPointerLeave={(e) => e.pointerType === 'mouse' && hover.close()}
          onFocus={(e) =>
            e.currentTarget.matches(':focus-visible') && !pinned && hover.open({ ...at, el: e.currentTarget })
          }
          onClick={(e) => {
            // a second press on the pinned chip puts the card away
            if (pinned?.key === c.key) {
              closeCard();
              return;
            }
            closePeek();
            setPinned({ ...at, el: e.currentTarget });
          }}
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
        data-inherited={c.inherited || undefined}
        data-world={c.world || undefined}
        style={style}
        title={said ?? `${c.kind}: ${c.label}`}
      >
        {body}
      </span>
    );
  };

  // One chip per thing: a token that appears both asked-for and carried (or
  // carried at another angle) is the same ingredient, and rendering it twice
  // also collided React keys. Own copies win, so the spoken order survives.
  const seen = new Set<string>();
  const keep = (t: any) => {
    const k = identityKeyOf(t);
    if (!k) return true;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  };

  // The sentence, in the order it was said: text runs stay prose, everything
  // else becomes the chip the composer would show for it.
  const sentence: ReactNode[] = [];
  for (const t of ownTokens) {
    if (t?.t === 'text') {
      const v = typeof t.v === 'string' ? t.v.trim() : '';
      if (v) sentence.push(v);
      continue;
    }
    if (t?.t === 'format') continue;
    if (!keep(t)) continue;
    const c = chipOf(t, false);
    if (c) sentence.push(renderChip(c));
  }

  // What the refinement carried rides after the ask, in the same voice, in
  // the one canonical context order. When the header's source cards are up
  // they already name the carried identities and the world, so those leave
  // this row; a carried mark or reference has no card up there and would be
  // said nowhere, so it stays.
  const trailing: Chip[] = carriedTokens
    .filter((t: any) => t && typeof t.t === 'string' && keep(t))
    .map((t: any) => chipOf(t, true))
    .filter((c: Chip | null): c is Chip => !!c)
    .filter((c: Chip) => !hideCarried || (c.kind !== 'product' && c.kind !== 'presenter' && c.kind !== 'scene'));
  if (worldTemplateId && !hideCarried) {
    const s = ownScenes.find((x) => x.id === worldTemplateId) ?? scenes.find((x) => x.id === worldTemplateId);
    if (s) {
      trailing.push({
        key: `w${worldTemplateId}`,
        kind: 'scene',
        world: true,
        label: s.name,
        thumb: s.previewUrl ?? null,
        to: brand ? scenePath(brand, s.id) : undefined,
      });
    }
  }
  trailing.sort(byContextOrder);

  if (!sentence.length && !trailing.length && !prompt) return null;

  // Inline flow, not a flex row: a chip sits in the sentence exactly where it
  // was typed, so the record wraps like prose. Explicit spaces between
  // pieces, because adjacent JSX expressions render with none.
  const spaced = sentence.flatMap((piece, i) => (i ? [' ', piece] : [piece]));

  return (
    <>
      {/* Only the sentence clamps: the carried chips live in their own row
          below it, so a long brief can never swallow the references behind
          the five-line fold — which is exactly what it used to do. */}
      <div ref={saidRef} className="sc-brief-said" data-expanded={expanded || undefined} dir="auto">
        {spaced.length ? spaced : prompt || ''}
      </div>
      {trailing.length > 0 && <div className="sc-brief-carried">{trailing.map((c) => renderChip(c))}</div>}
      {peek && (
        <ChipPreview
          key={peek.key}
          anchor={peek.el}
          kind={peek.kind}
          src={peek.src}
          label={peek.label}
          onOpen={() => {
            const target = peek;
            closeCard();
            if (target.to) navigate(target.to);
            else setLightbox({ src: target.src, kind: target.kind, label: target.label });
          }}
          onHoverIn={hover.keep}
          onHoverOut={() => !pinned && hover.close()}
          onClose={closeCard}
        />
      )}
      {lightbox && (
        <ImageLightbox
          src={lightbox.src}
          kind={lightbox.kind}
          label={lightbox.label}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
}

/**
 * The refined source's identity, worn as small inverse cards in the sidebar's
 * header: the product, the person and the scene the original image was made
 * of. Each one opens the original picture, the same door the old Refining
 * chip held; the catalogs resolve the labels and thumbnails exactly the way
 * the brief record above them does.
 */
export function SourceChips({
  brand,
  tokens,
  onOpen,
}: {
  brand: Brand | null;
  /**
   * The source's lineage tokens, nearest level first: a refine keeps its
   * contents through the photograph, never as tokens of its own, so the
   * caller walks the whole chain. Products and presenters accumulate; only
   * the nearest scene is the picture's world, so the first one wins and the
   * rest are history.
   */
  tokens: unknown[];
  onOpen: () => void;
}) {
  const { scenes, presenters, demoProducts } = useAppData();
  const products: any[] = (brand?.json?.products ?? []) as any[];
  const cast: any[] = (brand?.json?.characters ?? []) as any[];
  const ownScenes = customScenesOf(brand);

  type Item = { key: string; kind: string; label: string; thumb: string | null; crop?: 'top' };
  const itemOf = (t: any): Item | null => {
    if (t?.t === 'product') {
      const p = products.find((x) => x.id === t.id);
      const demo = p ? null : demoProducts.find((x) => x.id === t.id);
      if (!p && !demo) return null;
      return {
        key: `p${t.id}`,
        kind: 'product',
        label: p?.name ?? demo?.name ?? 'product',
        thumb: p ? assetUrl(p?.shots?.[0]?.file) : (demo?.previewUrl ?? null),
      };
    }
    if (t?.t === 'character') {
      const c = cast.find((x) => x.id === t.id);
      const pr = c ? null : presenters.find((x) => x.id === t.id);
      if (!c && !pr) return null;
      const av = c ? characterAvatar(c) : pr ? presenterAvatar(pr) : { src: null as string | null };
      return {
        key: `h${t.id}`,
        kind: 'presenter',
        label: c?.name ?? pr?.name ?? 'someone',
        thumb: av.src,
        crop: av.crop,
      };
    }
    if (t?.t === 'template') {
      const s = ownScenes.find((x) => x.id === t.id) ?? scenes.find((x) => x.id === t.id);
      if (!s) return null;
      return { key: `t${t.id}`, kind: 'scene', label: s.name, thumb: s.previewUrl ?? null };
    }
    return null;
  };

  const seen = new Set<string>();
  const items: Item[] = [];
  let sceneNamed = false;
  for (const t of tokens as any[]) {
    if (t?.t === 'template' && sceneNamed) continue;
    const it = itemOf(t);
    if (!it || seen.has(it.key)) continue;
    if (it.kind === 'scene') sceneNamed = true;
    seen.add(it.key);
    items.push(it);
  }
  items.sort(byContextOrder);
  if (!items.length) return null;

  return (
    <div className="sc-source-chips">
      {items.map((it) => (
        <button
          type="button"
          className="sc-source-chip"
          key={it.key}
          title={`${it.label}. Open the source image.`}
          aria-label={`Refining a shot of ${it.label}. Open the source image.`}
          onClick={onOpen}
        >
          {it.thumb && <img src={it.thumb} alt="" data-crop={it.crop} />}
          <span dir="auto">{it.label}</span>
        </button>
      ))}
    </div>
  );
}
