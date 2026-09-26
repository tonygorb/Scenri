import {
  ArrowsClockwise,
  ChartBar,
  CircleHalf,
  DeviceMobile,
  FolderSimple,
  Info,
  Lightning,
  Palette,
  TrashSimple,
  type Icon,
} from '@phosphor-icons/react';
import type { Pane } from '../app/dialogs.js';

/**
 * Settings' pages, one idea each, so a person can guess from the name alone
 * what is behind it. This brand's two pages, then Scenri's own six, then
 * every delete, apart.
 */
export type Page = 'brand' | 'usage' | 'engines' | 'appearance' | 'library' | 'phone' | 'updates' | 'about' | 'danger';

export interface PageDef {
  id: Page;
  label: string;
  Icon: Icon;
  scope: 'brand' | 'studio' | 'apart';
  sub: (brand: string) => string;
  /** A feature a release marks New: its index row says so until the page is opened (DESIGN.md, "New"). */
  feature?: string;
}

export const PAGES: PageDef[] = [
  {
    id: 'brand',
    label: 'Brand kit',
    Icon: Palette,
    scope: 'brand',
    sub: (b) => `What every shot for ${b} can draw on.`,
  },
  {
    id: 'usage',
    label: 'Usage',
    Icon: ChartBar,
    scope: 'brand',
    sub: (b) => `What ${b} has made, one square per day.`,
  },
  {
    id: 'engines',
    label: 'Providers',
    Icon: Lightning,
    scope: 'studio',
    sub: () => 'Where your images are made, and what each may spend.',
  },
  {
    id: 'appearance',
    label: 'Appearance',
    Icon: CircleHalf,
    scope: 'studio',
    sub: () => 'How Scenri looks on this device.',
  },
  {
    id: 'library',
    label: 'Library',
    Icon: FolderSimple,
    scope: 'studio',
    sub: () => 'Your work, as plain files on this computer. Back them up like anything else.',
  },
  {
    id: 'phone',
    label: 'Local access',
    Icon: DeviceMobile,
    scope: 'studio',
    sub: () => 'Open Scenri on your phone, tablet or another computer, or from your desktop.',
    feature: 'local-access',
  },
  {
    id: 'updates',
    label: 'Updates',
    Icon: ArrowsClockwise,
    scope: 'studio',
    sub: () => 'How this copy of Scenri stays current.',
  },
  {
    id: 'about',
    label: 'About',
    Icon: Info,
    scope: 'studio',
    sub: () => 'The copy of Scenri you are running.',
  },
  // Every delete, this brand's included, together and apart from both scopes.
  {
    id: 'danger',
    label: 'Danger zone',
    Icon: TrashSimple,
    scope: 'apart',
    sub: () => 'These do not come back. Export from Library first if you are not certain.',
  },
];

/**
 * Every pane id a caller has ever opened, and the page it lands on. The older
 * ids still land: `general` held the theme and the library, and lands on the
 * theme; `budget` lands on the providers whose caps it names. No link, remedy
 * or deep URL has to know.
 */
export const PAGE_OF: Record<Pane, Page> = {
  brand: 'brand',
  usage: 'usage',
  engines: 'engines',
  budget: 'engines',
  general: 'appearance',
  appearance: 'appearance',
  library: 'library',
  phone: 'phone',
  updates: 'updates',
  about: 'about',
  danger: 'danger',
};

/**
 * Settings opened without a page in mind (the brand menu's Settings). Not a
 * page, so a phone starts on the index while a desktop, which always shows a
 * page beside it, opens on the first one.
 */
export const SETTINGS_INDEX = 'index';

const isPane = (value: string | null): value is Pane =>
  value !== null && Object.prototype.hasOwnProperty.call(PAGE_OF, value);

export const pageOf = (value: string | null): Page => (isPane(value) ? PAGE_OF[value] : 'brand');

/** A phone starts on the index unless something sent it to a page, Brand kit included. */
export const startsOnIndex = (value: string | null): boolean => !isPane(value);
