import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { api, type ActivityNode, type AssetBuild, type Brand, type StudioWork } from '../api.js';
import { spendAssetDraft } from '../createDraft.js';
import { useToasts } from '../toasts.js';
import { hubPath } from '../routes.js';
import { useAppData } from './AppShell.js';
import {
  batchTask,
  isStudioTask,
  loadFeed,
  loadSeen,
  mergeFeed,
  orderTasks,
  saveFeed,
  saveSeen,
  settled,
  showingTask,
  taskFromAssetBuild,
  taskFromCatalogJob,
  taskFromNode,
  taskFromStudioWork,
  unreadCount,
  type NotificationItem,
  type Task,
  sameByValue,
} from '../tasks.js';

/**
 * One owner for work in flight, mounted above the screens rather than inside
 * one of them.
 *
 * A generation is the slowest thing this app does and it used to be watched
 * only by the project screen that started it: walk away and the poll unmounted,
 * the finish went unannounced, and a reload erased even the fact that it had
 * happened. The server always knew. Nothing was asking.
 *
 * So the asking moved up here, where it outlives any one route, and the toast
 * that used to fire from ProjectView fires from here instead — which is the
 * whole point, since the case worth telling you about is the one where you are
 * somewhere else.
 */

const RUNNING_MS = 1500; // what the project screen has always used
// Idle is not free-for-all: a shot fired from the composer has to show up in
// the bell before you wonder whether it took. One SQLite read against a server
// on this same machine is cheap enough to ask this often.
const IDLE_MS = 5000;

export interface TaskCenterValue {
  tasks: Task[];
  running: number;
  /**
   * The presenters and scenes being built for this brand, raw.
   *
   * The library pages draw their own card for these, which needs more than a
   * task row carries — the stage message, the step count, the preview frame as
   * soon as one exists. Polling for them lives here rather than on those pages
   * because the top bar's + can start one from anywhere.
   */
  builds: AssetBuild[];
  /**
   * The studios' work for this brand, raw: scene jobs and presenter runs. The
   * Scenes wall reads it for the drafts it shows, the way the library pages
   * read `builds` for theirs.
   */
  studio: StudioWork[];
  feed: NotificationItem[];
  unread: number;
  markSeen: () => void;
  clearFeed: () => void;
  panelOpen: boolean;
  setPanelOpen: (v: boolean) => void;
  /**
   * Ask for a poll now. Work that has just been queued from inside the app is
   * the one case where waiting out the idle cadence is plainly wrong: the
   * server is already busy and only this timer has not been told yet.
   */
  poke: () => void;
}

const Ctx = createContext<TaskCenterValue | null>(null);

export function useTaskCenter(): TaskCenterValue {
  const value = useContext(Ctx);
  if (!value) throw new Error('useTaskCenter must be used inside TaskCenterProvider');
  return value;
}

