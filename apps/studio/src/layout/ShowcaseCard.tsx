import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { ShowcaseEntry } from '../api.js';
import { CatalogCard, CatalogCardSkeleton, type CatalogCardSize } from './CatalogCard.js';
import { useWallDensitySize } from './DensityControl.js';

export type ShowcaseCardSize = CatalogCardSize;

type CreditKey = 'presenter' | 'product' | 'scene';

const CREDIT_ROLE: Record<CreditKey, string> = {
  presenter: 'Presenter',
  product: 'Product',
  scene: 'Scene',
};

type Credit = {
  key: CreditKey;
  name: string;
  previewUrl?: string | null;
  linked: boolean;
  onOpen?: () => void;
};

/**
 * One showcase tile: the generated hero image a real product+presenter+scene
 * recipe produced, not a bare lighting swatch. A thin adapter over
 * `CatalogCard` — see CatalogCard.tsx for the shared shell this, `SceneCard`
 * and `PresenterCard` all render through.
 *
 * `onOpen` doubles as both the whole-card click and the hover-revealed
 * "Recreate this" pill (always `variant="use"` with the same handler for
 * both — no separate `variant` prop, unlike the other cards) — a showcase
 * tile has no separate detail page the way a Scene or Presenter does, so
 * open and use are the same action. The caption's second line names the
 * recipe (product, presenter if any, scene) rather than a category, so
 * hovering tells you what's actually in the shot before you click through.
 *
 * Top-left credits: one glass material for the presenter pill, product/scene
 * thumbs, and the + joins. Hovering any credit portals an 80×80 glass-framed
 * still with a role label.
 */
export function ShowcaseCard({
  entry,
  productName,
  productPreviewUrl,
  productId,
  presenterName,
  presenterPreviewUrl,
  presenterId,
  sceneName,
  scenePreviewUrl,
  sceneId,
  onOpen,
  onOpenProduct,
  onOpenPresenter,
  onOpenScene,
  size = 'grid',
}: {
  entry: ShowcaseEntry;
  /** Resolved from the entry's own product token — a showcase product is always a demo product. */
  productName?: string | null;
  productPreviewUrl?: string | null;
  productId?: string | null;
  presenterName?: string | null;
  presenterPreviewUrl?: string | null;
  /** Present only when the entry names a presenter; drives the badge's link. */
  presenterId?: string | null;
  sceneName?: string | null;
  scenePreviewUrl?: string | null;
  sceneId?: string | null;
  onOpen?: (id: string) => void;
  /** Opens the product's own page. Omit to keep the chip a plain credit. */
  onOpenProduct?: (productId: string) => void;
  /** Opens the presenter's own page. Omit to keep the badge a plain credit. */
  onOpenPresenter?: (presenterId: string) => void;
  /** Opens the scene's own page. Omit to keep the chip a plain credit. */
  onOpenScene?: (sceneId: string) => void;
  size?: ShowcaseCardSize;
}) {
  const recipe = [productName, presenterName, sceneName].filter(Boolean).join(' · ');

  const presenter: Credit | null = presenterName
    ? {
        key: 'presenter',
        name: presenterName,
        previewUrl: presenterPreviewUrl,
        linked: !!(onOpenPresenter && presenterId),
        onOpen: onOpenPresenter && presenterId ? () => onOpenPresenter(presenterId) : undefined,
      }
    : null;
  const product: Credit | null =
    productPreviewUrl && productName
      ? {
          key: 'product',
          name: productName,
          previewUrl: productPreviewUrl,
          linked: !!(onOpenProduct && productId),
          onOpen: onOpenProduct && productId ? () => onOpenProduct(productId) : undefined,
        }
      : null;
  const scene: Credit | null =
    scenePreviewUrl && sceneName
      ? {
          key: 'scene',
          name: sceneName,
          previewUrl: scenePreviewUrl,
          linked: !!(onOpenScene && sceneId),
          onOpen: onOpenScene && sceneId ? () => onOpenScene(sceneId) : undefined,
        }
      : null;

  return (
    <div className="sc-showcase-tile">
      <CatalogCard
        id={entry.id}
        previewUrl={entry.previewUrl}
        title={entry.title}
        primary={entry.title}
        secondary={recipe}
        useLabel="Recreate this"
        variant="use"
        onOpen={onOpen}
        onUse={onOpen}
        size={size}
      />
      {(presenter || product || scene) && <CreditRow presenter={presenter} product={product} scene={scene} />}
    </div>
  );
}

/** One skeleton shape, every list that hasn't resolved the showcase gallery yet. */
export function ShowcaseCardSkeleton(props: { size?: ShowcaseCardSize; count?: number }) {
  return <CatalogCardSkeleton {...props} />;
}

