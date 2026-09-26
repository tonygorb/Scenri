import { type ActivityNode, type AssetBuild, type CatalogImportJob, nodeLabel, type StudioWork } from './api.js';
import { VIEW_NAME, type StudioView } from './create/presenter/presenterStudioRules.js';
import {
  presenterEditPath,
  presenterPath,
  presenterStudioPath,
  productsPath,
  sceneEditPath,
  scenePath,
  sceneStudioPath,
  shotPath,
} from './routes.js';
import { local, session } from './storage.js';
import { examplesSubtitle } from './sceneExampleRules.js';
import { describeFailure } from './failure.js';

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

export type TaskKind = 'generation' | 'edit' | 'catalog' | 'presenter' | 'scene';
export type TaskState = 'running' | 'done' | 'error' | 'cancelled' | 'partial';

export interface Task {
  /** `node:<uuid>`, `catalog:<uuid>` or `build:<id>`. Stable across polls. */
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
  /**
   * Already accounted for when it arrived, because it landed on a screen that
   * was showing it. The record keeps it; the unread badge does not count it.
   * A normal session used to end with a permanent "9+" on the bell for work
   * the person had watched appear in front of them.
   */
  watched?: boolean;
}

export const FEED_CAP = 50;

// ---- time ------------------------------------------------------------------

