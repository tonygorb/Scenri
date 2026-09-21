import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Check, Warning, WarningCircle, X } from '@phosphor-icons/react';

/**
 * Transient feedback about what just happened. Nothing more.
 *
 * The boundary with Activity is deliberate: a toast answers "did that work"
 * for something done a second ago, then leaves. Work that runs in the
 * background and finishes while you are elsewhere belongs to the bell
 * (TaskCenter), which is also the only place a durable notification is born.
 * A toast never writes Activity and is never required for the product to be
 * correct: if this whole stack failed to render, every mutation still stands.
 *
 * Four kinds, and no more:
 * - info: a state change worth knowing that is nobody's accomplishment
 *   ("That scene is no longer available").
 * - success: something asked for completed, and the screen does not already
 *   say so ("Archived", with Undo).
 * - warning: it worked, with something worth knowing ("Logo added, but it is
 *   small"), or a refusal ("That is not an image").
 * - error: it failed. The only kind that persists, and the only colour the
 *   surface wears.
 *
 * Timing: ephemeral toasts auto-dismiss on a length-scaled timer that pauses
 * under the pointer, under keyboard focus, and while the tab is hidden (WCAG
 * 2.2.1). A toast carrying an action gets a longer leash, not immortality:
 * every action offered here also exists somewhere durable (the Archived lens,
 * Help, re-picking the scene), so the card is a shortcut, not the only door.
 * An error stays until dismissed.
 */

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastInput {
  kind: ToastKind;
  title: string;
  detail?: string;
  /** One action, the original shape. Kept so no existing caller changes. */
  action?: ToastAction;
  /**
   * Two, at most — "what did I just make" usually has exactly two honest
   * answers (go look at it, use it), and a third would turn a notice into a
   * menu you have to read.
   */
  actions?: ToastAction[];
  /**
   * Show the card but skip the live-region announcement, for the one case
   * where assistive technology already heard it: a shot failing on Create is
   * announced by the feed's own live region (liveStatus.ts), so the toast's
   * assertive region would say the same thing twice.
   */
  quiet?: boolean;
}

interface ToastItem extends ToastInput {
  id: number;
  /** How many identical events this one card is standing in for. */
  count: number;
  /** Set while the exit animation runs; the item is inert to everything else. */
  leaving?: boolean;
}

const Ctx = createContext<{ push: (t: ToastInput) => void }>({ push: () => {} });
export const useToasts = () => useContext(Ctx);

/** How many can stack before the oldest expendable one is dropped. */
export const TOAST_MAX = 3;
/** Exit is shorter than entry: leaving reads as handled, not arriving. */
const EXIT_MS = 140;

export const hasActions = (t: Pick<ToastInput, 'action' | 'actions'>) => !!(t.action || t.actions?.length);

const actionsOf = (t: Pick<ToastInput, 'action' | 'actions'>) =>
  (t.actions?.length ? t.actions : t.action ? [t.action] : []).slice(0, 2);

/**
 * How long an ephemeral toast gets. Short sentence, short stay; the per-
 * character slope past 40 chars is what keeps "Archived" quiet and a two-line
 * warning readable. Past the cap the message was too important to be a toast
 * at all, which is why errors live under a different rule.
 */
export function durationFor(t: ToastInput): number {
  if (t.kind === 'error') return Infinity;
  const len = t.title.length + (t.detail?.length ?? 0);
  const base = hasActions(t) ? 9000 : 4000;
  const cap = hasActions(t) ? 14000 : 8000;
  return Math.min(base + Math.max(0, len - 40) * 45, cap);
}

/** What the live regions say. The count is spoken; the ×2 is only drawn. */
export function spokenOf(title: string, detail: string | undefined, count: number): string {
  const times = count > 1 ? ` (${count} times)` : '';
  return `${title}${times}${detail ? ` ${detail}` : ''}`;
}

const reducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 16px Phosphor, regular. Info is words only; the mark is for the other three. */
function ToastMark({ kind }: { kind: ToastKind }) {
  if (kind === 'info') return null;
  const Icon = kind === 'success' ? Check : kind === 'warning' ? Warning : WarningCircle;
  return <Icon className="sc-toast-ic" size={16} weight="regular" aria-hidden="true" />;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  /* State's mirror, so push can decide dedup and trim synchronously. Every
   * writer goes through commit, never setItems alone. */
  const itemsRef = useRef<ToastItem[]>([]);
  /*
   * One timer record per toast, kept outside state: pausing re-arms the same
   * remaining time rather than restarting the clock, and none of it should
   * ever re-render anything.
   */
  const timers = useRef(new Map<number, { remaining: number; since: number; handle: number | null }>());
  const politeRef = useRef<HTMLDivElement>(null);
  const assertiveRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const prevTops = useRef(new Map<number, number>());

  const commit = useCallback((next: ToastItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const announce = useCallback((t: ToastItem) => {
    const el = t.kind === 'error' ? assertiveRef.current : politeRef.current;
    if (!el) return;
    const text = spokenOf(t.title, t.detail, t.count);
    el.textContent = text;
    // Clear once the announcement has had its beat, so the same words can be
    // announced again later. Only clear text that is still this message.
    window.setTimeout(() => {
      if (el.textContent === text) el.textContent = '';
    }, 1000);
  }, []);

  const dismiss = useCallback(
    (id: number) => {
      const rec = timers.current.get(id);
      if (rec?.handle != null) window.clearTimeout(rec.handle);
      timers.current.delete(id);
      commit(itemsRef.current.map((x) => (x.id === id && !x.leaving ? { ...x, leaving: true } : x)));
      // Outlives the exit animation, then the node goes.
      window.setTimeout(() => commit(itemsRef.current.filter((x) => x.id !== id)), EXIT_MS + 40);
    },
    [commit],
  );

  /** Arm or re-arm a toast's clock for `ms` milliseconds. Infinity never arms. */
  const arm = useCallback(
    (id: number, ms: number) => {
      if (!Number.isFinite(ms)) return;
      const rec = timers.current.get(id) ?? { remaining: ms, since: 0, handle: null };
      if (rec.handle != null) window.clearTimeout(rec.handle);
      rec.remaining = ms;
      rec.since = Date.now();
      rec.handle = window.setTimeout(() => dismiss(id), ms);
      timers.current.set(id, rec);
    },
    [dismiss],
  );

  const pause = useCallback((id: number) => {
    const rec = timers.current.get(id);
    if (!rec || rec.handle == null) return;
    window.clearTimeout(rec.handle);
    rec.handle = null;
    rec.remaining = Math.max(0, rec.remaining - (Date.now() - rec.since));
  }, []);

  const resume = useCallback(
    (id: number) => {
      const rec = timers.current.get(id);
      if (!rec || rec.handle != null) return;
      arm(id, rec.remaining);
    },
    [arm],
  );

  // A hidden tab holds every clock: what fires unseen would only have to be
  // missed. Visibility is one listener for the whole stack.
  useEffect(() => {
    const onVis = () => {
      const ids = [...timers.current.keys()];
      if (document.hidden) ids.forEach(pause);
      else ids.forEach(resume);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [pause, resume]);

  /*
   * The settle. The stack is anchored to the screen's corner, so a card
   * arriving or leaving shifts every card above it; an unanimated shift of
   * forty pixels reads as a jolt, not as one card leaving. After each commit
   * the survivors are measured against where they were, put back there with a
   * transform, and eased into their new places — the layout jump becomes a
   * slide. The card that is actually leaving runs its own exit and is skipped
   * here, as is a card with no previous position (it rises in on its own).
   * jsdom has no layout, so under test every delta is zero and this is inert.
   */
  useLayoutEffect(() => {
    const stack = stackRef.current;
    if (!stack) return;
    const next = new Map<number, number>();
    const animate = !reducedMotion();
    for (const el of stack.querySelectorAll<HTMLElement>('[data-toast-id]')) {
      const id = Number(el.dataset.toastId);
      const top = el.getBoundingClientRect().top;
      next.set(id, top);
      const prev = prevTops.current.get(id);
      if (!animate || prev === undefined || el.hasAttribute('data-leaving')) continue;
      const dy = prev - top;
      if (!dy) continue;
      el.style.transition = 'none';
      el.style.transform = `translateY(${dy}px)`;
      el.getBoundingClientRect();
      el.style.transition = 'transform 160ms cubic-bezier(.2, .7, .3, 1)';
      el.style.transform = '';
    }
    prevTops.current = next;
  }, [items]);

  const push = useCallback(
    (t: ToastInput) => {
      const live = itemsRef.current.filter((x) => !x.leaving);
      /*
       * The same event twice in view is one card saying so twice, never two
       * cards. Only actionless toasts merge: an action belongs to the event
       * that made it, and merging two Undos would silently keep one shot
       * archived. Identical errors merge; distinct ones never do.
       */
      const dupe = !hasActions(t)
        ? live.find((x) => x.kind === t.kind && x.title === t.title && x.detail === t.detail && !hasActions(x))
        : undefined;
      if (dupe) {
        const bumped = { ...dupe, count: dupe.count + 1 };
        commit(itemsRef.current.map((x) => (x.id === dupe.id ? bumped : x)));
        arm(dupe.id, durationFor(bumped));
        if (!bumped.quiet) announce(bumped);
        return;
      }
      const item: ToastItem = { ...t, id: nextId.current++, count: 1 };
      const next = [...itemsRef.current, item];
      /*
       * Over the cap something has to go, and it must not be a failure.
       * Trimming the oldest regardless meant ordinary successes could
       * silently destroy an unread error — and, worse, take an Undo with it,
       * so the way back from an accident vanished because other things
       * happened afterwards. Successes are the ones that expire on their own.
       */
      while (next.filter((x) => !x.leaving).length > TOAST_MAX) {
        const victim = next.findIndex((x) => !x.leaving && x.kind !== 'error' && !hasActions(x));
        const gone = next.splice(victim === -1 ? 0 : victim, 1)[0];
        const rec = timers.current.get(gone.id);
        if (rec?.handle != null) window.clearTimeout(rec.handle);
        timers.current.delete(gone.id);
      }
      commit(next);
      arm(item.id, durationFor(item));
      if (!item.quiet) announce(item);
    },
    [announce, arm, commit],
  );

  const value = useMemo(() => ({ push }), [push]);

  // A handle for driving the stack from the console (VQA) and from the
  // browser suite (stack cap, dedup). Dev always has it; a build only
  // when a spec asked, via localStorage. Never otherwise.
  useEffect(() => {
    const asked =
      (import.meta as { env?: { DEV?: boolean } }).env?.DEV ||
      (typeof localStorage !== 'undefined' && localStorage.getItem('scenri:toast-probe'));
    if (!asked) return;
    (window as unknown as { __scenriToast?: typeof push }).__scenriToast = push;
    return () => {
      delete (window as unknown as { __scenriToast?: typeof push }).__scenriToast;
    };
  }, [push]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {/*
       * Announcements travel through these two regions, not through the
       * visible stack: a live region must exist before its content does, and
       * a card that enters with an animation and leaves 140ms later would be
       * announced twice or not at all. Polite carries info, success and
       * warning; assertive is reserved for errors, the only kind worth
       * interrupting for. The visible stack is an ordinary labelled region,
       * so a keyboard or screen-reader user can still find an action after
       * hearing the words.
       */}
      <div ref={politeRef} className="sc-vh" role="status" aria-live="polite" />
      <div ref={assertiveRef} className="sc-vh" role="alert" aria-live="assertive" />
      <section className="sc-toasts" aria-label="Alerts" ref={stackRef}>
        {items.map((t) => {
          const acts = actionsOf(t);
          return (
            <div key={t.id} className="sc-toast-wrap" data-toast-id={t.id} data-leaving={t.leaving || undefined}>
              <article
                className="sc-toast"
                data-kind={t.kind}
                onPointerEnter={() => pause(t.id)}
                onPointerLeave={() => resume(t.id)}
                onFocus={() => pause(t.id)}
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) resume(t.id);
                }}
              >
                <ToastMark kind={t.kind} />
                <div className="sc-toast-body">
                  <div className="sc-toast-top">
                    <div className="sc-toast-txt">
                      <b>
                        {t.title}
                        {t.count > 1 ? <span className="sc-toast-n">×{t.count}</span> : null}
                      </b>
                      {t.detail ? <small>{t.detail.slice(0, 160)}</small> : null}
                    </div>
                    <button type="button" className="sc-toast-x" onClick={() => dismiss(t.id)} aria-label="Dismiss">
                      <X size={14} weight="regular" />
                    </button>
                  </div>
                  {acts.length ? (
                    <div className="sc-toast-acts">
                      {acts.map((a) => (
                        <button
                          key={a.label}
                          type="button"
                          className="sc-toast-act"
                          onClick={() => {
                            a.onClick();
                            dismiss(t.id);
                          }}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </article>
            </div>
          );
        })}
      </section>
    </Ctx.Provider>
  );
}
