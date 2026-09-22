import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  CaretLeft,
  CaretRight,
  ChartBar,
  Check,
  Info,
  Lightning,
  Palette,
  SlidersHorizontal,
  TrashSimple,
  X,
  type Icon,
} from '@phosphor-icons/react';
import { api, type EngineInfo, type VersionInfo } from '../api.js';
import { useDialogParam } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import type { Pane } from '../app/dialogs.js';
import { DialogSheet, SheetClose, SheetTitle } from '../layout/DialogSheet.js';
import { brandName } from '../layout/nav.js';
import { PHONE, useMediaQuery } from '../useMediaQuery.js';
import { About } from './settings/About.js';
import { Appearance } from './settings/Appearance.js';
import { BrandPane } from './settings/BrandPane.js';
import { Budget } from './settings/Budget.js';
import { Danger } from './settings/Danger.js';
import { EnginesPane } from './settings/EnginesPane.js';
import { Library, type LibraryInfo } from './settings/Library.js';
import { Usage } from './settings/Usage.js';
import { type SaveState, saveLabel } from './settings/useBrandDoc.js';

type Page = 'brand' | 'usage' | 'engines' | 'general' | 'about' | 'danger';

/**
 * Every pane id a caller has ever opened, and the page it lands on. Eight
 * panes became six pages: the caps sit under the providers they cap, and the
 * theme beside the library in General. The old ids still land, so no link,
 * remedy or deep URL has to know.
 */
const PAGE_OF: Record<Pane, Page> = {
  brand: 'brand',
  usage: 'usage',
  engines: 'engines',
  budget: 'engines',
  general: 'general',
  appearance: 'general',
  library: 'general',
  about: 'about',
  danger: 'danger',
};

const PAGES: {
  id: Page;
  label: string;
  Icon: Icon;
  scope: 'brand' | 'studio' | 'apart';
  sub: (brand: string) => string;
}[] = [
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
    sub: () => 'Where your images are made, and what each may spend. Pick one in the composer.',
  },
  {
    id: 'general',
    label: 'General',
    Icon: SlidersHorizontal,
    scope: 'studio',
    sub: () => 'How Scenri looks, and where your library lives.',
  },
  {
    id: 'about',
    label: 'About',
    Icon: Info,
    scope: 'studio',
    sub: () => 'This copy of Scenri and how it stays current.',
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

const pageOf = (value: string | null): Page => PAGE_OF[value as Pane] ?? 'brand';

/**
 * Settings is a detour, not a destination: it opens over the work and gives it
 * back when you close. Learn's shell and grammar: the name across the whole
 * width on a hairline, an index whose hairline runs from it to the floor, one
 * page at a time in a box that never changes height. On a phone it is the
 * studio's sheet, the index first and a page over it with Back.
 */
export function SettingsDialog({
  engines,
  brandId,
  onSaved,
}: {
  engines: EngineInfo[];
  brandId: string;
  onSaved: () => void;
}) {
  const settings = useDialogParam('settings');
  const open = settings.value !== null;
  // The one true version comes from the server (which read its own
  // package.json); a literal here would drift the moment release-please bumps.
  const [version, setVersion] = useState<VersionInfo | null>(null);
  useEffect(() => {
    if (!open || version) return;
    let alive = true;
    api
      .version()
      .then((v) => alive && setVersion(v))
      .catch(() => {
        /* offline from the API is not a settings problem */
      });
    return () => {
      alive = false;
    };
  }, [open, version]);
  // The library's folder and size, read as the dialog opens so General paints
  // whole on its first frame; read again on every opening, since it grows.
  const [home, setHome] = useState<LibraryInfo | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    api
      .home()
      .then((h) => alive && setHome(h))
      .catch(() => {
        /* the row says "…" until it can say more */
      });
    return () => {
      alive = false;
    };
  }, [open]);
  // Reported by the pane that owns the kit's document, shown in the page's head.
  const [kit, setKit] = useState<SaveState>('idle');

  return (
    <DialogSheet open={open} className="sc-set" maxWidth="880px" onDismiss={settings.close}>
      <Levels
        value={settings.value}
        onPick={settings.set}
        saved={<KitSaved state={kit} />}
        page={(p) => (
          <PageBody
            page={p}
            engines={engines}
            brandId={brandId}
            onSaved={onSaved}
            onKitState={setKit}
            version={version}
            home={home}
          />
        )}
      />
    </DialogSheet>
  );
}

/**
 * The index and the page, or on a phone one of them at a time. Mounted with
 * the dialog, so where a phone opens is decided once: on the index when it was
 * opened at the landing page, on the page when something sent it to one.
 */
