/**
 * The update check: one GET for the registry's dist-tags, at most once a day,
 * cached in the settings table. One of exactly two requests Scenri ever makes
 * on its own behalf (the other is the one-time library download in
 * content/fetch.ts) — keep it version-only, silent offline, and opt-out-able
 * (Settings toggle, or SCENRI_NO_UPDATE_CHECK=1). The switches silence the
 * automatic cadence only: a forced check is a person clicking a button, and a
 * button that answers with silence reads as broken, so force still asks.
 */

export type SemverKind = 'major' | 'minor' | 'patch' | null;

const CACHE_MS = 24 * 60 * 60 * 1000;
const FORCE_COOLDOWN_MS = 60 * 1000;
const TIMEOUT_MS = 5000;

export function resolveRegistry(env: Record<string, string | undefined> = process.env, override?: string): string {
  return (override ?? env.SCENRI_REGISTRY ?? 'https://registry.npmjs.org').replace(/\/+$/, '');
}

/** One small GET for the dist-tags document. 404 = never published (forks): latest null, no error. */
export async function fetchDistTagLatest(
  name: string,
  opts: { registry?: string; fetchImpl?: typeof fetch; env?: Record<string, string | undefined> } = {},
): Promise<{ latest: string | null; error: string | null }> {
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    if (typeof timer === 'object') timer.unref?.();
    let res: Response;
    try {
      res = await doFetch(`${resolveRegistry(opts.env, opts.registry)}/-/package/${name}/dist-tags`, {
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 404) return { latest: null, error: null };
    if (!res.ok) return { latest: null, error: `registry answered ${res.status}` };
    const tags = (await res.json()) as { latest?: string };
    return { latest: tags.latest ?? null, error: null };
  } catch (err) {
    return { latest: null, error: String((err as Error)?.message ?? err) };
  }
}

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
  /**
   * One subscriber, told after every real registry answer — the daily cadence
   * or a forced check, never a cache hit and never a failure. This is the seam
   * auto-staging hangs off, without the checker ever learning staging exists.
   */
  onResult(fn: (r: CheckResult) => void): void;
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
  const registry = resolveRegistry(env, deps.registry);

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
  let onResultFn: ((r: CheckResult) => void) | null = null;

  const enabled = () => env.SCENRI_NO_UPDATE_CHECK !== '1' && deps.store.getSetting('update.enabled') !== 'false';

  async function fetchLatest(): Promise<CheckResult> {
    if (!deps.store.getSetting('update.disclosed')) {
      // Doctrine: this is the app's first self-initiated request ever — say so
      // once, with the off switch in the same breath.
      log('  checking npm for updates (version only; set SCENRI_NO_UPDATE_CHECK=1 to disable)');
      deps.store.setSetting('update.disclosed', '1');
    }
    const res = await fetchDistTagLatest(deps.name, { registry, fetchImpl: deps.fetchImpl });
    // Offline is a non-event: keep the previous answer, note why.
    if (res.error) return { ...cached(), error: res.error };
    // A 404 (a fork published under no name) is a clean "no update", cached.
    deps.store.setSetting('update.latest', res.latest ?? '');
    deps.store.setSetting('update.checkedAt', String(now()));
    const result = cached();
    onResultFn?.(result);
    return result;
  }

  async function check(force = false): Promise<CheckResult> {
    if (!enabled() && !force) return cached();
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

  return {
    enabled,
    check,
    schedule,
    onResult: (fn) => {
      onResultFn = fn;
    },
  };
}
