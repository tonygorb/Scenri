import type { ShowcaseEntry } from './apiTypes.js';

/**
 * The page tours, as data (DESIGN.md, "First use"). A tour is two or three
 * stops on the real surfaces of one of the five main pages; this file says
 * what they teach and when one may begin, and owns no DOM and no state.
 *
 * The copy teaches the studio, not the chrome. Scenri keeps a brand's
 * ingredients (products, presenters, scenes, the brand kit) and a shot is a
 * brief made from them: the chips carry the real references, the words only
 * art-direct around them, and the next shot can still be the same product, the
 * same face, the same place. A title names the job the page does; the body says
 * why it exists. Nothing here walks through a button its own label explains.
 *
 * A stop names its target by selectors, first element with a layout box wins,
 * so a control that only exists at some widths falls back or is skipped rather
 * than stranding the card. `region` is a larger surface the card stays clear
 * of and the veil leaves open, while the pointer still aims at the target.
 */
export type TourId = 'home' | 'create' | 'products' | 'presenters' | 'scenes';
export type TourSide = 'top' | 'bottom' | 'left' | 'right';

export interface TourStop {
  id: string;
  targets: string[];
  title: string;
  body: string;
  /** Where the card prefers to sit. It flips when there is no room, never onto the target. */
  side: TourSide;
  /** The surface around the target that stays open and uncovered, such as the whole composer. */
  region?: string;
  /** The step is already taken when this matches. No stop uses it today: an idea is never done. */
  doneWhen?: string;
  /** Opening this dialog param is doing the step. */
  advanceOnParam?: 'new';
}

export const tourConcept = (id: TourId) => `tour-${id}` as const;

const TOP_BAR_ADD = '.sc-topbar [aria-label="Add to this brand"]';
const COMPOSER = '[data-tour="create.prompt"]';

/** The welcome's words, here so the copy rules cover them with every stop. */
export const WELCOME = {
  lede: 'Product shots on brand, from your products, presenters, scenes and brand kit.',
  note: 'Replay any tour from the ? button.',
  take: 'Take the tour',
  skip: 'Skip tours',
  notNow: 'Not now',
} as const;

export function tourFor(id: TourId): TourStop[] {
  switch (id) {
    case 'home':
      return [
        {
          id: 'home.start',
          targets: ['.sc-create-grid'],
          side: 'bottom',
          title: 'Every shot starts as a brief',
          body: 'A product, a presenter, a scene and your brand, plus a few words of direction. Keep each ingredient once and reuse it in every brief.',
          advanceOnParam: 'new',
        },
        {
          id: 'home.examples',
          targets: ['.sc-masonry[data-wall]'],
          side: 'top',
          title: 'Finished shots are recipes',
          body: 'Each one keeps its product, presenter, scene and direction. Reopen it as a brief and change only what this brand needs.',
        },
        {
          id: 'home.create',
          targets: ['[data-tour="nav.create"]'],
          side: 'bottom',
          title: 'Where your shots are kept',
          body: 'Every shot you make lands in Create. Open one to refine a detail, and the ingredients stay, so the next shot is still on brand.',
        },
      ];
    case 'create':
      return [
        {
          id: 'create.add',
          targets: ['[data-tour="create.add"]'],
          region: COMPOSER,
          side: 'top',
          title: 'Bring in what stays the same',
          body: 'Products, presenters, scenes and your logo come in as chips. Each chip attaches real photos, so the same bottle and the same face come back every time.',
        },
        {
          id: 'create.prompt',
          targets: [COMPOSER],
          region: COMPOSER,
          side: 'top',
          title: 'Art-direct in words',
          body: 'The chips already carry what things look like. Words set the light, the moment and the framing around them.',
        },
        {
          id: 'create.generate',
          targets: ['[data-tour="create.generate"]'],
          region: COMPOSER,
          side: 'top',
          title: 'Make the shot, then refine it',
          body: 'Open any shot to change a detail. The ingredients stay, so every version keeps the same product, person and place.',
        },
      ];
    case 'products':
      return library('products', {
        addTitle: 'Keep what you sell',
        addBody:
          'Save each product once, from a few real photos rather than a sentence. It returns exact in every shot.',
        oursTitle: 'Shoot before your catalog is in',
        oursBody: "Scenri's own products work in any brief today, so the studio is ready while you bring yours in.",
      });
    case 'presenters':
      return library('presenters', {
        addTitle: 'Cast the faces of this brand',
        addBody:
          'Cast a presenter once, from photos of a real person or a description. The same person fronts every shot, not a new stranger each time.',
        oursTitle: 'A cast ready to work',
        oursBody:
          'Each Scenri presenter keeps a reference set, so they stay the same person across a lookbook, a campaign and social.',
      });
    case 'scenes':
      return library('scenes', {
        addTitle: 'Build the worlds you shoot in',
        addBody:
          'A scene is a photoshoot world: a studio, a street, a spa ledge. Build it once from photos or a line of direction, then reuse it.',
        oursTitle: 'A world for each use',
        oursBody:
          "Keep one scene for the lookbook, one for social, one for the pack. Scenri's scenes are ready for any brief.",
      });
  }
}

function library(
  page: string,
  c: { addTitle: string; addBody: string; oursTitle: string; oursBody: string },
): TourStop[] {
  return [
    {
      id: `${page}.add`,
      targets: ['[data-tour="library.add"]', TOP_BAR_ADD],
      side: 'bottom',
      title: c.addTitle,
      body: c.addBody,
      advanceOnParam: 'new',
    },
    {
      id: `${page}.ours`,
      targets: ['[data-tour="library.ours"] .sc-lookcard'],
      side: 'right',
      title: c.oursTitle,
      body: c.oursBody,
    },
  ];
}

