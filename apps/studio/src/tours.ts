/**
 * The page tours, as data (DESIGN.md, "First use"). A tour is two or three
 * stops on the real controls of one of the five main pages; this file says
 * what they are and when one may begin, and owns no DOM and no state.
 *
 * A stop names its target by selectors, first element with a layout box
 * wins, so a control that only exists at some widths falls back or is
 * skipped rather than stranding the card. `doneWhen` is a selector that
 * proves the step is already taken, so a person who arrives mid-task is
 * never taught what they just did.
 */
export type TourId = 'home' | 'create' | 'products' | 'presenters' | 'scenes';

export interface TourStop {
  id: string;
  targets: string[];
  title: string;
  body: string;
  /** The card opens clear of this element as well as the target. */
  clearOf?: string;
  /** The step is already taken when this matches. */
  doneWhen?: string;
  /** Opening this dialog param is doing the step. */
  advanceOnParam?: 'new';
}

export const tourConcept = (id: TourId) => `tour-${id}` as const;

const TOP_BAR_ADD = '.sc-topbar [aria-label="Add to this brand"]';

export function tourFor(id: TourId, o: { touch: boolean; ownsProducts: boolean }): TourStop[] {
  switch (id) {
    case 'home':
      return [
        {
          id: 'home.start',
          targets: ['.sc-create-grid'],
          title: 'Start here',
          body: 'Create an image starts a new shot. The other three bring in your own product, presenter or scene.',
          advanceOnParam: 'new',
        },
        {
          id: 'home.examples',
          targets: ['.sc-masonry[data-wall]'],
          title: 'Or start from an example',
          body: 'Recreate this on any example opens its recipe, ready to change.',
        },
        {
          id: 'home.create',
          targets: ['[data-tour="nav.create"]'],
          title: 'Your shots live in Create',
          body: 'Everything you make lands there, ready to open and refine.',
        },
      ];
    case 'create': {
      const what = o.ownsProducts ? 'your products, a presenter or a scene' : 'a product, a presenter or a scene';
      return [
        {
          id: 'create.add',
          targets: ['[data-tour="create.add"]'],
          clearOf: '[data-tour="create.prompt"]',
          doneWhen: '[data-tour="create.prompt"][data-ingredients]',
          title: 'Add what goes in the shot',
          body: o.touch ? `Tap + for ${what}.` : `Press + for ${what}, or type $, @ or / in the prompt.`,
        },
        {
          id: 'create.prompt',
          targets: ['[data-tour="create.prompt"]'],
          clearOf: '[data-tour="create.prompt"]',
          doneWhen: '[data-tour="create.prompt"][data-words]',
          title: 'Say what you want',
          body: 'Describe the shot in your own words, around what you added.',
        },
        {
          id: 'create.generate',
          targets: ['[data-tour="create.generate"]'],
          clearOf: '[data-tour="create.prompt"]',
          title: 'Make it',
          body: 'Generate makes your shot. When it lands, open it to refine it.',
        },
      ];
    }
    case 'products':
      return library(
        'products',
        'Add your product',
        'A few photos and a name. It opens a short form, and your store can be imported from there too.',
        'Every product below works in a shot today. Open one, or choose Use in a shot.',
      );
    case 'presenters':
      return library(
        'presenters',
        'Cast your own',
        'A short conversation: describe someone, or add photos of a real person.',
        'Every presenter below is ready for a shot. Open one to see their reference set.',
      );
    case 'scenes':
      return library(
        'scenes',
        'Build your own',
        'A name, plus a few photos or one line of direction.',
        'Every scene below is ready for a shot. Bookmark the ones you like and they gather in their own tab.',
      );
  }
}

function library(page: string, addTitle: string, addBody: string, oursBody: string): TourStop[] {
  return [
    {
      id: `${page}.add`,
      targets: ['[data-tour="library.add"]', TOP_BAR_ADD],
      title: addTitle,
      body: addBody,
      advanceOnParam: 'new',
    },
    {
      id: `${page}.ours`,
      targets: ['[data-tour="library.ours"] .sc-lookcard'],
      title: 'Try one now',
      body: oursBody,
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
