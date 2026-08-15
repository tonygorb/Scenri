import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Dialog } from '@radix-ui/themes';
import { Broom, Database, Info, Lightning, Palette, PiggyBank, Sun, TrashSimple, X } from '@phosphor-icons/react';
import { api, type EngineInfo, type ReleaseNotes, type TreeNode, type VersionInfo } from '../api.js';
import { useUpdateCenter } from '../app/UpdateCenter.js';
import { useDialogParam } from '../app/AppShell.js';
import type { Pane } from '../app/dialogs.js';
import { useBrand } from '../app/BrandLayout.js';
import { engineTitle } from '../engines/active.js';
import { brandName } from '../layout/nav.js';
import { Confirm } from '../Confirm.js';
import { useThemeMode, type ThemeChoice } from '../theme.js';
import { BrandPane } from './settings/BrandPane.js';
import { EnginesPane } from './settings/EnginesPane.js';

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

const bytes = (n: number) =>
  n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.round(n / 1e3)} KB`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function heatLevel(runs: number) {
  return runs === 0 ? 0 : runs < 3 ? 1 : runs < 6 ? 2 : runs < 12 ? 3 : 4;
}

/** One square per day, Sunday-aligned, sized to a number of week columns. */
function buildHeat(perDay: Map<string, number>, weeks: number) {
  const days = weeks * 7;
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - (days - 1) - end.getDay());
  const cells: { key: string; level: number; title: string }[] = [];
  const months: { key: string; label: string }[] = [];
  let lastMonth = -1;
  let sum = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    const runs = perDay.get(key) ?? 0;
    sum += runs;
    cells.push({
      key,
      level: heatLevel(runs),
      title: runs
        ? `${runs} run${runs === 1 ? '' : 's'} on ${d.getDate()} ${MONTHS[d.getMonth()]}`
        : `nothing on ${d.getDate()} ${MONTHS[d.getMonth()]}`,
    });
    if (d.getDay() === 0) {
      const opensMonth = d.getMonth() !== lastMonth && d.getDate() <= 7;
      if (opensMonth) lastMonth = d.getMonth();
      months.push({ key, label: opensMonth ? MONTHS[d.getMonth()] : '' });
    }
  }
  return { cells, months, sum };
}

/**
 * Settings is a detour, not a destination: it opens over the work and gives it
 * back when you close. Rail on the left (desktop), chip strip (phone), one pane
 * at a time.
 */
export function SettingsDialog({
  engines,
  shots,
  onSaved,
}: {
  engines: EngineInfo[];
  shots: TreeNode[];
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
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
        }}
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
            <p className="sc-set-ver">{version ? `v${version.version}` : 'scenri'} · local</p>
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
              {pane === 'usage' && <Usage shots={shots} />}
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

export function Group({ title, sub, children }: { title?: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="sc-set-sec">
      {(title || sub) && (
        <div className="sc-set-sech">
          {title && <h3>{title}</h3>}
          {sub && <p>{sub}</p>}
        </div>
      )}
      <div className="sc-set-card">{children}</div>
    </section>
  );
}

function HeatRange({
  weeks,
  months,
  cells,
}: {
  weeks: number;
  months: { key: string; label: string }[];
  cells: { key: string; level: number; title: string }[];
}) {
  return (
    <div className="sc-heat-range" data-weeks={weeks}>
      <div className="sc-heat-months">
        {months.map((m) => (
          <span key={m.key}>{m.label}</span>
        ))}
      </div>
      <div className="sc-heat-grid">
        {cells.map((c) => (
          <i key={c.key} data-l={c.level || undefined} title={c.title} />
        ))}
      </div>
    </div>
  );
}

function Budget({ engines, onSaved }: { engines: EngineInfo[]; onSaved: () => void }) {
  const paid = engines.filter((e) => !e.free);
  const [caps, setCaps] = useState<Record<string, string>>({});
  useEffect(() => {
    setCaps(Object.fromEntries(paid.map((e) => [e.id, e.cap === null ? '' : String(e.cap)])));
  }, [engines]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = async (id: string) => {
    const raw = (caps[id] ?? '').trim();
    const parsed = raw === '' ? null : Number(raw);
    if (parsed !== null && (Number.isNaN(parsed) || parsed < 0)) return;
    await api.setCap(id, parsed);
    onSaved();
  };

  if (!paid.length) {
    return (
      <Group sub="Nothing to cap yet. Caps apply to engines you pay for per image. Codex usage counts against your ChatGPT plan, which OpenAI meters, not scenri.">
        <p className="sc-set-empty">Add a paid engine key and its cap appears here.</p>
      </Group>
    );
  }

  return (
    <Group sub="Your own API budget. Generation stops before a cap is crossed, so a runaway loop cannot spend your month.">
      {paid.map((e) => {
        const left = e.generationsLeft;
        const total = e.generationsTotal;
        const pct = total && total > 0 ? Math.min(100, Math.round(((total - (left ?? 0)) / total) * 100)) : 0;
        const spend = `$${e.monthlySpend.toFixed(2)} this month`;
        return (
          <div className="sc-cap" key={e.id}>
            <div className="sc-cap-top">
              <span className="txt">
                <b>{engineTitle(e.displayName)}</b>
                <small>{left === null ? spend : `${spend} · ${left} left`}</small>
              </span>
              <div className="sc-cap-in">
                <span className="sc-cap-dollar">$</span>
                <input
                  className="sc-in"
                  inputMode="decimal"
                  placeholder="None"
                  value={caps[e.id] ?? ''}
                  onChange={(ev) => setCaps((c) => ({ ...c, [e.id]: ev.target.value }))}
                  onBlur={() => void commit(e.id)}
                  aria-label={`${engineTitle(e.displayName)} monthly cap in dollars`}
                />
              </div>
            </div>
            {total !== null && (
              <div className="sc-meter">
                <i style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>
        );
      })}
    </Group>
  );
}

/**
 * A year of real runs, one square per day.
 *
 * This used to fetch up to forty project trees to draw one grid, and silently
 * told the truth about only the first forty. The brand's shots are already in
 * hand upstairs, so it now counts what it was given.
 */
function Usage({ shots }: { shots: TreeNode[] }) {
  const nodes = useMemo(() => shots.filter((n) => n.kind !== 'root'), [shots]);

  const { year, quarter, total, byKind } = useMemo(() => {
    const perDay = new Map<string, number>();
    const kinds = { generation: 0, edit: 0 };
    for (const n of nodes ?? []) {
      const day = String(n.createdAt).slice(0, 10);
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
      if (n.kind === 'edit') kinds.edit++;
      else kinds.generation++;
    }
    const year = buildHeat(perDay, 53);
    const quarter = buildHeat(perDay, 13);
    return { year, quarter, total: year.sum, byKind: kinds };
  }, [nodes]);

  if (nodes === null) return <p className="sc-set-empty">Reading your library…</p>;

  const most = Math.max(byKind.generation, byKind.edit, 1);
  return (
    <>
      <Group title="The last year" sub="One square per day, counted from your own runs.">
        <div className="sc-heat">
          <div className="sc-heat-h">
            <b>{total.toLocaleString()} runs in the last year</b>
          </div>
          <HeatRange weeks={53} months={year.months} cells={year.cells} />
          <HeatRange weeks={13} months={quarter.months} cells={quarter.cells} />
        </div>
      </Group>
      <Group title="By activity">
        <div className="sc-bars">
          <div className="sc-bar">
            <span className="k">Generations</span>
            <span className="t">
              <i style={{ width: `${(byKind.generation / most) * 100}%` }} />
            </span>
            <span className="v">{byKind.generation}</span>
          </div>
          <div className="sc-bar">
            <span className="k">Edits</span>
            <span className="t">
              <i style={{ width: `${(byKind.edit / most) * 100}%` }} />
            </span>
            <span className="v">{byKind.edit}</span>
          </div>
        </div>
      </Group>
    </>
  );
}

function Library() {
  const [info, setInfo] = useState<{ dir: string; dbPath: string; images: number; bytes: number } | null>(null);
  useEffect(() => {
    void api
      .home()
      .then(setInfo)
      .catch(() => {});
  }, []);

  return (
    <Group sub="Plain files on this machine. Open them yourself, back them up like anything else.">
      <div className="sc-set-row">
        <span className="txt">
          <b>Library folder</b>
          <small>{info ? `${info.dir} · ${bytes(info.bytes)} across ${info.images} images` : '…'}</small>
        </span>
        <button type="button" className="sc-btn sc-btn-ghost" onClick={() => void api.reveal()}>
          Reveal
        </button>
      </div>
      <div className="sc-set-row">
        <span className="txt">
          <b>Export everything</b>
          <small>One zip: brands, cast, briefs, shots. Never keys.</small>
        </span>
        <a className="sc-btn sc-btn-ghost" href="/api/export/all" download>
          Export
        </a>
      </div>
      <div className="sc-set-row">
        <span className="txt">
          <b>Telemetry</b>
          <small>There is none. This row exists to say so.</small>
        </span>
        <span className="sc-tag">off, permanently</span>
      </div>
    </Group>
  );
}

function Appearance() {
  const { choice, setChoice } = useThemeMode();
  const opts: { id: ThemeChoice; label: string; swatch: string }[] = [
    { id: 'light', label: 'Light', swatch: 'linear-gradient(140deg,#ffffff 55%,#f1f1f1)' },
    { id: 'dark', label: 'Dark', swatch: 'linear-gradient(140deg,#0d0d0d 55%,#1c1c1c)' },
    { id: 'system', label: 'System', swatch: 'linear-gradient(110deg,#ffffff 50%,#0d0d0d 50%)' },
  ];
  return (
    <Group sub="Follows your system unless you pick a side.">
      <div className="sc-themes">
        {opts.map((o) => (
          <button
            type="button"
            key={o.id}
            className="sc-tp"
            data-on={choice === o.id ? '' : undefined}
            onClick={() => setChoice(o.id)}
          >
            <span className="swl" style={{ background: o.swatch }} />
            <span className="lbl">
              <span className="dot" />
              {o.label}
            </span>
          </button>
        ))}
      </div>
    </Group>
  );
}

const INSTALL_LABEL: Record<VersionInfo['installKind'], string> = {
  npx: 'run with npx',
  global: 'installed with npm',
  managed: 'managed install',
  dev: 'running from source',
  unknown: 'local studio',
};

/** The one manual command that updates this particular install. */
function updateCommand(kind: VersionInfo['installKind'] | undefined): string {
  switch (kind) {
    case 'npx':
      return 'npx scenri update';
    case 'global':
    case 'managed':
      return 'scenri update';
    default:
      return 'npx scenri@latest';
  }
}

/** Release notes on demand: fetched when opened, a plain link when GitHub won't answer. */
function WhatsNew({ notesUrl }: { notesUrl: string | null }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<ReleaseNotes | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open || notes || failed) return;
    void api
      .updateNotes()
      .then(setNotes)
      .catch(() => setFailed(true));
  }, [open, notes, failed]);

  return (
    <div className="sc-set-row">
      <span className="txt">
        <b>What's new</b>
        {open && notes && (
          <small data-prose="" style={{ whiteSpace: 'pre-wrap' }}>
            {notes.body.trim() || 'No notes on this one.'}
            {'\n'}
            <a href={notes.url} target="_blank" rel="noreferrer">
              View on GitHub
            </a>
          </small>
        )}
        {open && failed && (
          <small data-prose="">
            Couldn't fetch the notes.{' '}
            {notesUrl ? (
              <a href={notesUrl} target="_blank" rel="noreferrer">
                Read them on GitHub
              </a>
            ) : (
              'Try again later.'
            )}
          </small>
        )}
      </span>
      <button type="button" className="sc-btn sc-btn-ghost" onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

function About({ version }: { version: VersionInfo | null }) {
  const updates = useUpdateCenter();
  const s = updates.status;
  const [autoCheck, setAutoCheck] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    void api
      .settings()
      .then((all) => setAutoCheck(Boolean(all.updateCheck)))
      .catch(() => {});
  }, []);

  const toggleAutoCheck = async () => {
    if (autoCheck === null) return;
    const next = !autoCheck;
    setAutoCheck(next);
    try {
      await api.saveSettings({ updateCheck: next });
    } catch {
      setAutoCheck(!next);
    }
  };

  const command = updateCommand(version?.installKind);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked: the command is on screen to select */
    }
  };

  const verdict = updates.checking ? (
    <span className="sc-tag">checking…</span>
  ) : s?.available ? (
    <span className="sc-tag sc-tag-gold">{s.latest} available</span>
  ) : s?.error ? (
    <span className="sc-tag">couldn't reach npm</span>
  ) : s?.checkedAt ? (
    <span className="sc-tag">up to date</span>
  ) : null;

  return (
    <Group>
      <div className="sc-set-row">
        <span className="txt">
          <b>scenri</b>
          <small>
            {version ? `v${version.version}` : ''} · {INSTALL_LABEL[version?.installKind ?? 'unknown']}
          </small>
        </span>
      </div>
      <div className="sc-set-row">
        <span className="txt">
          <b>Updates</b>
          <small>{s?.available ? `You are on ${s.current}.` : 'New versions announce themselves here.'}</small>
        </span>
        {verdict}
        <button
          type="button"
          className="sc-btn sc-btn-ghost"
          disabled={updates.checking}
          onClick={() => void updates.checkNow()}
        >
          Check for updates
        </button>
      </div>
      {s?.available && <WhatsNew notesUrl={s.notesUrl} />}
      {s?.available &&
        (version?.installKind === 'dev' ? (
          <div className="sc-set-row">
            <span className="txt">
              <b>Update</b>
              <small data-prose="">
                Running from source — pull and rebuild when you're ready. Nothing here touches your checkout.
              </small>
            </span>
          </div>
        ) : (
          <div className="sc-set-row">
            <span className="txt">
              <b>Update</b>
              <small data-prose="">
                Run <code>{command}</code> in a terminal, then start scenri again. Your library is not part of the app
                and stays put.
              </small>
            </span>
            <button type="button" className="sc-btn sc-btn-ghost" onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy command'}
            </button>
          </div>
        ))}
      <div className="sc-set-row">
        <span className="txt">
          <b>Check for updates automatically</b>
          <small data-prose="">
            One version-number request to npm, at most daily. Off means scenri never calls anywhere by itself.
          </small>
        </span>
        <button
          type="button"
          className="sc-btn sc-btn-ghost"
          disabled={autoCheck === null}
          onClick={() => void toggleAutoCheck()}
        >
          {autoCheck === null ? '…' : autoCheck ? 'Turn off' : 'Turn on'}
        </button>
      </div>
      <div className="sc-set-row">
        <span className="txt">
          <b>License</b>
          <small>AGPL-3.0 for the app · Apache-2.0 for the .brand format</small>
        </span>
      </div>
    </Group>
  );
}

function Danger({ onDone }: { onDone: () => void }) {
  const { brand } = useBrand();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (scope: 'shots' | 'all') => {
      setBusy(true);
      try {
        await api.deleteData(scope);
        onDone();
        // wiping everything means starting at the wizard, not reloading back
        // into this dialog on a brand that no longer exists
        if (scope === 'all') window.location.replace('/');
      } finally {
        setBusy(false);
      }
    },
    [onDone],
  );

  return (
    <Group sub="These do not come back. Export from Library first if you are not certain.">
      {/* Deleting one brand belongs beside deleting all of them, not at the
          bottom of the pane where that brand is edited. */}
      <div className="sc-set-row">
        <span className="txt">
          <b>Delete this brand</b>
          <small>Removes {brandName(brand)}, its projects and every shot. Other brands stay.</small>
        </span>
        <Confirm
          label="Delete brand"
          title={`Delete ${brandName(brand)}?`}
          body="The kit, its projects and every shot go with it. Exports you already downloaded stay yours."
          busy={busy}
          onConfirm={() => {
            setBusy(true);
            void api
              .deleteBrand(brand.id)
              .then(onDone)
              // The row this dialog is rendered inside is gone; land somewhere
              // that still exists rather than re-resolving a dead slug.
              .then(() => navigate('/', { replace: true }))
              .finally(() => setBusy(false));
          }}
        />
      </div>
      <div className="sc-set-row">
        <span className="txt">
          <b>Delete generated shots</b>
          <small>Keeps brands, cast and scenes. Removes every project and its tree.</small>
        </span>
        <Confirm
          label="Delete shots"
          title="Delete every generated shot?"
          body="Brands, cast and scenes stay. Every project and everything generated inside it goes."
          busy={busy}
          onConfirm={() => void run('shots')}
        />
      </div>
      <div className="sc-set-row">
        <span className="txt">
          <b>Delete all local data</b>
          <small>Brands, cast, projects, shots and saved keys, in one go.</small>
        </span>
        <Confirm
          label="Delete everything"
          title="Delete everything on this machine?"
          body="The whole library folder is removed: brands, cast, projects, shots and your saved keys. There is no undo."
          busy={busy}
          onConfirm={() => void run('all')}
        />
      </div>
    </Group>
  );
}
