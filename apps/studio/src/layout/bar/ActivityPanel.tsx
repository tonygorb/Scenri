import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { FilmSlate, IdentificationBadge, ImageSquare, Storefront, WarningCircle, XCircle } from '@phosphor-icons/react';
import { api, thumbUrl } from '../../api.js';
import { useBrand } from '../../app/BrandLayout.js';
import { useTaskCenter } from '../../app/TaskCenter.js';
import { agoLabel, elapsedLabel, elapsedSec, type NotificationItem, type Task } from '../../tasks.js';
import { useToasts } from '../../toasts.js';
import { failureToast } from '../../failure.js';

/**
 * The two lists, one under the other.
 *
 * In progress answers "is anything happening"; Notifications answers "what
 * happened while I was elsewhere". They used to be two tabs, which meant the
 * answer to one of those questions was always one press away and the panel
 * opened on a guess about which you wanted. They are the same events at two
 * lifetimes, so they are two labelled sections of one list now, and nothing has
 * to be chosen to be seen.
 *
 * The badge is cleared by "Mark all read" or by opening a notification, never by
 * opening the panel: with both sections visible, clearing on open would mark
 * things read that were never looked at.
 */
export function ActivityPanel({
  onClose,
  onSeen,
  onOpenDetail,
}: {
  onClose: () => void;
  onSeen: () => void;
  onOpenDetail: (jobId: string) => void;
}) {
  const { tasks, feed, unread, clearFeed } = useTaskCenter();
  const { brand } = useBrand();
  const { push } = useToasts();
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
      return;
    }
    // A catalog import can be stopped too. The route has always existed and
    // nothing ever called it, so a 2,000-product import was unstoppable.
    if (taskId.startsWith('catalog:')) {
      void api
        .cancelCatalogJob(brand.id, taskId.slice(8))
        .catch((e) => push(failureToast(e, 'Could not stop this import')));
    }
  };

  return (
    <div className="sc-notif-scroll">
      <section aria-label="In progress">
        <h3 className="sc-notif-label">In progress</h3>
        {tasks.length === 0 ? (
          <p className="sc-notif-empty">Nothing running. Generations show up here as they go.</p>
        ) : (
          tasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              now={now}
              onNavigate={onClose}
              onCancel={cancelTask}
              onOpenDetail={onOpenDetail}
            />
          ))
        )}
      </section>

      <section aria-label="Notifications">
        <h3 className="sc-notif-label">
          <span>Notifications</span>
          {unread > 0 && (
            <button type="button" className="sc-notif-seen" onClick={onSeen}>
              Mark all read
            </button>
          )}
        </h3>
        {feed.length === 0 ? (
          <p className="sc-notif-empty">You have no notifications yet.</p>
        ) : (
          feed.map((n) => <FeedRow key={n.id} item={n} now={now} onNavigate={onClose} onSeen={onSeen} />)
        )}
        {feed.length > 0 ? (
          <div className="sc-notif-foot">
            <button type="button" className="sc-notif-clear" onClick={clearFeed}>
              Clear all
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Thumb({ task }: { task: Pick<Task, 'kind' | 'state' | 'thumb' | 'title'> }) {
  if (task.thumb) return <img src={thumbUrl(task.thumb, 'micro')} alt="" loading="lazy" decoding="async" />;
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
  onNavigate,
  onCancel,
  onOpenDetail,
}: {
  task: Task;
  now: number;
  /** The row is a real Link; this only closes the panel behind it. */
  onNavigate: () => void;
  onCancel: (taskId: string) => void;
  /** A running import opens onto itself rather than navigating somewhere else. */
  onOpenDetail: (jobId: string) => void;
}) {
  const running = task.state === 'running';
  // Every kind of work that can actually be stopped. A catalog import can:
  // its route existed from the start and the UI simply never called it.
  const stoppable = task.id.startsWith('node:') || task.id.startsWith('build:') || task.id.startsWith('catalog:');
  // past 60s, the cancel control is the one thing on this row worth making
  // louder than the rest, since it is the only way out of a stuck run
  const urgent = running && elapsedSec(task.startedAt, now) >= 60;
  // While a catalog import runs, the useful destination is the import itself:
  // the products it is writing are not all there yet, so sending someone to
  // the products page mid-run shows them a half-filled shelf.
  const detailJobId = running && task.id.startsWith('catalog:') ? task.id.slice(8) : null;
  const body = (
    <>
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
    </>
  );
  return (
    <div className="sc-notif-row-wrap">
      {detailJobId ? (
        <button
          type="button"
          className="sc-notif-row"
          data-state={task.state}
          data-running={running || undefined}
          onClick={() => onOpenDetail(detailJobId)}
        >
          {body}
        </button>
      ) : task.href ? (
        // A real Link: the row's destination survives middle click and Cmd
        // click; a plain click still closes the panel behind the navigation.
        <Link
          className="sc-notif-row"
          data-state={task.state}
          data-running={running || undefined}
          to={task.href}
          onClick={onNavigate}
        >
          {body}
        </Link>
      ) : (
        <button
          type="button"
          className="sc-notif-row"
          data-state={task.state}
          data-running={running || undefined}
          disabled
        >
          {body}
        </button>
      )}
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

function FeedRow({
  item,
  now,
  onNavigate,
  onSeen,
}: {
  item: NotificationItem;
  now: number;
  onNavigate: () => void;
  onSeen: () => void;
}) {
  const body = (
    <>
      <span className="sc-notif-thumb">
        <Thumb task={item} />
      </span>
      <span className="sc-notif-txt">
        <b dir="auto">{item.title}</b>
        <small dir="auto">{item.subtitle}</small>
      </span>
      <span className="sc-notif-time">{agoLabel(item.at, now)}</span>
    </>
  );
  if (item.href) {
    return (
      <Link
        className="sc-notif-row"
        data-state={item.state}
        to={item.href}
        onClick={() => {
          // opening one is reading them: the badge has done its job
          onSeen();
          onNavigate();
        }}
      >
        {body}
      </Link>
    );
  }
  return (
    <button type="button" className="sc-notif-row" data-state={item.state} disabled>
      {body}
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
