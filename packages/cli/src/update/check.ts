/**
 * The update check: one GET for the registry's dist-tags, at most once a day,
 * cached in the settings table. This is the only request scenri ever makes on
 * its own behalf — keep it version-only, silent offline, and opt-out-able
 * (Settings toggle, or SCENRI_NO_UPDATE_CHECK=1).
 */

export type SemverKind = 'major' | 'minor' | 'patch' | null;

const CACHE_MS = 24 * 60 * 60 * 1000;
const FORCE_COOLDOWN_MS = 60 * 1000;
const TIMEOUT_MS = 5000;

/** "1.2.3" → [1,2,3]; anything else → null. No prerelease: 0.x already means early. */
function triplet(v: string): [number, number, number] | null {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** What kind of step latest is above current; null when it is no step up at all. */
export function classify(current: string, latest: string): SemverKind {
  const a = triplet(current);
  const b = triplet(latest);
  if (!a || !b) return null;
  if (b[0] > a[0]) return 'major';
  if (b[0] < a[0]) return null;
  if (b[1] > a[1]) return 'minor';
  if (b[1] < a[1]) return null;
  return b[2] > a[2] ? 'patch' : null;
}

export interface CheckResult {
  latest: string | null;
  checkedAt: number | null;
  error: string | null;
}

export interface UpdateChecker {
  enabled(): boolean;
  check(force?: boolean): Promise<CheckResult>;
  /** First check shortly after listen, then daily. Timers unref'd: never keeps the process alive. */
  schedule(): void;
}

interface SettingsLike {
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
}

export function createUpdateChecker(deps: {
  name: string;
  store: SettingsLike;
  fetchImpl?: typeof fetch;
  registry?: string;
  env?: Record<string, string | undefined>;
  now?: () => number;
  log?: (line: string) => void;
}): UpdateChecker {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? console.log;
  const doFetch = deps.fetchImpl ?? fetch;
  const registry = (deps.registry ?? env.SCENRI_REGISTRY ?? 'https://registry.npmjs.org').replace(/\/+$/, '');

  const cached = (): CheckResult => {
    const at = deps.store.getSetting('update.checkedAt');
    return {
      latest: deps.store.getSetting('update.latest') || null,
      checkedAt: at ? Number(at) : null,
      error: null,
    };
  };

  let inflight: Promise<CheckResult> | null = null;
  let lastForceAt = 0;

  const enabled = () => env.SCENRI_NO_UPDATE_CHECK !== '1' && deps.store.getSetting('update.enabled') !== 'false';

  async function fetchLatest(): Promise<CheckResult> {
    if (!deps.store.getSetting('update.disclosed')) {
      // Doctrine: this is the app's first self-initiated request ever — say so
      // once, with the off switch in the same breath.
      log('  checking npm for updates (version only; set SCENRI_NO_UPDATE_CHECK=1 to disable)');
      deps.store.setSetting('update.disclosed', '1');
    }
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      if (typeof timer === 'object') timer.unref?.();
      let res: Response;
      try {
        res = await doFetch(`${registry}/-/package/${deps.name}/dist-tags`, { signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
      if (res.status === 404) {
        // A fork published under no name gets a clean "no update", not an error.
        deps.store.setSetting('update.latest', '');
        deps.store.setSetting('update.checkedAt', String(now()));
        return cached();
      }
      if (!res.ok) return { ...cached(), error: `registry answered ${res.status}` };
      const tags = (await res.json()) as { latest?: string };
      deps.store.setSetting('update.latest', tags.latest ?? '');
      deps.store.setSetting('update.checkedAt', String(now()));
      return cached();
    } catch (err) {
      // Offline is a non-event: keep the previous answer, note why.
      return { ...cached(), error: String((err as Error)?.message ?? err) };
    }
  }

  async function check(force = false): Promise<CheckResult> {
    if (!enabled()) return cached();
    if (inflight) return inflight;
    const prior = cached();
    const fresh = prior.checkedAt !== null && now() - prior.checkedAt < CACHE_MS;
    if (force) {
      if (now() - lastForceAt < FORCE_COOLDOWN_MS) return prior;
      lastForceAt = now();
    } else if (fresh) {
      return prior;
    }
    inflight = fetchLatest().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  function schedule(): void {
    // Never in the way of startup, never keeping the process alive.
    setTimeout(() => void check(), 10_000).unref();
    setInterval(() => void check(), CACHE_MS).unref();
  }

  return { enabled, check, schedule };
}
