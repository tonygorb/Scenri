import { type ActivityNode, type CatalogImportJob, nodeLabel } from './api.js';

/**
 * The model behind the notifications bell.
 *
 * A task is work in flight, derived fresh from the server every poll and never
 * stored. A notification is the moment a task stopped, frozen and kept. They
 * share an id, so the record can always be traced back to the work, and there
 * is exactly one place a notification is ever born: `settled`.
 *
 * None of this imports React. The bell is the easy half of this feature; the
 * bookkeeping is the half that can be wrong in ways nobody notices for a week,
 * so it lives here where a test can reach it. (vitest only globs `.ts`.)
 */

export type TaskKind = 'generation' | 'edit' | 'catalog';
export type TaskState = 'running' | 'done' | 'error' | 'partial';

export interface Task {
  /** `node:<uuid>` or `catalog:<uuid>`. Stable across polls. */
  id: string;
  kind: TaskKind;
  state: TaskState;
  title: string;
  subtitle: string;
  /** Content hash for the row thumbnail, or null when there is nothing to show. */
  thumb: string | null;
  /** Real counters only. null means no honest percent exists — render the shimmer. */
  percent: number | null;
  startedAt: string;
  /** Absolute app path the row navigates to, or null if there is nowhere to go. */
  href: string | null;
}

export interface NotificationItem {
  id: string;
  kind: TaskKind;
  state: Exclude<TaskState, 'running'>;
  title: string;
  subtitle: string;
  thumb: string | null;
  at: string;
  href: string | null;
}

export const FEED_CAP = 50;

// ---- time ------------------------------------------------------------------