export function TaskCenterProvider({
  brand,
  onActivity,
  children,
}: {
  brand: Brand;
  /**
   * Every poll's fresh shot records, handed to whoever holds the feed. The
   * feed used to refetch the whole workspace whenever the bell saw a state
   * change; the records that changed were already in the bell's hands.
   */
  onActivity?: (brandId: string, nodes: ActivityNode[]) => void;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const { push } = useToasts();
  const { refreshBrands } = useAppData();
  // the feed is keyed by id and the links are built from the slug: a rename
  // changes where a task points, never which brand's history it belongs to
  const brandId = brand.id;

  const [tasks, setTasks] = useState<Task[]>([]);
  const [builds, setBuilds] = useState<AssetBuild[]>([]);
  const [studioWork, setStudioWork] = useState<StudioWork[]>([]);
  // `pull` is memoised on the brand's id alone, so anything it reads across
  // ticks is a ref. The brand row itself is one too: keyed on the row, every
  // `applyBrand` (a rename, a palette edit, a delete) re-armed the poll loop and
  // fired an extra tick, and overlapping ticks could each ask for the brand.
  const brandRef = useRef(brand);
  brandRef.current = brand;
  const buildsRef = useRef<AssetBuild[]>([]);
  buildsRef.current = builds;
  const [feed, setFeed] = useState<NotificationItem[]>(() => loadFeed(brandId));
  const [seenAt, setSeenAt] = useState<string | null>(() => loadSeen(brandId));
  const [panelOpen, setPanelOpen] = useState(false);

  // the previous poll's tasks, by id: the only thing that can tell us something
  // has just finished. A ref, because a poll must not depend on its own output.
  // null until the first answer lands — that one is a baseline, never a backlog.
  const prevRef = useRef<Map<string, Task> | null>(null);
  const announcedRef = useRef<Set<string>>(new Set());
  const runningRef = useRef(0);
  // Which finished builds we have already refetched the brand for. A finished
  // build stays in the list, so without this every tick would refetch.
  const brandPulledRef = useRef<Set<string>>(new Set());
  const refreshBrandsRef = useRef(refreshBrands);
  refreshBrandsRef.current = refreshBrands;
  // the live timer's own re-arm, published by the effect below so poke() can
  // reach it without owning a timer of its own
  const restartRef = useRef<(() => void) | null>(null);
  const panelOpenRef = useRef(panelOpen);
  panelOpenRef.current = panelOpen;
  const navRef = useRef(navigate);
  navRef.current = navigate;
  /**
   * Whether the feed a finished shot lands in is already on screen. The tile
   * is its own announcement there, and after three or four refinements the
   * toasts were stacking up over the assets rail to say what the work in front
   * of you had already said.
   */
  const { pathname } = useLocation();
  const watchingFeedRef = useRef(false);
  watchingFeedRef.current = /\/(create|sets)(\/|$)/.test(pathname);
  const pushRef = useRef(push);
  pushRef.current = push;
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;

  // brand is in the path, so switching brands must not carry the other one's
  // history or edge state across
  useEffect(() => {
    prevRef.current = null;
    announcedRef.current = new Set();
    runningRef.current = 0;
    brandPulledRef.current = new Set();
    setTasks([]);
    setBuilds([]);
    setStudioWork([]);
    setFeed(loadFeed(brandId));
    setSeenAt(loadSeen(brandId));
  }, [brandId]);

  const pull = useCallback(async () => {
    let next: Task[];
    let liveBuilds: AssetBuild[];
    let liveStudio: StudioWork[];
    try {
      // One tick, both sources. Asked together so a build and a generation can
      // never disagree about what moment it is.
      const [{ nodes, jobs, studio = [] }, { builds: bs }] = await Promise.all([
        api.activity(brandId),
        api.assetBuilds(brandId),
      ]);
      liveBuilds = bs;
      liveStudio = studio;
      onActivityRef.current?.(brandId, nodes);
      // One row per REQUEST, not per sibling: a four-shot batch is one piece
      // of work in the bell, read across all of its siblings (batchTask) now
      // that each lands on its own.
      const byBatch = new Map<string, ActivityNode[]>();
      const singles: ActivityNode[] = [];
      for (const n of nodes) {
        if (!n.batchId) singles.push(n);
        else byBatch.set(n.batchId, [...(byBatch.get(n.batchId) ?? []), n]);
      }
      const now = Date.now();
      next = [
        ...singles.map((n) => taskFromNode(n, brandRef.current, now)),
        ...[...byBatch.values()].map((group) => batchTask(group, brandRef.current, now)),
        ...jobs.map((j) => taskFromCatalogJob(j, brandRef.current)),
        ...bs.map((b) => taskFromAssetBuild(b, brandRef.current)),
        ...studio.map((w) => taskFromStudioWork(w, brandRef.current)),
      ];
    } catch {
      // the bell is not worth an error state; the next tick will tell the truth
      return;
    }
    // A build writes straight into the brand document, so the moment one lands
    // the brand this app is holding is a version behind.
    const landed = liveBuilds.filter((b) => b.finished && b.assetId && !brandPulledRef.current.has(b.id));
    // A build that was running and is now simply GONE is the same problem wearing
    // a disguise. The registry is an in-memory Map, pruned at twelve per brand and
    // emptied by a server restart, so a row can vanish between two polls with its
    // scene already written to disk. Watching only for rows that land left that
    // scene invisible until a full page reload.
    const live = new Set(liveBuilds.map((b) => b.id));
    const vanished = buildsRef.current.some((b) => !b.finished && !live.has(b.id));
    // A scene saved while its picture drew gets the picture from the server
    // when it lands, into the brand document, with nobody on the page to ask
    // for it: the brand this app holds is a version behind until it is read.
    const attached = liveStudio.filter(
      (w) => w.kind === 'scene' && w.status === 'done' && !!w.attachTo && !brandPulledRef.current.has(w.id),
    );
    for (const w of attached) brandPulledRef.current.add(w.id);
    if (landed.length || vanished || attached.length) {
      for (const b of landed) {
        brandPulledRef.current.add(b.id);
        // The asset exists now, so the attempt that made it is over. Its draft
        // was kept past the submit for one reason — a failure handing the
        // photographs back — and that reason is spent. Left alone, it refills
        // the next New presenter with the last one's face.
        spendAssetDraft(brandId, b.kind, b.id);
      }
      await refreshBrandsRef.current();
    }
    // After the pull, never before: setBuilds is what removes the in-progress
    // card, and doing it first left a frame where the card was gone and the
    // finished scene had not arrived yet.
    setBuilds((prev) => (sameByValue(prev, liveBuilds) ? prev : liveBuilds));
    setStudioWork((prev) => (sameByValue(prev, liveStudio) ? prev : liveStudio));

    const arrivals = settled(prevRef.current, next);
    prevRef.current = new Map(next.map((t) => [t.id, t]));
    runningRef.current = next.filter((t) => t.state === 'running').length;
    const ordered = orderTasks(next);
    setTasks((prev) => (sameByValue(prev, ordered) ? prev : ordered));

    if (arrivals.length === 0) return;

    setFeed((f) => {
      // a finish that landed on the feed you were looking at is already
      // accounted for: it keeps its place in the record without also becoming
      // an unread alert about itself
      // and so is studio work that finished on the studio page it belongs to:
      // the stage showed it, failure and all
      const here = window.location.pathname;
      const marked = arrivals.map((a) =>
        isStudioTask(a.id) && showingTask(a.href, here)
          ? { ...a, watched: true }
          : watchingFeedRef.current && a.state !== 'error'
            ? { ...a, watched: true }
            : a,
      );
      const merged = mergeFeed(f, marked);
      saveFeed(brandId, merged);
      return merged;
    });

    // you are already looking at the list; a toast over it is noise
    if (panelOpenRef.current) return;
    for (const n of arrivals) {
      if (announcedRef.current.has(n.id)) continue;
      announcedRef.current.add(n.id);
      // you already know: you are the one who cancelled it
      if (n.state === 'cancelled') continue;
      /*
       * Work from a studio, finished while you were elsewhere. On its own page
       * the stage already said it, failure included, so nothing is said twice.
       * Anywhere else it is one card that names what it was and leads back to
       * it: a scene drawn, a presenter's views drawn (or one waiting to be
       * looked at), or one that did not finish, which stays until dismissed.
       */
      if (isStudioTask(n.id)) {
        if (showingTask(n.href, window.location.pathname)) continue;
        const to = n.href;
        const actions = to ? [{ label: 'Open', onClick: () => navRef.current(to) }] : undefined;
        if (n.state === 'error') {
          pushRef.current({ kind: 'error', title: `${n.title} did not finish`, detail: n.subtitle, actions });
          continue;
        }
        pushRef.current({
          kind: 'success',
          title: `${n.title} is drawn`,
          detail: n.kind === 'presenter' ? n.subtitle : undefined,
          actions,
        });
        continue;
      }
      // A finish you are watching land needs no second word. A failure still
      // speaks: the tile it leaves behind is deliberately quiet.
      // A presenter or a scene never lands in the feed, so it is never already seen there.
      if (n.state !== 'error' && watchingFeedRef.current && n.kind !== 'presenter' && n.kind !== 'scene') continue;
      const href = n.href;
      const action = href ? { label: 'View', onClick: () => navRef.current(href) } : undefined;
      if (n.state === 'error') {
        // A shot failing on the feed you are watching was already announced
        // by the feed's own live region; the card still shows, the second
        // announcement does not.
        const quiet = watchingFeedRef.current && (n.kind === 'generation' || n.kind === 'edit');
        pushRef.current({ kind: 'error', title: `${n.title} failed`, detail: n.subtitle, action, quiet });
        continue;
      }
      /*
       * A built asset says its own name and offers the two things anyone does
       * next with one. "Generation finished / <prompt>" would be the wrong
       * sentence here: nothing was generated for the feed, something was added
       * to the brand.
       */
      if (n.kind === 'presenter' || n.kind === 'scene') {
        const assetId = n.id.startsWith('build:')
          ? (liveBuilds.find((b) => `build:${b.id}` === n.id)?.assetId ?? null)
          : null;
        pushRef.current({
          kind: 'success',
          title: `${n.title} is ready`,
          detail: n.subtitle,
          actions: href
            ? [
                {
                  label: n.kind === 'presenter' ? 'View presenter' : 'View scene',
                  onClick: () => navRef.current(href),
                },
                {
                  label: 'Use in a shot',
                  onClick: () =>
                    navRef.current(
                      `${hubPath(brandRef.current)}?${n.kind === 'presenter' ? 'presenter' : 'scene'}=${assetId}&compose=1`,
                    ),
                },
              ]
            : undefined,
        });
        continue;
      }
      /*
       * An import that only half worked said "finished" like any other, so a
       * run that saved 228 of 237 products announced itself exactly as one
       * that saved all of them, and the nine were only findable by opening the
       * row. Partial is its own outcome and says so, quietly rather than
       * alarmingly: the products that landed are real and the person can carry
       * on. The row underneath already carries the detail.
       */
      if (n.kind === 'catalog' && n.state === 'partial') {
        pushRef.current({ kind: 'warning', title: 'Some products did not import', detail: n.subtitle, action });
        continue;
      }
      pushRef.current({
        kind: 'success',
        title: n.kind === 'catalog' ? 'Import finished' : 'Generation finished',
        // a catalog name is a name; a generation title is often six prompt words
        detail: n.kind === 'catalog' ? n.title : undefined,
        action,
      });
    }
  }, [brandId]);

  // One timer, re-armed at whichever cadence the current answer deserves. A
  // hidden tab skips the request — polling a screen nobody is looking at is the
  // kind of cost that only shows up on someone else's battery — but it keeps
  // the timer alive. Returning early instead used to end the loop for good if
  // the very first tick happened to land while the page was not yet visible,
  // and nothing but a later visibilitychange could ever bring it back.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let alive = true;

    const tick = async () => {
      if (!alive) return;
      if (!document.hidden) await pull();
      if (!alive) return;
      const busy = !document.hidden && runningRef.current > 0;
      timer = setTimeout(tick, busy ? RUNNING_MS : IDLE_MS);
    };
    const restart = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (!document.hidden) void tick();
    };
    // poke() reaches the live timer through here, so it re-arms the one loop
    // rather than starting a second one beside it
    restartRef.current = restart;

    void tick();
    document.addEventListener('visibilitychange', restart);
    window.addEventListener('focus', restart);
    return () => {
      alive = false;
      restartRef.current = null;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', restart);
      window.removeEventListener('focus', restart);
    };
  }, [pull]);

  const poke = useCallback(() => restartRef.current?.(), []);

  const markSeen = useCallback(() => {
    const at = new Date().toISOString();
    setSeenAt(at);
    saveSeen(brandId, at);
  }, [brandId]);

  const clearFeed = useCallback(() => {
    setFeed([]);
    saveFeed(brandId, []);
    markSeen();
  }, [brandId, markSeen]);

  const value = useMemo<TaskCenterValue>(
    () => ({
      tasks,
      running: tasks.filter((t) => t.state === 'running').length,
      builds,
      studio: studioWork,
      feed,
      unread: unreadCount(feed, seenAt),
      markSeen,
      clearFeed,
      panelOpen,
      setPanelOpen,
      poke,
    }),
    [tasks, builds, studioWork, feed, seenAt, markSeen, clearFeed, panelOpen, poke],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
