import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { api, type Brand } from '../api.js';
import { useToasts } from '../toasts.js';
import {
  loadFeed,
  loadSeen,
  mergeFeed,
  orderTasks,
  saveFeed,
  saveSeen,
  settled,
  taskFromCatalogJob,
  taskFromNode,
  unreadCount,
  type NotificationItem,
  type Task,
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

export function TaskCenterProvider({ brand, children }: { brand: Brand; children: ReactNode }) {
  const navigate = useNavigate();
  const { push } = useToasts();
  // the feed is keyed by id and the links are built from the slug: a rename
  // changes where a task points, never which brand's history it belongs to
  const brandId = brand.id;

  const [tasks, setTasks] = useState<Task[]>([]);
  const [feed, setFeed] = useState<NotificationItem[]>(() => loadFeed(brandId));
  const [seenAt, setSeenAt] = useState<string | null>(() => loadSeen(brandId));
  const [panelOpen, setPanelOpen] = useState(false);

  // the previous poll's tasks, by id: the only thing that can tell us something
  // has just finished. A ref, because a poll must not depend on its own output.
  // null until the first answer lands — that one is a baseline, never a backlog.
  const prevRef = useRef<Map<string, Task> | null>(null);
  const announcedRef = useRef<Set<string>>(new Set());
  const runningRef = useRef(0);
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

  // brand is in the path, so switching brands must not carry the other one's
  // history or edge state across
  useEffect(() => {
    prevRef.current = null;
    announcedRef.current = new Set();
    runningRef.current = 0;
    setTasks([]);
    setFeed(loadFeed(brandId));
    setSeenAt(loadSeen(brandId));
  }, [brandId]);

  const pull = useCallback(async () => {
    let next: Task[];
    try {
      const { nodes, jobs } = await api.activity(brandId);
      next = [...nodes.map((n) => taskFromNode(n, brand)), ...jobs.map((j) => taskFromCatalogJob(j, brand))];
    } catch {
      // the bell is not worth an error state; the next tick will tell the truth
      return;
    }

    const arrivals = settled(prevRef.current, next);
    prevRef.current = new Map(next.map((t) => [t.id, t]));
    runningRef.current = next.filter((t) => t.state === 'running').length;
    setTasks(orderTasks(next));

    if (arrivals.length === 0) return;

    setFeed((f) => {
      // a finish that landed on the feed you were looking at is already
      // accounted for: it keeps its place in the record without also becoming
      // an unread alert about itself
      const marked = watchingFeedRef.current
        ? arrivals.map((a) => (a.state === 'error' ? a : { ...a, watched: true }))
        : arrivals;
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
      // A finish you are watching land needs no second word. A failure still
      // speaks: the tile it leaves behind is deliberately quiet.
      if (n.state !== 'error' && watchingFeedRef.current) continue;
      const href = n.href;
      const action = href ? { label: 'View', onClick: () => navRef.current(href) } : undefined;
      pushRef.current(
        n.state === 'error'
          ? { kind: 'error', title: `${n.title} failed`, detail: n.subtitle, action }
          : {
              kind: 'success',
              title: n.kind === 'catalog' ? 'Catalog import finished' : 'Generation finished',
              detail: n.title,
              action,
            },
      );
    }
  }, [brandId, brand]);

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
      feed,
      unread: unreadCount(feed, seenAt),
      markSeen,
      clearFeed,
      panelOpen,
      setPanelOpen,
      poke,
    }),
    [tasks, feed, seenAt, markSeen, clearFeed, panelOpen, poke],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
