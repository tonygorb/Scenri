import { useEffect, useRef, useState } from 'react';
import { Dialog } from '@radix-ui/themes';
import { Broom, Database, Info, Lightning, Palette, PiggyBank, Sun, TrashSimple, X } from '@phosphor-icons/react';
import { api, type EngineInfo, type VersionInfo } from '../api.js';
import { useDialogParam } from '../app/AppShell.js';
import { focusSelfOnOpen, type Pane } from '../app/dialogs.js';
import { BrandPane } from './settings/BrandPane.js';
import { EnginesPane } from './settings/EnginesPane.js';
import { About } from './settings/About.js';
import { Appearance } from './settings/Appearance.js';
import { Budget } from './settings/Budget.js';
import { Danger } from './settings/Danger.js';
import { Library } from './settings/Library.js';
import { Usage } from './settings/Usage.js';

const PANES: { id: Pane; label: string; title: string; icon: React.ReactNode; danger?: boolean }[] = [
  // First, and in its own group: the only pane scoped to a brand rather than to
  // this machine, and the one whose contents reach a model.
  { id: 'brand', label: 'Brand kit', title: 'Brand kit', icon: <Palette size={14} /> },
  { id: 'engines', label: 'Providers', title: 'Providers', icon: <Lightning size={14} /> },
  { id: 'budget', label: 'Budget', title: 'Budget', icon: <PiggyBank size={14} /> },
  { id: 'usage', label: 'Usage', title: 'Usage', icon: <Database size={14} /> },
  { id: 'library', label: 'Library', title: 'Library', icon: <Broom size={14} /> },
  { id: 'appearance', label: 'Appearance', title: 'Appearance', icon: <Sun size={14} /> },
  { id: 'about', label: 'About', title: 'About', icon: <Info size={14} /> },
  { id: 'danger', label: 'Danger zone', title: 'Danger zone', icon: <TrashSimple size={14} />, danger: true },
];

/**
 * Settings is a detour, not a destination: it opens over the work and gives it
 * back when you close. Rail on the left (desktop), chip strip (phone), one pane
 * at a time.
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
  // Brand kit is the landing pane, because the menu that opens Settings no
  // longer carries a separate row for it: this is the way in.
  const pane = (PANES.some((p) => p.id === settings.value) ? settings.value : 'brand') as Pane;
  const setPane = (next: Pane) => settings.set(next);

  const tabsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = tabsRef.current;
    if (!root) return;
    const el = root.querySelector('[aria-current="page"]');
    if (!(el instanceof HTMLElement)) return;
    const id = requestAnimationFrame(() => {
      const left = el.offsetLeft - (root.clientWidth - el.offsetWidth) / 2;
      root.scrollTo({ left: Math.max(0, left) });
    });
    return () => cancelAnimationFrame(id);
  }, [pane, open]);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && settings.close()}>
      <Dialog.Content
        className="sc-set"
        maxWidth="940px"
        aria-describedby={undefined}
        onOpenAutoFocus={focusSelfOnOpen}
      >
        <Dialog.Title style={{ display: 'none' }}>Settings</Dialog.Title>
        <div className="sc-set-grid">
          <nav className="sc-set-rail" aria-label="Settings">
            <p className="sc-set-group">This brand</p>
            <RailItem p={PANES[0]} on={pane === 'brand'} pick={() => setPane('brand')} />
            <p className="sc-set-group">Generation</p>
            {PANES.slice(1, 4).map((p) => (
              <RailItem key={p.id} p={p} on={pane === p.id} pick={() => setPane(p.id)} />
            ))}
            <p className="sc-set-group">This machine</p>
            {PANES.slice(4).map((p) => (
              <RailItem key={p.id} p={p} on={pane === p.id} pick={() => setPane(p.id)} />
            ))}
            <span className="sc-set-spacer" />
            <p className="sc-set-ver">{version ? `v${version.version}` : 'Scenri'} · local</p>
          </nav>

          <div className="sc-set-body">
            <div className="sc-set-head">
              <b>{PANES.find((p) => p.id === pane)!.title}</b>
              <span className="sc-set-sp" />
              <Dialog.Close>
                <button type="button" className="sc-set-close" aria-label="Close">
                  <X size={16} />
                </button>
              </Dialog.Close>
            </div>
            <nav className="sc-set-tabs" aria-label="Settings" ref={tabsRef}>
              {PANES.map((p) => (
                <TabItem key={p.id} p={p} on={pane === p.id} pick={() => setPane(p.id)} />
              ))}
            </nav>
            <div className="sc-set-scroll">
              {pane === 'brand' && <BrandPane />}
              {pane === 'engines' && <EnginesPane engines={engines} />}
              {pane === 'budget' && <Budget engines={engines} onSaved={onSaved} />}
              {pane === 'usage' && <Usage brandId={brandId} />}
              {pane === 'library' && <Library />}
              {pane === 'appearance' && <Appearance />}
              {pane === 'about' && <About version={version} />}
              {pane === 'danger' && <Danger onDone={onSaved} />}
            </div>
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function RailItem({ p, on, pick }: { p: (typeof PANES)[number]; on: boolean; pick: () => void }) {
  return (
    <button
      type="button"
      className="sc-set-item"
      data-on={on ? '' : undefined}
      data-danger={p.danger ? '' : undefined}
      aria-current={on ? 'page' : undefined}
      onClick={pick}
    >
      {p.icon}
      {p.label}
    </button>
  );
}

function TabItem({ p, on, pick }: { p: (typeof PANES)[number]; on: boolean; pick: () => void }) {
  return (
    <button
      type="button"
      className="sc-chip"
      data-active={on ? 'true' : undefined}
      data-danger={p.danger ? '' : undefined}
      aria-current={on ? 'page' : undefined}
      onClick={pick}
    >
      {p.label}
    </button>
  );
}