/** Which tour belongs to the page on screen. Detail pages, overlays, sets and the studio have none. */
export function pageTourId(m: {
  home: boolean;
  hub: boolean;
  ungrouped: boolean;
  products: boolean;
  presenters: boolean;
  scenes: boolean;
}): TourId | null {
  if (m.home) return 'home';
  if (m.hub && !m.ungrouped) return 'create';
  if (m.products) return 'products';
  if (m.presenters) return 'presenters';
  if (m.scenes) return 'scenes';
  return null;
}

/** The first stop at or after `from` that is not already done and has something to point at. */
export function firstOpenStop(
  stops: readonly TourStop[],
  from: number,
  isDone: (s: TourStop) => boolean,
  isVisible: (s: TourStop) => boolean,
): number {
  for (let i = Math.max(0, from); i < stops.length; i++) {
    if (!isDone(stops[i]) && isVisible(stops[i])) return i;
  }
  return stops.length;
}

/**
 * Where the tour settles. A stop reached by Back, or by Next back through
 * stops already seen, is pinned: it is shown even when its step has since been
 * taken, so reading it again never bounces forward. A pinned stop whose target
 * has gone still gives way, so the tour is never stranded on nothing.
 */
export function settleIndex(
  stops: readonly TourStop[],
  at: number,
  pinned: boolean,
  isDone: (s: TourStop) => boolean,
  isVisible: (s: TourStop) => boolean,
): number {
  return firstOpenStop(stops, at, (s) => !(pinned && stops[at] === s) && isDone(s), isVisible);
}

/** Back is offered only toward a stop that was shown and still has something to point at. */
export function canGoBack(
  behind: readonly { at: number }[],
  stops: readonly TourStop[],
  isVisible: (s: TourStop) => boolean,
): boolean {
  const prev = behind.at(-1);
  return !!prev && !!stops[prev.at] && isVisible(stops[prev.at]);
}

/**
 * The welcome's three pictures: one product shot in three worlds, the studio's
 * promise in a row. The first product in wall order with three examples in
 * different scenes wins; failing that, three of one product; failing that, the
 * first three pictures.
 */
export function welcomeSet(showcase: readonly ShowcaseEntry[]): ShowcaseEntry[] {
  const withPictures = showcase.filter((e) => e.previewUrl);
  const token = (e: ShowcaseEntry, kind: string) =>
    (e.brief?.tokens ?? []).find((t: { t?: string; id?: string }) => t?.t === kind)?.id as string | undefined;
  const byProduct = new Map<string, ShowcaseEntry[]>();
  for (const e of withPictures) {
    const p = token(e, 'product');
    if (!p) continue;
    byProduct.set(p, [...(byProduct.get(p) ?? []), e]);
  }
  for (const group of byProduct.values()) {
    const worlds = new Map<string, ShowcaseEntry>();
    for (const e of group) {
      const scene = token(e, 'template');
      if (scene && !worlds.has(scene)) worlds.set(scene, e);
    }
    if (worlds.size >= 3) return [...worlds.values()].slice(0, 3);
  }
  for (const group of byProduct.values()) if (group.length >= 3) return group.slice(0, 3);
  return withPictures.slice(0, 3);
}

export interface AutoStartInput {
  page: TourId | null;
  eligible: boolean;
  learned: readonly string[];
  /** Something else owns the screen: a dialog, a sheet, the attach panel. */
  paused: boolean;
  /** The page has drawn what its first stop points at. */
  ready: boolean;
  /** Create only: an engine can generate, so the tour does not lead to a dead Generate. */
  engineReady: boolean;
  /** Create only: a refine target is armed. */
  refining: boolean;
  /** A tour is already running. */
  active: boolean;
}

export function canAutoStart(i: AutoStartInput): boolean {
  if (!i.page || i.active || !i.eligible || i.paused || !i.ready) return false;
  if (!i.learned.includes('welcome') || i.learned.includes('tours-off')) return false;
  if (i.learned.includes(tourConcept(i.page))) return false;
  if (i.page === 'create' && (!i.engineReady || i.refining)) return false;
  return true;
}

export interface WelcomeInput {
  page: TourId | null;
  eligible: boolean;
  learned: readonly string[];
  ready: boolean;
  /** The tab is on screen. */
  visible: boolean;
  /** Any dialog, sheet or panel already owns the screen. */
  paused: boolean;
  /** Something is generating or building. */
  busy: boolean;
}

export function canWelcome(i: WelcomeInput): boolean {
  if (!i.page || !i.eligible || i.learned.includes('welcome')) return false;
  return i.ready && i.visible && !i.paused && !i.busy;
}

/** What hides a tour (and holds back the welcome) while it is open. The tour's own card is not one. */
export const PAUSE_SELECTOR = '[role="dialog"]:not(.sc-tour), [role="alertdialog"], .sc-attachpanel, .sc-lightbox';

/**
 * What stays live while a tour holds the page, beside the card and the stop's
 * own surface: every announcement, the toasts that report what just happened,
 * and the update float that may need an answer.
 */
export const TOUR_KEEP_SELECTOR = '[aria-live], .sc-toasts, .sc-upd-float, .sc-upd-overlay';
