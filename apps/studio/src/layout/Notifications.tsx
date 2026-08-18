import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router';
import { Popover } from '@radix-ui/themes';
import {
  Bell,
  FilmSlate,
  IdentificationBadge,
  ImageSquare,
  Storefront,
  WarningCircle,
  XCircle,
} from '@phosphor-icons/react';
import { api, imgUrl } from '../api.js';
import { useBrand } from '../app/BrandLayout.js';
import { useTaskCenter } from '../app/TaskCenter.js';
import { agoLabel, elapsedLabel, elapsedSec, type NotificationItem, type Task } from '../tasks.js';
import { useToasts } from '../toasts.js';
import { PHONE, useMediaQuery } from '../useMediaQuery.js';
import { useSheetDrag } from '../useSheetDrag.js';
import { failureToast } from '../failure.js';

/**
 * The bell, and the two lists behind it.
 *
 * Tasks answers "is anything happening"; Notifications answers "what happened
 * while I was elsewhere". They are the same events at two lifetimes, so they
 * share one panel and one id space, and the badge tells them apart rather than
 * adding them together.
 *
 * The panel body is written once. Above 768px it is a popover under the bell;
 * below, a sheet off the bottom edge, because the top right corner of a phone
 * is the furthest point from a thumb and a 360px card there is a popover in
 * name only.
 */
type TabKey = 'tasks' | 'feed';

export function NotificationsButton() {
  const { running, unread, panelOpen, setPanelOpen, markSeen } = useTaskCenter();
  const { pathname } = useLocation();
  const phone = useMediaQuery(PHONE);

  // the bar outlives the screen now, so an open panel would follow you around
  useEffect(() => setPanelOpen(false), [pathname, setPanelOpen]);

  const label =
    'Notifications' +
    (unread ? `, ${unread} unread` : '') +
    (running ? `, ${running} task${running === 1 ? '' : 's'} running` : '');

  const badge =
    unread > 0 ? (
      <span className="sc-bell-dot" data-count={unread} aria-hidden>
        {unread > 9 ? '9+' : unread}
      </span>
    ) : running > 0 ? (
      <span className="sc-bell-dot" data-running="" aria-hidden />
    ) : null;

  if (phone) {
    return (
      <>
        <button
          type="button"
          className="sc-icon-btn sc-notif-btn"
          data-on={panelOpen || undefined}
          aria-label={label}
          aria-expanded={panelOpen}
          title="Notifications"
          onClick={() => setPanelOpen(!panelOpen)}
        >
          <Bell size={16} weight={running ? 'fill' : 'regular'} />
          {badge}
        </button>
        {panelOpen ? <Sheet onClose={() => setPanelOpen(false)} onSeen={markSeen} /> : null}
      </>
    );
  }

  return (
    <Popover.Root open={panelOpen} onOpenChange={setPanelOpen}>
      <Popover.Trigger>
        <button type="button" className="sc-icon-btn sc-notif-btn" aria-label={label} title="Notifications">
          <Bell size={16} weight={running ? 'fill' : 'regular'} />
          {badge}
        </button>
      </Popover.Trigger>
      <Popover.Content align="end" className="sc-notif-pop">
        <Panel onClose={() => setPanelOpen(false)} onSeen={markSeen} />
      </Popover.Content>
    </Popover.Root>
  );
}

/**
 * Escape and an outside click are what a sheet owes you; Radix gives those to
 * the popover for free and this is the half of the app that has to earn them.
 */
function Sheet({ onClose, onSeen }: { onClose: () => void; onSeen: () => void }) {
  const { sheet, grip } = useSheetDrag(onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <>
      <div className="sc-notif-scrim" onClick={onClose} aria-hidden />
      <div ref={sheet} className="sc-notif-sheet" role="dialog" aria-modal="true" aria-label="Notifications">
        <div className="sc-shotsheet-grip" {...grip}>
          <span className="sc-shotsheet-bar" aria-hidden />
        </div>
        <Panel onClose={onClose} onSeen={onSeen} />
      </div>
    </>,
    document.body,
  );
}

