import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router';
import { Popover } from '@radix-ui/themes';
import { Bell, ImageSquare, Storefront, WarningCircle, XCircle } from '@phosphor-icons/react';
import { api, imgUrl } from '../api.js';
import { useTaskCenter } from '../app/TaskCenter.js';
import { agoLabel, elapsedLabel, elapsedSec, type NotificationItem, type Task } from '../tasks.js';
import { useToasts } from '../toasts.js';

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
const PHONE = '(max-width: 767px)';

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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Escape above is the keyboard path; the scrim is a mouse convenience */}
      <div className="sc-notif-scrim" onClick={onClose} aria-hidden />
      <div className="sc-notif-sheet" role="dialog" aria-modal="true" aria-label="Notifications">
        <div className="sc-notif-grab" aria-hidden />
        <Panel onClose={onClose} onSeen={onSeen} />
      </div>
    </>,
    document.body,
  );
}

function Panel({ onClose, onSeen }: { onClose: () => void; onSeen: () => void }) {
  const { tasks, feed, unread, clearFeed } = useTaskCenter();
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
    const nodeId = taskId.startsWith('node:') ? taskId.slice(5) : null;
    if (!nodeId) return;
    void api
      .cancelNode(nodeId)
      .catch((e) => push({ kind: 'error', title: 'Could not cancel this shot', detail: String(e.message ?? e) }));
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
      {/* biome-ignore lint/a11y/useFocusableInteractive: the tabs themselves are the focusable elements */}
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
  const nodeTask = task.id.startsWith('node:');
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
      {running && nodeTask && (
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

/** Which shell to render. Watched, not sampled: a rotated phone is a new answer. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
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