function Levels({
  value,
  onPick,
  saved,
  page: render,
}: {
  value: string | null;
  onPick: (p: Page) => void;
  /** What the kit's writing is doing, for the Brand kit page's head. */
  saved: ReactNode;
  page: (p: Page) => ReactNode;
}) {
  const phone = useMediaQuery(PHONE);
  const { brand } = useBrand();
  const page = pageOf(value);
  const [listing, setListing] = useState(() => page === 'brand');
  const rows = useRef(new Map<Page, HTMLButtonElement>());

  // Back to the index puts the keyboard on the row that was open.
  const cameBack = useRef(false);
  useEffect(() => {
    if (!phone || !listing || !cameBack.current) return;
    cameBack.current = false;
    rows.current.get(page)?.focus({ preventScroll: true });
  }, [phone, listing, page]);

  const pick = (p: Page) => {
    onPick(p);
    setListing(false);
  };
  const def = PAGES.find((p) => p.id === page)!;

  if (phone && !listing) {
    return (
      <div className="sc-set-level" key={`page-${page}`}>
        <div className="sc-newdlg-head">
          <button
            type="button"
            className="sc-newdlg-back"
            onClick={() => {
              cameBack.current = true;
              setListing(true);
            }}
            aria-label="Settings"
          >
            <CaretLeft size={15} />
          </button>
          <SheetTitle className="sc-newdlg-title">{def.label}</SheetTitle>
          {page === 'brand' && saved}
          <CloseButton />
        </div>
        <div className="sc-newdlg-body sc-set-body">
          <div className="sc-set-scroll">{render(page)}</div>
        </div>
      </div>
    );
  }

  const row = (p: (typeof PAGES)[number]) => (
    <li key={p.id}>
      <button
        type="button"
        className="sc-set-item"
        data-danger={p.scope === 'apart' ? '' : undefined}
        aria-current={!phone && page === p.id ? 'page' : undefined}
        ref={(el) => {
          if (el) rows.current.set(p.id, el);
          else rows.current.delete(p.id);
        }}
        onClick={() => pick(p.id)}
      >
        <p.Icon size={16} className="sc-set-item-ic" />
        <span className="sc-set-item-lb">{p.label}</span>
        {phone && <CaretRight size={14} className="sc-set-item-go" />}
      </button>
    </li>
  );

  return (
    <div className="sc-set-level" key="index">
      <div className="sc-newdlg-head">
        <SheetTitle className="sc-newdlg-title">Settings</SheetTitle>
        <CloseButton />
      </div>
      <div className="sc-newdlg-body sc-set-body">
        <nav className="sc-set-rail" aria-label="Settings">
          <p className="sc-set-group">This brand</p>
          <ul>{PAGES.filter((p) => p.scope === 'brand').map(row)}</ul>
          <p className="sc-set-group">Studio</p>
          <ul>{PAGES.filter((p) => p.scope === 'studio').map(row)}</ul>
          <ul className="sc-set-apart">{PAGES.filter((p) => p.scope === 'apart').map(row)}</ul>
        </nav>
        {!phone && (
          <div className="sc-set-scroll" key={page}>
            <header className="sc-set-head">
              <span className="sc-set-head-say">
                <h2>{def.label}</h2>
                <p>{def.sub(brandName(brand))}</p>
              </span>
              {page === 'brand' && saved}
            </header>
            {render(page)}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The kit writes as it is edited, so the page says what the writing is doing
 * rather than offering a Save button: what went wrong for as long as it is
 * wrong, and "Saved" for a moment after a write lands.
 */
function KitSaved({ state }: { state: SaveState }) {
  const [shown, setShown] = useState(false);
  const was = useRef<SaveState>(state);
  useEffect(() => {
    const before = was.current;
    was.current = state;
    if (state !== 'idle') {
      setShown(true);
      return;
    }
    if (before === 'idle') return;
    const t = setTimeout(() => setShown(false), 1600);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <span className="sc-set-saved" data-on={shown ? '' : undefined} data-state={state} aria-live="polite">
      {state === 'idle' && <Check size={12} weight="bold" />}
      {saveLabel(state)}
    </span>
  );
}

function PageBody({
  page,
  engines,
  brandId,
  onSaved,
  onKitState,
  version,
  home,
}: {
  page: Page;
  engines: EngineInfo[];
  brandId: string;
  onSaved: () => void;
  onKitState: (s: SaveState) => void;
  version: VersionInfo | null;
  home: LibraryInfo | null;
}) {
  switch (page) {
    case 'brand':
      return <BrandPane onSaveState={onKitState} />;
    case 'usage':
      return <Usage brandId={brandId} />;
    case 'engines':
      return (
        <>
          <EnginesPane engines={engines} />
          <Budget engines={engines} onSaved={onSaved} />
        </>
      );
    case 'general':
      return (
        <>
          <Appearance />
          <Library info={home} />
        </>
      );
    case 'about':
      return <About version={version} />;
    case 'danger':
      return <Danger onDone={onSaved} />;
  }
}

function CloseButton() {
  return (
    <SheetClose>
      <button type="button" className="sc-set-close sc-newdlg-close" aria-label="Close">
        <X size={16} />
      </button>
    </SheetClose>
  );
}
