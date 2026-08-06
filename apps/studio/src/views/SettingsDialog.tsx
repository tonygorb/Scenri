import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertDialog, Button, Dialog, Flex, Spinner } from '@radix-ui/themes';
import {
  Broom,
  Circle,
  Cube,
  Database,
  Globe,
  Info,
  Lightning,
  PiggyBank,
  Sun,
  Terminal,
  TrashSimple,
  X,
} from '@phosphor-icons/react';
import { api, type EngineInfo, type TreeNode } from '../api.js';
import { useDialogParam } from '../app/AppShell.js';
import { useThemeMode, type ThemeChoice } from '../theme.js';

export type Pane = 'engines' | 'budget' | 'usage' | 'library' | 'appearance' | 'about' | 'danger';

const PANES: { id: Pane; label: string; title: string; icon: React.ReactNode; danger?: boolean }[] = [
  { id: 'engines', label: 'Engines', title: 'Engines and keys', icon: <Lightning size={14} /> },
  { id: 'budget', label: 'Budget', title: 'Budget', icon: <PiggyBank size={14} /> },
  { id: 'usage', label: 'Usage', title: 'Usage', icon: <Database size={14} /> },
  { id: 'library', label: 'Library', title: 'Library', icon: <Broom size={14} /> },
  { id: 'appearance', label: 'Appearance', title: 'Appearance', icon: <Sun size={14} /> },
  { id: 'about', label: 'About', title: 'About', icon: <Info size={14} /> },
  { id: 'danger', label: 'Danger zone', title: 'Danger zone', icon: <TrashSimple size={14} />, danger: true },
];

const KEYS: { key: string; engineId: string; label: string; hint: string }[] = [
  { key: 'openrouter_api_key', engineId: 'openrouter', label: 'OpenRouter', hint: 'sk-or-...' },
  { key: 'replicate_api_token', engineId: 'replicate', label: 'Replicate', hint: 'r8_...' },
  { key: 'fal_key', engineId: 'fal', label: 'fal', hint: 'fal_...' },
];

/** One mark per engine, so the list reads as five things and not one repeated. */
const ENGINE_ICON: Record<string, React.ReactNode> = {
  'codex-cli': <Terminal size={15} />,
  openrouter: <Globe size={15} />,
  replicate: <Cube size={15} />,
  fal: <Lightning size={15} />,
  demo: <Circle size={15} />,
};

