import { type ReactNode, useReducer } from 'react';
import { useLocation, useMatch } from 'react-router';
import { FilmSlate, House, IdentificationBadge, Package, PlusCircle } from '@phosphor-icons/react';
import { type Brand, assetThumbUrl } from '../api.js';
import { avatarMark, bleedPoints, fitsCircle, isFullBleed } from '../brand/marks.js';
import { useBrand } from '../app/BrandLayout.js';
import { P, brandPath, hubPath, scenesPath, presentersPath, productsPath } from '../routes.js';

/**
 * The five destinations, shared by the bar and the sheet. They live here rather
 * than in TopBar so the two navs cannot drift: a label or an active rule fixed
 * in one is fixed in both.
 */
export interface NavItem {
  key: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  /**
   * A real destination, not a handler: the bars render it as a Link, so a
   * middle click, a Cmd click and the context menu all behave like the web.
   */
  to: string;
}

/**
 * The nav reads where it is from the router, so no screen can hand it a wrong
 * answer.
 *
 * Create used to open a picker asking which project to work in, and did nothing
 * at all once you were already inside one — which is the single place people
 * press it twice. It is an ordinary destination now: the hub holding everything
 * this brand has made, and the brief that makes more.
 */
export function useMainNav(iconSize: number): NavItem[] {
  const { brand } = useBrand();
  const { pathname } = useLocation();

  // Asking the router where we are, rather than slicing the pathname against a
  // string built from the brand's slug. That comparison had to reconcile a
  // percent-encoded pathname with a decoded slug by hand, and when it got it
  // wrong the remainder came back empty — which read as Home, so the nav lit
  // Home on every one of these four screens. useMatch answers from the same
  // patterns the route table is built from, so it cannot disagree with it.
  // Hooks are taken unconditionally: React counts them by position.
  const home = !!useMatch(P.brand);
  // a set is the hub wearing a filter, so it lights the same lamp
  const onHub = !!useMatch({ path: P.hub, end: false });
  const inSet = !!useMatch({ path: P.set, end: false });
  const create = onHub || inSet;
  const products = !!useMatch({ path: P.products, end: false });
  const scenes = !!useMatch({ path: P.scenes, end: false });
  const presenters = !!useMatch({ path: P.presenters, end: false });

  // the glyph fills where you are: a real Phosphor weight, not a stroked icon
  // told to fill, which thickens the counters and reads as a smudge
  const w = (on: boolean) => (on ? ('fill' as const) : ('regular' as const));

  return [
    {
      key: 'home',
      label: 'Home',
      icon: <House size={iconSize} weight={w(home)} />,
      active: home,
      to: brandPath(brand),
    },
    {
      key: 'create',
      label: 'Create',
      icon: <PlusCircle size={iconSize} weight={w(create)} />,
      active: create,
      // already there: put the caret in the brief rather than reload the screen
      to: create ? `${pathname}?compose=1` : `${hubPath(brand)}?compose=1`,
    },
    {
      key: 'products',
      label: 'Products',
      icon: <Package size={iconSize} weight={w(products)} />,
      active: products,
      to: productsPath(brand),
    },
    {
      key: 'presenters',
      label: 'Presenters',
      icon: <IdentificationBadge size={iconSize} weight={w(presenters)} />,
      active: presenters,
      to: presentersPath(brand),
    },
    {
      key: 'scenes',
      label: 'Scenes',
      icon: <FilmSlate size={iconSize} weight={w(scenes)} />,
      active: scenes,
      to: scenesPath(brand),
    },
  ];
}

export const brandName = (b: Brand): string => b.json?.meta?.name ?? b.slug;

/** First letter that carries meaning, which is not always the first character. */
export function monogram(name: string): string {
  const first = [...name.trim()].find((c) => /\p{L}|\p{N}/u.test(c));
  return (first ?? '?').toUpperCase();
}

/** Black or white, whichever the brand's own colour can actually carry. */
export function inkOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#ffffff';
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(m[1].slice(i, i + 2), 16) / 255);
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.42 ? '#0a0a0a' : '#ffffff';
}

/** How a logo sits in a circle, once measured: whether it fits, and whether it is its own ground. */
interface Fit {
  fits: boolean;
  bleed: boolean;
}
/** Logos already measured, by URL: a menu opening again draws each answer at once. */
const fitByUrl = new Map<string, Fit>();

/**
 * Measured once it has loaded. A declared icon fits by the kit's word; any other
 * logo fits if it is no wider than a circle shows. Whether it bleeds is read off
 * its own pixels (same-origin, so the canvas can be read), and an image that
 * cannot be read keeps the plate, which is never wrong, only plainer.
 */
function measure(img: HTMLImageElement, square: boolean): Fit {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const fits = square || fitsCircle(w, h);
  let bleed = false;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    if (g) {
      g.drawImage(img, 0, 0);
      bleed = isFullBleed(bleedPoints(w, h).map(([x, y]) => g.getImageData(x, y, 1, 1).data[3]));
    }
  } catch {
    /* unreadable pixels keep the plate */
  }
  return { fits, bleed };
}

/**
 * A 7px square of colour said "a brand exists". This says which one: the kit's
 * own icon or logo when a circle can hold it, and otherwise its initial on its
 * own primary, which is what every workspace switcher worth copying does.
 *
 * A wordmark shrunk into a circle is not a logo, it is a smudge: a row of them
 * read as noise. So a logo is measured when it loads and drawn only if it is no
 * wider than a circle can show. An icon that is its own ground (a white swoosh
 * on black) fills the circle; a logo on transparency sits on the white plate.
 * Drawn the other way, a solid square sat inside a white ring. Until the answer
 * is in, the initial stands in, so nothing flashes up in the wrong shape.
 */
export function BrandAvatar({ brand, size = 20, round = false }: { brand: Brand; size?: number; round?: boolean }) {
  const [, measured] = useReducer((n: number) => n + 1, 0);
  const pick = avatarMark(brand.json);
  // a 20px circle reads the small derivative; the mark's own file is for the kit
  const src = pick ? assetThumbUrl(pick.mark.file, 'micro') : null;
  const fit = src ? fitByUrl.get(src) : undefined;
  const logo = src && fit?.fits ? src : null;
  const hex: string = brand.json?.palette?.primary?.hex ?? '#6b6b6b';
  return (
    <span
      className="sc-brand-av"
      data-logo={logo ? '' : undefined}
      data-bleed={logo && fit?.bleed ? '' : undefined}
      data-round={round || undefined}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.5),
        ...(logo ? {} : { background: hex, color: inkOn(hex) }),
      }}
      aria-hidden
    >
      {logo ? <img src={logo} alt="" /> : monogram(brandName(brand))}
      {src && !fit && (
        <img
          src={src}
          alt=""
          hidden
          onLoad={(e) => {
            fitByUrl.set(src, measure(e.currentTarget, Boolean(pick?.square)));
            measured();
          }}
        />
      )}
    </span>
  );
}