function Panel({ onClose, onSeen }: { onClose: () => void; onSeen: () => void }) {
  const { tasks, feed, unread, clearFeed } = useTaskCenter();
  const { brand } = useBrand();
  const navigate = useNavigate();
  const { push } = useToasts();
  const [tab, setTab] = useState<TabKey>('tasks');
  const tabsRef = useRef<HTMLDivElement>(null);
  // seconds tick on their own; the poll is slower than the clock
  const now = useNow(1000);

  // a node task's id is `node:<uuid>`; the next poll tick (TaskCenter's own
  // 1.5s interval while anything is running) picks up the resulting status
  // change on its own, so this has nothing else to do once the call lands
  const cancelTask = (taskId: string) => {
    if (taskId.startsWith('node:')) {
      void api.cancelNode(taskId.slice(5)).catch((e) => push(failureToast(e, 'Could not cancel this shot')));
      return;
    }
    // A build runs a real child process on this machine; cancelling kills it.
    if (taskId.startsWith('build:')) {
      void api
        .cancelAssetBuild(brand.id, taskId.slice(6))
        .catch((e) => push(failureToast(e, 'Could not stop this build')));
    }
  };

  // opening on Tasks must not silently clear the badge: the mark belongs to the
  // list you actually looked at
  useEffect(() => {
    if (tab === 'feed') onSeen();
  }, [tab, onSeen]);

  const open = (href: string) => {
    navigate(href);
    onClose();
  };

  // left/right move between the two; up/down stay free to scroll the list
  const onKeyDown = (e: React.KeyboardEvent) => {
    const order: TabKey[] = ['tasks', 'feed'];
    const i = order.indexOf(tab);
    let next: TabKey | null = null;
    if (e.key === 'ArrowRight') next = order[(i + 1) % order.length];
    else if (e.key === 'ArrowLeft') next = order[(i - 1 + order.length) % order.length];
    else if (e.key === 'Home') next = order[0];
    else if (e.key === 'End') next = order[order.length - 1];
    if (!next) return;
    e.preventDefault();
    setTab(next);
    tabsRef.current?.querySelector<HTMLButtonElement>(`#sc-notif-tab-${next}`)?.focus();
  };

  return (
    <>
      <div className="sc-notif-tabs" role="tablist" aria-label="Notifications" ref={tabsRef} onKeyDown={onKeyDown}>
        <Tab id="tasks" tab={tab} onSelect={setTab} count={tasks.length}>
          Tasks
        </Tab>
        <Tab id="feed" tab={tab} onSelect={setTab} count={unread || undefined}>
          Notifications
        </Tab>
      </div>

      <div
        className="sc-notif-scroll"
        role="tabpanel"
        id={`sc-notif-panel-${tab}`}
        aria-labelledby={`sc-notif-tab-${tab}`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard (WCAG 2.1.1) and the tabpanel is the scroller
        tabIndex={0}
      >
        {tab === 'tasks' ? (
          tasks.length === 0 ? (
            <p className="sc-notif-empty">Nothing running. Generations show up here as they go.</p>
          ) : (
            tasks.map((t) => <TaskRow key={t.id} task={t} now={now} onOpen={open} onCancel={cancelTask} />)
          )
        ) : feed.length === 0 ? (
          <p className="sc-notif-empty">You have no notifications yet.</p>
        ) : (
          feed.map((n) => <FeedRow key={n.id} item={n} now={now} onOpen={open} />)
        )}
      </div>

      {tab === 'feed' && feed.length > 0 ? (
        <div className="sc-notif-foot">
          <button type="button" className="sc-notif-clear" onClick={clearFeed}>
            Clear all
          </button>
        </div>
      ) : null}
    </>
  );
}

function Tab({
  id,
  tab,
  onSelect,
  count,
  children,
}: {
  id: TabKey;
  tab: TabKey;
  onSelect: (t: TabKey) => void;
  count?: number;
  children: ReactNode;
}) {
  const on = tab === id;
  return (
    <button
      type="button"
      role="tab"
      id={`sc-notif-tab-${id}`}
      className="sc-notif-tab"
      aria-selected={on}
      aria-controls={`sc-notif-panel-${id}`}
      tabIndex={on ? 0 : -1}
      onClick={() => onSelect(id)}
    >
      {children}
      {count ? <span className="sc-notif-n">{count}</span> : null}
    </button>
  );
}

function Thumb({ task }: { task: Pick<Task, 'kind' | 'state' | 'thumb' | 'title'> }) {
  if (task.thumb) return <img src={imgUrl(task.thumb)} alt="" />;
  if (task.state === 'running') return <span className="sc-shimmer" />;
  if (task.state === 'error') return <WarningCircle size={17} weight="fill" />;
  if (task.state === 'cancelled') return <XCircle size={17} color="var(--sc-fg3)" />;
  if (task.kind === 'catalog') return <Storefront size={17} />;
  // the same glyphs the nav uses for these two destinations
  if (task.kind === 'presenter') return <IdentificationBadge size={17} />;
  if (task.kind === 'scene') return <FilmSlate size={17} />;
  return <ImageSquare size={17} />;
}

function TaskRow({
  task,
  now,
  onOpen,
  onCancel,
}: {
  task: Task;
  now: number;
  onOpen: (href: string) => void;
  onCancel: (taskId: string) => void;
}) {
  const running = task.state === 'running';
  // Both kinds of work that can actually be stopped. A catalog import cannot.
  const stoppable = task.id.startsWith('node:') || task.id.startsWith('build:');
  // past 60s, the cancel control is the one thing on this row worth making
  // louder than the rest, since it is the only way out of a stuck run
  const urgent = running && elapsedSec(task.startedAt, now) >= 60;
  return (
    <div className="sc-notif-row-wrap">
      <button
        type="button"
        className="sc-notif-row"
        data-state={task.state}
        data-running={running || undefined}
        disabled={!task.href}
        onClick={() => task.href && onOpen(task.href)}
      >
        <span className="sc-notif-thumb">
          <Thumb task={task} />
        </span>
        <span className="sc-notif-txt">
          <b dir="auto">{task.title}</b>
          <small dir="auto">{task.subtitle}</small>
          {running && task.percent !== null ? (
            <span className="sc-notif-meter">
              <div style={{ width: `${task.percent}%` }} />
            </span>
          ) : null}
        </span>
        <span className="sc-notif-time">
          {running ? elapsedLabel(task.startedAt, now) : agoLabel(task.startedAt, now)}
        </span>
      </button>
      {running && stoppable && (
        <button
          type="button"
          className="sc-notif-row-cancel"
          data-urgent={urgent || undefined}
          onClick={(e) => {
            e.stopPropagation();
            onCancel(task.id);
          }}
        >
          Cancel
        </button>
      )}
    </div>
  );
}

function FeedRow({ item, now, onOpen }: { item: NotificationItem; now: number; onOpen: (href: string) => void }) {
  return (
    <button
      type="button"
      className="sc-notif-row"
      data-state={item.state}
      disabled={!item.href}
      onClick={() => item.href && onOpen(item.href)}
    >
      <span className="sc-notif-thumb">
        <Thumb task={item} />
      </span>
      <span className="sc-notif-txt">
        <b dir="auto">{item.title}</b>
        <small dir="auto">{item.subtitle}</small>
      </span>
      <span className="sc-notif-time">{agoLabel(item.at, now)}</span>
    </button>
  );
}

/** A clock only while the panel is open — elapsed seconds should not cost a poll. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