const bytes = (n: number) =>
  n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.round(n / 1e3)} KB`;

/**
 * Settings is a detour, not a destination: it opens over the work and gives it
 * back when you close. Rail on the left, one pane at a time.
 */
/**
 * Any surface can ask for Settings without a prop threaded through the tree,
 * and the ask is a URL, so it survives a refresh and answers to Back.
 */
export function useOpenSettings() {
  const { open } = useDialogParam('settings');
  return (pane: Pane = 'engines') => open(pane);
}

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
  const pane = (PANES.some((p) => p.id === settings.value) ? settings.value : 'engines') as Pane;
  const setPane = (next: Pane) => settings.set(next);

  // A key mid-type lived in <Engines>'s own state, which unmounts — and
  // silently drops it — every time the rail leaves the Engines pane, not just
  // when the whole dialog closes. SettingsDialog itself never unmounts across
  // opens/closes/pane switches (only its pane content does), so holding the
  // draft here instead survives all three. Kept in memory only, never
  // persisted: unlike the Composer's prose draft, a secret should not outlive
  // a page reload.
  const [engineDraft, setEngineDraft] = useState<Record<string, string>>({});

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && settings.close()}>
      <Dialog.Content className="sc-set" maxWidth="940px" aria-describedby={undefined}>
        <Dialog.Title style={{ display: 'none' }}>Settings</Dialog.Title>
        <div className="sc-set-grid">
          <nav className="sc-set-rail">
            <p className="sc-set-group">Generation</p>
            {PANES.slice(0, 3).map((p) => (
              <RailItem key={p.id} p={p} on={pane === p.id} pick={() => setPane(p.id)} />
            ))}
            <p className="sc-set-group">This machine</p>
            {PANES.slice(3).map((p) => (
              <RailItem key={p.id} p={p} on={pane === p.id} pick={() => setPane(p.id)} />
            ))}
            <span className="sc-set-spacer" />
            <p className="sc-set-ver">v0.1.0 · local</p>
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
            <div className="sc-set-scroll">
              {pane === 'engines' && (
                <Engines engines={engines} onSaved={onSaved} draft={engineDraft} setDraft={setEngineDraft} />
              )}
              {pane === 'budget' && <Budget engines={engines} onSaved={onSaved} />}
              {pane === 'usage' && <Usage shots={shots} />}
              {pane === 'library' && <Library />}
              {pane === 'appearance' && <Appearance />}
              {pane === 'about' && <About />}
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
      onClick={pick}
    >
      {p.icon}
      {p.label}
    </button>
  );
}

function Group({ title, sub, children }: { title?: string; sub?: string; children: React.ReactNode }) {
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

function Engines({
  engines,
  onSaved,
  draft,
  setDraft,
}: {
  engines: EngineInfo[];
  onSaved: () => void;
  draft: Record<string, string>;
  setDraft: (update: (d: Record<string, string>) => Record<string, string>) => void;
}) {
  const [present, setPresent] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .settings()
      .then(setPresent)
      .catch(() => {});
  }, []);

  const save = async (key: string) => {
    const v = (draft[key] ?? '').trim();
    if (!v) return;
    setBusy(true);
    try {
      await api.saveSettings({ [key]: v });
      setDraft((d) => ({ ...d, [key]: '' }));
      setPresent(await api.settings());
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Group sub="Keys are stored in your local library folder, sent only to that provider, and never shown again.">
      {engines.map((e) => {
        const spec = KEYS.find((k) => k.engineId === e.id);
        return (
          <div className="sc-eng" key={e.id}>
            <div className="sc-eng-top">
              <span className="sc-eng-ic">{ENGINE_ICON[e.id] ?? <Lightning size={15} />}</span>
              <span className="sc-eng-name">
                <b>{e.displayName}</b>
                <small>{e.free ? 'Free per image' : `about $${e.perGeneration.toFixed(3)} a generation`}</small>
              </span>
              {e.localOnly && <span className="sc-tag sc-tag-gold">local only</span>}
              <span className={`sc-stat ${e.available ? 'on' : 'off'}`}>
                <span className="d" />
                {e.available
                  ? 'ready'
                  : spec
                    ? present[spec.key]
                      ? 'key rejected'
                      : 'no key'
                    : (e.reason ?? 'unavailable')}
              </span>
            </div>
            {spec && (
              <form
                className="sc-eng-key"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  void save(spec.key);
                }}
              >
                <input
                  className="sc-in"
                  type="password"
                  placeholder={present[spec.key] ? 'key saved' : spec.hint}
                  value={draft[spec.key] ?? ''}
                  onChange={(ev) => setDraft((d) => ({ ...d, [spec.key]: ev.target.value }))}
                  autoComplete="off"
                  name={spec.key}
                  aria-label={`${e.displayName} key`}
                />
                <button
                  className="sc-btn sc-btn-ghost"
                  type="submit"
                  disabled={busy || !(draft[spec.key] ?? '').trim()}
                >
                  {busy ? <Spinner size="1" /> : present[spec.key] ? 'Replace' : 'Save'}
                </button>
              </form>
            )}
            {!spec && <p className="sc-eng-hint">No key needed.</p>}
          </div>
        );
      })}
    </Group>
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
      <Group sub="Nothing here to cap: every engine you have connected is free.">
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
        return (
          <div className="sc-cap" key={e.id}>
            <div className="sc-cap-top">
              <b>{e.displayName}</b>
              <span className="sc-set-sp" />
              <span className="sc-cap-amount">
                {total === null ? 'No cap' : `${total} generations`}
                <small>{e.cap === null ? 'set one below' : `$${e.cap.toFixed(2)} / month`}</small>
              </span>
            </div>
            <Flex align="center" gap="2">
              <span className="sc-cap-dollar">$</span>
              <input
                className="sc-in"
                inputMode="decimal"
                placeholder="no cap"
                value={caps[e.id] ?? ''}
                onChange={(ev) => setCaps((c) => ({ ...c, [e.id]: ev.target.value }))}
                onBlur={() => void commit(e.id)}
                aria-label={`${e.displayName} monthly cap`}
              />
            </Flex>
            {total !== null && (
              <div className="sc-meter">
                <i style={{ width: `${pct}%` }} />
              </div>
            )}
            <div className="sc-cap-foot">
              <span>${e.monthlySpend.toFixed(2)} spent this month</span>
              <span>{left === null ? 'uncapped' : `${left} left`}</span>
            </div>
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

  const { cells, months, total, byKind } = useMemo(() => {
    const perDay = new Map<string, number>();
    const kinds = { generation: 0, edit: 0 };
    for (const n of nodes ?? []) {
      const day = String(n.createdAt).slice(0, 10);
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
      if (n.kind === 'edit') kinds.edit++;
      else kinds.generation++;
    }
    const WEEKS = 53,
      DAYS = WEEKS * 7;
    const end = new Date();
    const start = new Date(end);
    start.setDate(end.getDate() - (DAYS - 1) - end.getDay());
    const NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const out: { key: string; level: number; title: string }[] = [];
    // one entry per week column, keyed by the date the column starts on
    const labels: { key: string; label: string }[] = [];
    let lastMonth = -1,
      sum = 0;
    for (let i = 0; i < DAYS; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      const runs = perDay.get(key) ?? 0;
      sum += runs;
      out.push({
        key,
        level: runs === 0 ? 0 : runs < 3 ? 1 : runs < 6 ? 2 : runs < 12 ? 3 : 4,
        title: runs
          ? `${runs} run${runs === 1 ? '' : 's'} on ${d.getDate()} ${NAMES[d.getMonth()]}`
          : `nothing on ${d.getDate()} ${NAMES[d.getMonth()]}`,
      });
      if (d.getDay() === 0) {
        // label a column only on the first week a new month appears in
        const opensMonth = d.getMonth() !== lastMonth && d.getDate() <= 7;
        if (opensMonth) lastMonth = d.getMonth();
        labels.push({ key, label: opensMonth ? NAMES[d.getMonth()] : '' });
      }
    }
    return { cells: out, months: labels, total: sum, byKind: kinds };
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

function About() {
  return (
    <Group>
      <div className="sc-set-row">
        <span className="txt">
          <b>scenri</b>
          <small>v0.1.0 · local studio</small>
        </span>
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
      <div className="sc-set-row">
        <span className="txt">
          <b>Delete generated shots</b>
          <small>Keeps brands, cast and looks. Removes every project and its tree.</small>
        </span>
        <Confirm
          label="Delete shots"
          title="Delete every generated shot?"
          body="Brands, cast and looks stay. Every project and everything generated inside it goes."
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

function Confirm({
  label,
  title,
  body,
  busy,
  onConfirm,
}: {
  label: string;
  title: string;
  body: string;
  busy: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger>
        <button type="button" className="sc-btn sc-btn-ghost sc-btn-red" disabled={busy}>
          {label}
        </button>
      </AlertDialog.Trigger>
      <AlertDialog.Content maxWidth="420px">
        <AlertDialog.Title>{title}</AlertDialog.Title>
        <AlertDialog.Description size="2">{body}</AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">
              Cancel
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button color="red" onClick={onConfirm}>
              {label}
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