/** Presenter + recipe thumbs; one open preview tip shared across all credits. */
function CreditRow({
  presenter,
  product,
  scene,
}: {
  presenter: Credit | null;
  product: Credit | null;
  scene: Credit | null;
}) {
  const [tip, setTip] = useState<CreditKey | null>(null);
  const thumbs = [product, scene].filter(Boolean) as Credit[];
  const n = thumbs.length + (presenter ? 1 : 0) + Math.max(0, thumbs.length - 1);
  let i = 0;
  const idx = (): CSSProperties => ({ ['--i']: i++ }) as CSSProperties;

  return (
    <div className="sc-showcase-chips" onMouseLeave={() => setTip(null)}>
      {presenter && (
        <CreditTip credit={presenter} open={tip === 'presenter'} onEnter={() => setTip('presenter')}>
          {presenterPill(presenter)}
        </CreditTip>
      )}
      {thumbs.length > 0 && (
        <div className="sc-showcase-recipe" style={{ ['--n']: n } as CSSProperties}>
          {presenter && <span className="sc-showcase-join" style={idx()} aria-hidden />}
          {thumbs.map((t, ti) => (
            <Fragment key={t.key}>
              {ti > 0 && <span className="sc-showcase-join" style={idx()} aria-hidden />}
              <CreditTip credit={t} open={tip === t.key} onEnter={() => setTip(t.key)} style={idx()}>
                {roundChip({ credit: t, step: ti === 0 ? 1 : 2 })}
              </CreditTip>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

/** 80×80 floating still above the credit, with a role label (Presenter /
 * Product / Scene). Portaled so sticky chrome can't cover it.
 * Positioned with left/top only — no transform on the pop, or backdrop-filter
 * glass fails to sample the page behind it. */
function CreditTip({
  credit,
  open,
  onEnter,
  children,
  style,
}: {
  credit: Credit;
  open: boolean;
  onEnter: () => void;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const size = useWallDensitySize();
  const tipW = size === 'large' ? 144 : 88;
  const tipH = size === 'large' ? 168 : 112;

  useLayoutEffect(() => {
    if (!open || !credit.previewUrl) {
      setPos(null);
      return;
    }
    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const pop = popRef.current;
      const pw = pop?.offsetWidth || tipW;
      const ph = pop?.offsetHeight || tipH;
      const gap = 8;
      const above = r.top >= ph + gap + 12;
      setPos({
        left: Math.round(r.left + r.width / 2 - pw / 2),
        top: Math.round(above ? r.top - gap - ph : r.bottom + gap),
      });
    };
    place();
    const raf = requestAnimationFrame(place);
    const el = anchorRef.current;
    const ro = el ? new ResizeObserver(place) : null;
    if (el && ro) ro.observe(el);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, credit.previewUrl, credit.key, tipW, tipH]);

  if (!credit.previewUrl) {
    return (
      <span ref={anchorRef} className="sc-credit-tip" onPointerEnter={onEnter} style={style}>
        {children}
      </span>
    );
  }

  const role = CREDIT_ROLE[credit.key];

  return (
    <span
      ref={anchorRef}
      className="sc-credit-tip"
      data-open={open || undefined}
      onPointerEnter={onEnter}
      style={style}
    >
      {children}
      {open &&
        createPortal(
          <span
            ref={popRef}
            className="sc-credit-tip-pop"
            data-size={size}
            style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
            role="tooltip"
            aria-label={`${role}: ${credit.name}`}
          >
            <span className="sc-credit-tip-card">
              <img src={credit.previewUrl} alt="" />
              {/* The name was reaching only the aria-label, so a sighted user
                  got a picture and the word "Product" and no way to learn what
                  it was called. This is the surface with the most room on the
                  whole tile — it should carry the name the card had to clip. */}
              <span className="sc-credit-tip-name">{credit.name}</span>
              <span className="sc-credit-tip-role">{role}</span>
            </span>
          </span>,
          document.body,
        )}
    </span>
  );
}

function stopCardClick(e: MouseEvent, onOpen?: () => void) {
  // The credit sits on top of the card's own open handler; without this the
  // click would start a recipe instead of opening the credit's page.
  e.stopPropagation();
  e.preventDefault();
  onOpen?.();
}

/** Product / scene: bare circular thumb. */
function roundChip({ credit, step }: { credit: Credit; step: 1 | 2 }): ReactNode {
  const { name, previewUrl, linked, onOpen } = credit;
  if (linked) {
    return (
      <button
        type="button"
        className="sc-showcase-chip"
        data-link
        data-step={step}
        aria-label={`See ${name}`}
        onClick={(e) => stopCardClick(e, onOpen)}
      >
        {previewUrl ? <img src={previewUrl} alt="" /> : null}
      </button>
    );
  }
  return (
    <span className="sc-showcase-chip" data-step={step} aria-label={name}>
      {previewUrl ? <img src={previewUrl} alt="" /> : null}
    </span>
  );
}

/** Presenter: its own glass pill (avatar + name). */
function presenterPill(credit: Credit): ReactNode {
  const { name, previewUrl, linked, onOpen } = credit;
  if (linked) {
    return (
      <button
        type="button"
        className="sc-showcase-badge"
        data-link
        aria-label={`See ${name}`}
        onClick={(e) => stopCardClick(e, onOpen)}
      >
        {previewUrl ? <img src={previewUrl} alt="" /> : null}
        <span className="sc-showcase-badge-name">{name}</span>
      </button>
    );
  }
  return (
    <span className="sc-showcase-badge" aria-hidden>
      {previewUrl ? <img src={previewUrl} alt="" /> : null}
      <span className="sc-showcase-badge-name">{name}</span>
    </span>
  );
}