/** SQLite datetime('now') is UTC without a zone marker — anchor it before diffing. */
export function parseTime(s: string): number {
  return Date.parse(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
}

export function elapsedSec(createdAt: string, now = Date.now()): number {
  const t = parseTime(createdAt);
  return Number.isNaN(t) ? 0 : Math.max(0, Math.round((now - t) / 1000));
}

/** How long this has been going: "42s", "4m", "1h 2m". */
export function elapsedLabel(startedAt: string, now = Date.now()): string {
  const s = elapsedSec(startedAt, now);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** How long ago this happened: "just now", "4m ago", "Yesterday". */
export function agoLabel(at: string, now = Date.now()): string {
  const s = elapsedSec(at, now);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  const days = Math.floor(s / 86_400);
  return days === 1 ? 'Yesterday' : `${days}d ago`;
}

// ---- building tasks --------------------------------------------------------

/** Percent of a catalog import that is genuinely done. Real counters, real bar. */
export function catalogPercent(j: CatalogImportJob | null): number {
  if (!j) return 0;
  if (j.stage === 'discovering') return j.discovered ? 15 : 8;
  if (j.stage === 'fetching_products') {
    const d = Math.max(j.discovered, j.fetched, 1);
    return 15 + Math.min(45, Math.round((j.fetched / d) * 45));
  }
  if (j.stage === 'processing_assets') {
    const t = Math.max(j.imagesTotal, 1);
    return 60 + Math.min(35, Math.round((j.imagesDone / t) * 35));
  }
  if (j.stage === 'completed') return 100;
  if (j.stage === 'partial') return 95;
  return 5;
}

export function taskFromNode(n: ActivityNode, brandId: string): Task {
  const where = n.projectName || 'Project';
  // the elapsed count lives in the time column; saying it twice in one row was
  // the kind of thing that reads as detail and lands as noise
  const subtitle =
    n.status === 'running'
      ? `${where} · generating`
      : n.status === 'error'
        ? `${where} · ${n.error ?? 'failed'}`
        : `${where} · ${n.images.length} image${n.images.length === 1 ? '' : 's'}`;
  return {
    id: `node:${n.id}`,
    kind: n.kind === 'edit' ? 'edit' : 'generation',
    state: n.status,
    title: n.kind === 'edit' ? `Edit · ${nodeLabel(n)}` : nodeLabel(n),
    subtitle,
    thumb: n.images[0] ?? null,
    // a generation has no honest percent: the house shows shimmer and seconds
    percent: null,
    startedAt: n.createdAt,
    href: `/b/${brandId}/p/${n.projectId}/n/${n.id}`,
  };
}

export function taskFromCatalogJob(j: CatalogImportJob, brandId: string): Task {
  const state: TaskState =
    j.stage === 'completed' ? 'done' : j.stage === 'partial' ? 'partial' : j.stage === 'failed' ? 'error' : 'running';
  let host = j.url;
  try {
    host = new URL(j.url).hostname.replace(/^www\./, '');
  } catch {
    /* a job url we cannot parse is still a job */
  }
  const count = j.discovered ? `${j.upserted} of ${j.discovered} products` : `${j.upserted} products`;
  return {
    id: `catalog:${j.id}`,
    kind: 'catalog',
    state,
    title: host,
    subtitle: state === 'error' ? `Catalog import · ${j.message ?? 'failed'}` : `Catalog import · ${count}`,
    thumb: null,
    percent: catalogPercent(j),
    startedAt: j.createdAt,
    href: `/b/${brandId}/brand`,
  };
}

/** Running first, then newest finished. What the Tasks tab renders. */
export function orderTasks(tasks: Task[], recent = 12): Task[] {
  const running = tasks.filter((t) => t.state === 'running');
  const rest = tasks
    .filter((t) => t.state !== 'running')
    .sort((a, b) => parseTime(b.startedAt) - parseTime(a.startedAt))
    .slice(0, recent);
  running.sort((a, b) => parseTime(a.startedAt) - parseTime(b.startedAt));
  return [...running, ...rest];
}

// ---- becoming a notification -----------------------------------------------

/**
 * The only place a notification is ever born.
 *
 * `prev` of null means we have not looked yet: the first snapshot after a page
 * load is a baseline, not a backlog, or opening the app would announce every
 * generation you have ever run.
 *
 * After that, news is either a task we watched stop, or a task we have never
 * seen at all that is already finished — work can begin and end inside a single
 * polling interval, and a finish nobody happened to be watching is exactly the
 * one worth telling you about. An unseen id on a list we have already
 * baselined can only be new work: the activity window drops old rows off the
 * bottom, it never grows them back at the top.
 */
export function settled(prev: Map<string, Task> | null, next: Task[], now = new Date()): NotificationItem[] {
  if (!prev) return [];
  const out: NotificationItem[] = [];
  for (const t of next) {
    if (t.state === 'running') continue;
    const was = prev.get(t.id);
    if (was && was.state !== 'running') continue;
    out.push({
      id: t.id,
      kind: t.kind,
      state: t.state,
      title: t.title,
      subtitle: t.subtitle,
      thumb: t.thumb,
      at: now.toISOString(),
      href: t.href,
    });
  }
  return out;
}

/** Newest first, one entry per id, capped. */
export function mergeFeed(feed: NotificationItem[], arrivals: NotificationItem[], cap = FEED_CAP): NotificationItem[] {
  if (arrivals.length === 0) return feed;
  const seen = new Set(arrivals.map((a) => a.id));
  return [...arrivals, ...feed.filter((f) => !seen.has(f.id))]
    .sort((a, b) => parseTime(b.at) - parseTime(a.at))
    .slice(0, cap);
}

export function unreadCount(feed: NotificationItem[], seenAt: string | null): number {
  if (!seenAt) return feed.length;
  const cut = parseTime(seenAt);
  return feed.filter((n) => parseTime(n.at) > cut).length;
}

// ---- storage ---------------------------------------------------------------

const feedKey = (brandId: string) => `scenri:notifications-${brandId}`;
const seenKey = (brandId: string) => `scenri:notifications-seen-${brandId}`;

/** Private-mode browsers throw on localStorage; a missing record is not an error. */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* history is nice to have, not worth an exception */
  }
}

export function loadFeed(brandId: string): NotificationItem[] {
  const raw = read(feedKey(brandId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as NotificationItem[]) : [];
  } catch {
    return [];
  }
}
export const saveFeed = (brandId: string, feed: NotificationItem[]) =>
  write(feedKey(brandId), JSON.stringify(feed.slice(0, FEED_CAP)));
export const loadSeen = (brandId: string) => read(seenKey(brandId));
export const saveSeen = (brandId: string, at: string) => write(seenKey(brandId), at);