/** SQLite datetime('now') is UTC without a zone marker — anchor it before diffing. */
export function parseTime(s: string): number {
  return Date.parse(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
}

/** The clock on a running shot. createdAt is the card's place in the feed; a retry restamps startedAt so the wait does not inherit the first attempt. */
export function runSince(n: { startedAt?: string | null; createdAt: string }): string {
  return n.startedAt || n.createdAt;
}

export function elapsedSec(createdAt: string, now = Date.now()): number {
  const t = parseTime(createdAt);
  return Number.isNaN(t) ? 0 : Math.max(0, Math.round((now - t) / 1000));
}

/**
 * Never a fabricated percent — this is the honest substitute: what to call a
 * run that is still going changes with how long it has actually taken, the
 * number next to it never lies. Shared so the feed tile and the stage say the
 * same thing at the same moment instead of drifting apart.
 */
export function runningPhrase(createdAt: string, now = Date.now()): string {
  const s = elapsedSec(createdAt, now);
  if (s < 20) return 'generating';
  if (s < 60) return 'still generating';
  return 'taking longer than usual';
}

/**
 * How long this has been going, as a clock: "0:42", "4:17", "1:02:00".
 *
 * It used to round to a unit ("42s", then "4m"), so past the first minute the
 * pill sat still for sixty seconds at a time and a two-minute render read the
 * same at 2:01 and 2:59. Hours appear only once reached.
 */
export function elapsedLabel(startedAt: string, now = Date.now()): string {
  const s = elapsedSec(startedAt, now);
  const two = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
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
  if (j.stage === 'no_catalog') return 100;
  if (j.stage === 'partial') return 95;
  return 5;
}

/**
 * The brand, rather than a path prefix built from it: these hrefs are written
 * into localStorage and read back after an upgrade, so the one thing they must
 * not do is spell a route by hand.
 */
// A shot in no set is the ordinary case now, so the row says what happened
// and stops. Naming the container was worth a column back when every shot had
// one; saying "Workspace" on all of them would be furniture, not information.
const whereOf = (n: ActivityNode) => (n.setNames.length > 0 ? `${n.setNames.join(', ')} · ` : '');

/**
 * A shot's error as the bell says it. The restart sweep writes a log line
 * ("interrupted: server restarted mid-generation") that used to reach the
 * toast word for word; it is the one error with plain words of its own.
 */
function nodeError(error: string | null): string {
  const said = describeFailure(error);
  return said.kind === 'restarted' ? said.title : (error ?? 'failed');
}

export function taskFromNode(n: ActivityNode, brand: { slug: string }, now = Date.now(), batchSize = 1): Task {
  const where = whereOf(n);
  // One row per request: a batch says how many shots it is making, a single
  // shot says nothing about counts at all — one is the ordinary case.
  const made = batchSize > 1 ? `${batchSize} shots` : 'ready';
  const subtitle =
    n.status === 'running'
      ? `${where}${runningPhrase(runSince(n), now)}`
      : n.status === 'error'
        ? `${where}${nodeError(n.error)}`
        : n.status === 'cancelled'
          ? `${where}cancelled`
          : `${where}${made}`;
  return {
    id: `node:${n.id}`,
    kind: n.kind === 'edit' ? 'edit' : 'generation',
    state: n.status,
    title: n.kind === 'edit' ? `Edit · ${nodeLabel(n)}` : nodeLabel(n),
    subtitle,
    thumb: n.images[0] ?? null,
    // a generation has no honest percent: the house shows shimmer and seconds
    percent: null,
    startedAt: n.status === 'running' ? runSince(n) : n.createdAt,
    // the overlay hangs off the hub now, not off a project nobody named
    href: shotPath(brand, null, n.id),
  };
}

/**
 * A multi-shot request as one row that reads the whole batch, not slot 0.
 *
 * The row used to be `taskFromNode(slot 0)`, which was right for as long as
 * every sibling finished in the same instant. A sibling now lands on its own,
 * and reading the first one's status for all of them would slow the poll to
 * idle and announce a finish with three shots still rendering. So: running
 * while any sibling runs; done once anything landed, saying how many did when
 * some did not; an error only when nothing landed and something failed;
 * cancelled when nothing landed and nothing failed. It wears the first picture
 * that exists, whichever slot drew it. Same id and href as before, so the
 * persisted notification rows keep matching.
 */
export function batchTask(siblings: ActivityNode[], brand: { slug: string }, now = Date.now()): Task {
  const bySlot = [...siblings].sort((a, b) => (a.batchIndex ?? 0) - (b.batchIndex ?? 0));
  const first = bySlot[0];
  if (bySlot.length === 1) return taskFromNode(first, brand, now);
  const landed = bySlot.filter((n) => n.status === 'done' && n.images.length > 0);
  const status: ActivityNode['status'] = bySlot.some((n) => n.status === 'running')
    ? 'running'
    : landed.length
      ? 'done'
      : bySlot.some((n) => n.status === 'error')
        ? 'error'
        : 'cancelled';
  const task = taskFromNode(
    {
      ...first,
      status,
      images: landed[0]?.images ?? [],
      error: status === 'error' ? (bySlot.find((n) => n.status === 'error')?.error ?? null) : first.error,
    },
    brand,
    now,
    bySlot.length,
  );
  return status === 'done' && landed.length < bySlot.length
    ? { ...task, subtitle: `${whereOf(first)}${landed.length} of ${bySlot.length} shots` }
    : task;
}

/**
 * A website with no shop on it is not a failed import.
 *
 * It used to be: every /setup URL is offered to the catalog importer, a
 * marketing site discovers nothing, and the job was written as `failed`, so a
 * tester who had just been told their kit was built also got a red bell
 * reading "No public product catalog found". The brand half had worked
 * perfectly. Old rows are read the same way, so the ones already on disk stop
 * reading as failures too.
 */
function isShoplessSite(j: Pick<CatalogImportJob, 'stage' | 'errors'>): boolean {
  return j.stage === 'no_catalog' || (j.stage === 'failed' && j.errors?.[0]?.code === 'empty_catalog');
}

/**
 * The one-time library download, while it runs: one row, machine-wide, with
 * no percent (the archive is read in one piece, so there is no honest one)
 * and nothing to stop. It is never filed as a notification: it only ever
 * exists as running, and `settled` reads rows that are still there.
 */
export const CONTENT_TASK_ID = 'content:library';
export function taskFromContent(since: string): Task {
  return {
    id: CONTENT_TASK_ID,
    kind: 'catalog',
    state: 'running',
    title: 'Downloading the Scenri library',
    subtitle: 'Pictures for the examples, products and presenters, once',
    thumb: null,
    percent: null,
    startedAt: since,
    href: null,
  };
}

export function taskFromCatalogJob(j: CatalogImportJob, brand: { slug: string }): Task {
  const shopless = isShoplessSite(j);
  const state: TaskState = shopless
    ? 'done'
    : j.stage === 'completed'
      ? 'done'
      : j.stage === 'partial'
        ? 'partial'
        : j.stage === 'cancelled'
          ? 'cancelled'
          : j.stage === 'failed'
            ? 'error'
            : 'running';
  let host = j.url;
  try {
    host = new URL(j.url).hostname.replace(/^www\./, '');
  } catch {
    /* a job url we cannot parse is still a job */
  }
  // What the job is doing right now, not only what it has saved. Reading
  // 2,199 pages takes about sixteen minutes and writes nothing until a batch
  // lands, so counting `upserted` alone left the row reading "0 of 2,199" for
  // the whole of it.
  /**
   * One unit, for the whole run: products.
   *
   * This counted four different things as the stages changed - products found,
   * then pages read, then pictures downloaded, then products saved - so a
   * person watching one row saw "294 found", then "read 294 of 294", then
   * "199 of 249 pictures", then "294 of 294 products". The number appeared to
   * go backwards twice and the noun changed under it, and in a panel this
   * narrow the whole thing was cut off mid-count anyway.
   *
   * The one exception is the picture phase, and it earns it by being the only
   * number still moving. Every product is saved by then, so "1,185 products,
   * adding pictures" is a sentence that never changes again for the eight
   * minutes it takes - a row that reads as stuck while the work is going fine.
   * `imagesTotal` is what the run still owes rather than what it has looked at,
   * so the fraction beside it is honest, and the noun changing once, at the
   * moment the products stop and the pictures start, is what is actually
   * happening.
   */
  const count =
    j.stage === 'discovering'
      ? j.discovered
        ? `Found ${j.discovered.toLocaleString()} products`
        : 'Looking for products'
      : j.stage === 'processing_assets' && j.imagesTotal
        ? `${j.imagesDone.toLocaleString()} of ${j.imagesTotal.toLocaleString()} pictures`
        : // Reading a long catalogue writes nothing for a while, and "0 of
          // 2,199 products" for sixteen minutes is a row that looks stuck. The
          // number is what has been read rather than saved, which is still
          // products and still only ever goes up.
          j.stage === 'fetching_products' && j.fetched > j.upserted && j.discovered
          ? `Reading ${j.fetched.toLocaleString()} of ${j.discovered.toLocaleString()} products`
          : j.discovered
            ? `${j.upserted.toLocaleString()} of ${j.discovered.toLocaleString()} products`
            : `${j.upserted.toLocaleString()} products`;
  return {
    id: `catalog:${j.id}`,
    kind: 'catalog',
    state,
    title: host,
    subtitle: shopless
      ? 'No shop on this site'
      : // A run that ended short says why, not just how far it got. "44 of 60
        // products" is true and useless; the store having asked us to slow down
        // is the part that tells someone to try again in a minute.
        state === 'error' || state === 'cancelled' || state === 'partial'
        ? (j.message ?? 'Import failed')
        : count,
    thumb: null,
    percent: shopless ? 100 : catalogPercent(j),
    startedAt: j.createdAt,
    // A shop-less site has nothing to show in the kit; the products page is
    // where someone would add one by hand. Everything else goes to the
    // products it is importing - this used to point at `kitPath`, which
    // redirects to the brand kit settings pane, a screen with nothing to do
    // with the import on it.
    href: productsPath(brand),
  };
}

/**
 * A presenter or scene being built, as a row in the same list as everything else.
 *
 * This is what makes the top bar's + honest: a build started from Home used to
 * be visible only on the library page that started it, so navigating away hid a
 * twenty-minute job with no trace. Its progress is real — a presenter is four
 * numbered studio frames — so unlike a generation it gets an actual bar.
 */
export function taskFromAssetBuild(b: AssetBuild, brand: { slug: string }): Task {
  const state: TaskState =
    b.stage === 'done' ? 'done' : b.stage === 'failed' ? 'error' : b.stage === 'cancelled' ? 'cancelled' : 'running';
  const subtitle =
    state === 'error'
      ? (b.error ?? 'failed')
      : state === 'cancelled'
        ? 'stopped'
        : state === 'done'
          ? (b.warnings[0] ?? b.coverage[0] ?? (b.kind === 'presenter' ? 'Ready to cast' : 'Ready to use'))
          : (b.message ?? (b.kind === 'presenter' ? 'Building the studio views' : 'Reading the references'));
  return {
    id: `build:${b.id}`,
    kind: b.kind,
    state,
    title: b.name,
    subtitle,
    thumb: b.previewHash,
    // real counters, so a real bar — the same rule catalogPercent follows
    percent: b.steps > 0 ? Math.min(100, Math.round((b.step / b.steps) * 100)) : null,
    startedAt: b.startedAt,
    // nowhere to go until the asset exists
    href: b.assetId ? (b.kind === 'presenter' ? presenterPath(brand, b.assetId) : scenePath(brand, b.assetId)) : null,
  };
}

/** What a studio's work is doing, or what came of it, in the row's second line. */
export function studioSubtitle(w: StudioWork): string {
  if (w.kind === 'examples') {
    const said = examplesSubtitle(w);
    // Some drew and some did not: the run is done, and carries why.
    return w.status === 'done' && w.error
      ? `${said} · ${Math.max(1, (w.total ?? 0) - (w.done ?? 0))} did not draw`
      : said;
  }
  if (w.status === 'failed') return w.error ?? 'It did not finish';
  if (w.status === 'cancelled') return 'Stopped';
  if (w.kind === 'scene') {
    if (w.status === 'running')
      return w.step === 'reading'
        ? 'Reading the place'
        : w.step === 'changing'
          ? 'Changing the words'
          : 'Drawing the picture';
    // Words added before anything was drawn change the words and draw nothing.
    if (w.job === 'change' && !w.thumb) return 'The words are changed';
    return w.attachTo ? 'On its scene now' : 'The picture is drawn';
  }
  const view = w.step && w.step in VIEW_NAME ? VIEW_NAME[w.step as StudioView] : null;
  if (w.status === 'running') return view ? `Drawing the ${view}` : 'Reading the photos';
  if (w.awaiting && view) return `The ${view} is ready to look at`;
  if (w.total && w.done === w.total) return 'Every view is drawn';
  return w.total ? `${w.done ?? 0} of ${w.total} views` : 'Drawn';
}

/**
 * A scene or a presenter being made in its studio, as a row in the same list
 * as everything else, leading back to where it is being made: the scene
 * conversation it was started in, or the presenter's draft. That is the door a
 * person who left while it drew comes back through.
 */
export function taskFromStudioWork(w: StudioWork, brand: { slug: string }): Task {
  // A run that finished with an error drew some of what it was asked for and
  // not the rest: partial, the same outcome a half-done import is.
  const state: TaskState = w.status === 'failed' ? 'error' : w.status === 'done' && w.error ? 'partial' : w.status;
  const href =
    w.kind === 'examples'
      ? w.sceneId
        ? scenePath(brand, w.sceneId)
        : null
      : w.kind === 'scene'
        ? w.conversation
          ? w.sceneId
            ? sceneEditPath(brand, w.sceneId, w.conversation)
            : sceneStudioPath(brand, w.conversation)
          : w.attachTo
            ? scenePath(brand, w.attachTo)
            : null
        : w.presenterId
          ? presenterEditPath(brand, w.presenterId)
          : w.draftId
            ? presenterStudioPath(brand, w.draftId)
            : null;
  return {
    id: w.id,
    // a scene's examples are the scene's work: its row, its icon
    kind: w.kind === 'examples' ? 'scene' : w.kind,
    state,
    title: w.name.trim() || (w.kind === 'presenter' ? 'New presenter' : 'New scene'),
    subtitle: studioSubtitle(w),
    thumb: w.thumb,
    // real counters for a presenter's set and a scene's examples; a scene is one picture, so the shimmer
    percent: w.kind !== 'scene' && w.total ? Math.round(((w.done ?? 0) / w.total) * 100) : null,
    startedAt: w.startedAt,
    href,
  };
}

/** A task made in a studio, rather than a shot, an import or a build. */
export const isStudioTask = (id: string): boolean =>
  id.startsWith('scene:') || id.startsWith('presenter:') || id.startsWith('examples:');

/**
 * Whether the page on screen is the one a task leads to: a finish there is
 * already on the stage, and needs no second word.
 */
export function showingTask(href: string | null, pathname: string): boolean {
  if (!href) return false;
  return href.split('?')[0].replace(/\/$/, '') === pathname.replace(/\/$/, '');
}

/**
 * Examples drawn inside the conversation that asked for them: they land there
 * one by one as the person watches, so a toast and an unread mark about them
 * said it a second time, over the very question it was answering. That
 * conversation is the scene's edit route, or a new one whose kept record
 * (sceneDrafts' `scenri:scene-studio:<brand>:<convo>`) names the scene.
 */
export function examplesInItsStudio(
  t: { id: string; href?: string | null },
  pathname: string,
  brandId: string,
): boolean {
  if (!t.id.startsWith('examples:') || !t.href) return false;
  const sceneId = t.href.split('?')[0].split('/').pop();
  const edit = pathname.match(/\/scenes\/([^/]+)\/edit(?:\/|$)/);
  if (edit) return edit[1] === sceneId;
  const fresh = pathname.match(/\/scenes\/new\/([^/]+)/);
  if (!fresh) return false;
  try {
    return JSON.parse(local.get(`scenri:scene-studio:${brandId}:${fresh[1]}`) ?? 'null')?.sceneId === sceneId;
  } catch {
    return false;
  }
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

/**
 * Work a server restart took with it, as the failure it is.
 *
 * The studios and the builds are held in the server's memory, so after a
 * restart their running rows are simply gone, and `settled` only reads the
 * rows that are there: a scene draw or a presenter's view vanished from the
 * bell with no word at all. The caller asks only after a poll found the server
 * unreachable, since a row can also go on purpose (a draft discarded, a read
 * that worked) and that is not news. Shots are not here: the server sweeps
 * those to an error of their own.
 */
export function lostWork(prev: Map<string, Task> | null, next: Task[]): Task[] {
  if (!prev) return [];
  const live = new Set(next.map((t) => t.id));
  return [...prev.values()]
    .filter((t) => t.state === 'running' && !live.has(t.id) && (isStudioTask(t.id) || t.id.startsWith('build:')))
    .map((t) => ({ ...t, state: 'error' as const, subtitle: 'Lost when Scenri restarted. Start it again.' }));
}

/**
 * The first answer's `prev` for a brand, read against what this tab last saw
 * running there. The first answer is a baseline, so work that finished while
 * the person was in another brand, or across a reload, finished inside the
 * baseline and was never said anywhere. Everything else in the answer is
 * still a baseline; only what was running keeps that state, so `settled` says
 * how it ended.
 */
export function resumeFrom(running: Task[], next: Task[]): Map<string, Task> | null {
  if (running.length === 0) return null;
  return new Map([...next.map((t) => [t.id, t] as const), ...running.map((t) => [t.id, t] as const)]);
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
  const unwatched = feed.filter((n) => !n.watched);
  if (!seenAt) return unwatched.length;
  const cut = parseTime(seenAt);
  return unwatched.filter((n) => parseTime(n.at) > cut).length;
}

// ---- storage ---------------------------------------------------------------

const feedKey = (brandId: string) => `scenri:notifications-${brandId}`;
const seenKey = (brandId: string) => `scenri:notifications-seen-${brandId}`;

/* The local lane: what the bell keeps is a record, and one that empties when
 * the tab closes is not a record. */
const read = (key: string): string | null => local.get(key);
const write = (key: string, value: string): void => local.set(key, value);

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

/* The session lane: what was running is about this tab's own last look, and
 * a snapshot from last week read on a fresh open would announce a backlog. */
const runningKey = (brandId: string) => `scenri:activity-running-${brandId}`;

/** What this tab last saw running in a brand (see `resumeFrom`). */
export function loadRunning(brandId: string): Task[] {
  const raw = session.get(runningKey(brandId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Task[]).filter((t) => t?.state === 'running') : [];
  } catch {
    return [];
  }
}
export const saveRunning = (brandId: string, tasks: Task[]) =>
  session.set(runningKey(brandId), JSON.stringify(tasks.filter((t) => t.state === 'running')));

/**
 * Whether two poll answers say the same thing, so an unchanged answer keeps
 * the previous reference and nothing downstream re-renders. Value equality by
 * JSON: the lists are at most a few dozen small records, so this costs less
 * than one re-render of one consumer, and it can never miss a field.
 */
export function sameByValue<T>(prev: T[], next: T[]): boolean {
  if (prev === next) return true;
  if (prev.length !== next.length) return false;
  return JSON.stringify(prev) === JSON.stringify(next);
}
