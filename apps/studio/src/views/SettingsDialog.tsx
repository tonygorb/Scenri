import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CaretLeft, CaretRight, Check, X } from '@phosphor-icons/react';
import { api, type DesktopStatus, type EngineInfo, type VersionInfo } from '../api.js';
import { useDialogParam } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { DialogSheet, SheetClose, SheetTitle } from '../layout/DialogSheet.js';
import { brandName } from '../layout/nav.js';
import { PHONE, useMediaQuery } from '../useMediaQuery.js';
import { About } from './settings/About.js';
import { Appearance } from './settings/Appearance.js';
import { BrandPane } from './settings/BrandPane.js';
import { Budget } from './settings/Budget.js';
import { Danger } from './settings/Danger.js';
import { DesktopShortcut } from './settings/DesktopShortcut.js';
import { EnginesPane } from './settings/EnginesPane.js';
import { Library, type LibraryInfo } from './settings/Library.js';
import { PhoneAccess } from './settings/PhoneAccess.js';
import { Updates } from './settings/Updates.js';
import { Usage } from './settings/Usage.js';
import { type SaveState, saveLabel } from './settings/useBrandDoc.js';
import { PAGES, type Page, pageOf, startsOnIndex } from './settingsPages.js';

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
  // Whether this computer has the desktop icon, read as the dialog opens so
  // Local access paints whole on its first frame instead of "Checking".
  const [desktop, setDesktop] = useState<DesktopStatus | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    api
      .desktop()
      .then((d) => alive && setDesktop(d))
      .catch(() => {
        /* the row says it is checking until it can say more */
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
            desktop={desktop}
            onDesktop={setDesktop}
          />
        )}
      />
    </DialogSheet>
  );
}

/**
 * The index and the page, or on a phone one of them at a time. Mounted with
 * the dialog, so where a phone opens is decided once: on the index when it was
 * opened without a page in mind, on the page when something sent it to one,
 * Brand kit included.
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
  const [listing, setListing] = useState(() => startsOnIndex(value));
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
          <div className="sc-set-scroll">
            {/* the sentence a desktop shows beside the title, so a phone knows what the page is for */}
            <p className="sc-set-lede">{def.sub(brandName(brand))}</p>
            {render(page)}
          </div>
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
          <p className="sc-set-group">Delete</p>
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
  desktop,
  onDesktop,
}: {
  page: Page;
  engines: EngineInfo[];
  brandId: string;
  onSaved: () => void;
  onKitState: (s: SaveState) => void;
  version: VersionInfo | null;
  home: LibraryInfo | null;
  desktop: DesktopStatus | null;
  onDesktop: (d: DesktopStatus) => void;
}) {
  // What acts on the computer running Scenri (its file manager, its desktop)
  // shows only there, never on a phone that opened Scenri over the Wi-Fi.
  const thisComputer = version?.thisComputer === true;
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
    case 'appearance':
      return <Appearance />;
    case 'library':
      return <Library info={home} thisComputer={thisComputer} />;
    case 'phone':
      return (
        <>
          <PhoneAccess />
          {thisComputer && <DesktopShortcut status={desktop} onStatus={onDesktop} />}
        </>
      );
    case 'updates':
      return <Updates version={version} />;
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
