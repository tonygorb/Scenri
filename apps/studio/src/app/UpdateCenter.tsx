import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowCircleUp, Gift, Power } from '@phosphor-icons/react';
import { useLocation } from 'react-router';
import { api, type UpdateStatus } from '../api.js';
import { P } from '../routes.js';
import { session } from '../storage.js';
import { useOpenSettings } from './dialogs.js';
import { floatState, floatVisible } from './updateRules.js';

/**
 * The machine-scoped update awareness, mounted once in AppShell — deliberately
 * above the brand tree. The notification feed would have been the obvious
 * channel, but it is keyed per brand and resets on brand switch; an app update
 * is about this machine, not about whichever brand happens to be open.
 *
 * The real check cadence lives on the server (one registry GET every six
 * hours, cached in the settings table). This poll only reads that cache over
 * the local socket, so its interval is about how soon an already-made
 * discovery reaches the chrome, not about traffic; focus and visibility
 * changes still refresh immediately.
 */
const POLL_MS = 30 * 60 * 1000;

/** How long a download may run before the UI stops waiting and says try again. */
const STAGE_DEADLINE_MS = 5 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Which latest-version the user has waved away, for this session only.
 *
 * sessionStorage rather than localStorage on purpose. "Not now" used to be
 * forever: one stray click and that version was never mentioned again, which
 * for a security-relevant update is the wrong kind of quiet. Session-scoped, it
 * holds for as long as the person is working and asks again next launch — and
 * it ends permanently the moment they actually update, because `available`
 * goes false and there is nothing left to say.
 *
 * It survives the post-update `location.reload()`, which is harmless for the
 * same reason.
 */
const DISMISS_KEY = 'scenri:update-dismissed';

const readDismissed = (): string | null => session.get(DISMISS_KEY);
const writeDismissed = (version: string): void => session.set(DISMISS_KEY, version);

interface UpdateCenterValue {
  status: UpdateStatus | null;
  /** True while a user-asked re-check is in flight (the background poll never sets it). */
  checking: boolean;
  /** Settings → About's "Check for updates": forces past the day cache. */
  checkNow(): Promise<void>;
  /** The manual check could not reach the server at all; registry trouble arrives via status.error instead. */
  checkError: string | null;
  /** Dismissed per version, for this session; next launch asks again. */
  dismissed: boolean;
  dismiss(): void;
  /** The one click: download + verify, then restart into the new version. */
  apply(): Promise<void>;
  /** The brand menu's Shut down: drain and stop; the overlay says how to come back. Resolves to the server's refusal, or null. */
  quit(): Promise<string | null>;
  busy: 'idle' | 'applying' | 'restarting' | 'stopped';
  applyError: string | null;
}

const Ctx = createContext<UpdateCenterValue | null>(null);

export function useUpdateCenter(): UpdateCenterValue {
  const value = useContext(Ctx);
  if (!value) throw new Error('useUpdateCenter must be used inside UpdateCenterProvider');
  return value;
}

export function UpdateCenterProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(readDismissed);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      // hidden tabs skip the request but keep the clock running (TaskCenter's rule)
      if (!document.hidden) {
        try {
          const s = await api.updateStatus();
          if (alive) setStatus(s);
        } catch {
          /* server briefly away (e.g. restarting) — next tick will catch up */
        }
      }
      if (alive) timer.current = window.setTimeout(tick, POLL_MS);
    };
    void tick();
    const wake = () => {
      if (document.hidden || !alive) return;
      window.clearTimeout(timer.current);
      void tick();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    return () => {
      alive = false;
      window.clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    };
  }, []);

  const [checkError, setCheckError] = useState<string | null>(null);
  const checkNow = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await api.updateCheck());
      setCheckError(null);
    } catch (err) {
      // The button must answer. A dead route or a dropped connection becomes
      // copy, never an unhandled rejection with an unchanged screen.
      setCheckError(String((err as Error)?.message ?? err));
    } finally {
      setChecking(false);
    }
  }, []);

  const dismiss = useCallback(() => {
    const v = status?.latest;
    if (!v) return;
    writeDismissed(v);
    setDismissedVersion(v);
  }, [status]);

  const dismissed = status?.latest != null && status.latest === dismissedVersion;

  const [busy, setBusy] = useState<'idle' | 'applying' | 'restarting' | 'stopped'>('idle');
  const [applyError, setApplyError] = useState<string | null>(null);

  const restart = useCallback(async (oldVersion: string | undefined) => {
    setBusy('restarting');
    try {
      await api.updateRestart();
    } catch (err) {
      if (typeof (err as { status?: number }).status === 'number') {
        // The server is alive and refused (work still running, nothing
        // staged). That is an answer, not a restart: say it now instead of
        // holding a thirty second overlay over a healthy app.
        setBusy('idle');
        setApplyError(String((err as Error)?.message ?? err));
        return;
      }
      /* no HTTP status: the socket died mid-reply, which is the restart happening */
    }
    // the launcher is swapping processes under us: poll until a different
    // version answers, then reload into it
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      await sleep(800);
      try {
        const v = await api.version();
        if (v.version !== oldVersion) {
          location.reload();
          return;
        }
      } catch {
        /* between processes */
      }
    }
    setBusy('idle');
    setApplyError('The restart did not complete. Check the terminal Scenri runs in.');
  }, []);

  const quit = useCallback(async () => {
    if (busy !== 'idle') return null;
    try {
      await api.quit();
    } catch (err) {
      if (typeof (err as { status?: number }).status === 'number') {
        // alive and refusing (work still running): an answer, not a stop
        return String((err as Error)?.message ?? err);
      }
      /* the socket died mid-reply: that is the stop */
    }
    setBusy('stopped');
    return null;
  }, [busy]);

  const apply = useCallback(async () => {
    if (busy !== 'idle') return;
    setApplyError(null);
    const oldVersion = status?.current;
    try {
      if (status?.phase !== 'ready') {
        setBusy('applying');
        await api.updateApply();
        const deadline = Date.now() + STAGE_DEADLINE_MS;
        let staged = false;
        while (Date.now() < deadline) {
          await sleep(1500);
          const s = await api.updateStatus();
          setStatus(s);
          if (s.phase === 'ready') {
            staged = true;
            break;
          }
          if (s.phase === 'error') {
            setApplyError(s.error ?? 'The update could not be staged.');
            setBusy('idle');
            return;
          }
        }
        if (!staged) {
          // The 6h status poll can still discover a very late 'ready'.
          setApplyError("Couldn't download the update. Try again.");
          setBusy('idle');
          return;
        }
      }
      await restart(oldVersion);
    } catch (err) {
      setApplyError(String((err as Error)?.message ?? err));
      setBusy('idle');
    }
  }, [busy, status, restart]);

  // Auto-staging starts on the server without a click. While the status says
  // staging, follow it closely so "Downloading update" becomes "ready" in
  // seconds rather than at the next six-hour poll. The apply() loop above
  // covers the clicked path; this one only runs while nothing else is busy.
  const following = useRef(false);
  useEffect(() => {
    if (status?.phase !== 'staging' || busy !== 'idle' || following.current) return;
    following.current = true;
    let alive = true;
    const deadline = Date.now() + STAGE_DEADLINE_MS;
    const follow = async () => {
      while (alive && Date.now() < deadline) {
        await sleep(1500);
        if (!alive) return;
        try {
          const s = await api.updateStatus();
          if (!alive) return;
          setStatus(s);
          if (s.phase !== 'staging') return;
        } catch {
          /* server briefly away; keep trying until the deadline */
        }
      }
    };
    void follow().finally(() => {
      following.current = false;
    });
    return () => {
      alive = false;
    };
  }, [status?.phase, busy]);

  const { pathname } = useLocation();
  // First-run setup has no settings dialog mounted, so the float's fallback
  // action (open About) would only write a dead URL param there.
  const onSetup = pathname === P.setup;

  return (
    <Ctx.Provider value={{ status, checking, checkNow, checkError, dismissed, dismiss, apply, quit, busy, applyError }}>
      {children}
      {busy !== 'restarting' && busy !== 'stopped' && floatVisible(status) && !dismissed && !onSetup && <UpdateFloat />}
      {busy === 'restarting' && <RestartOverlay version={status?.stagedVersion ?? status?.latest ?? null} />}
      {busy === 'stopped' && <StoppedOverlay />}
    </Ctx.Provider>
  );
}

/**
 * The moment between versions. The server answered the restart request and
 * went away on purpose; this holds the room until the new one answers, then
 * reloads. Drafts and prefs live in localStorage per brand, so the work on
 * screen survives the reload.
 */
function RestartOverlay({ version }: { version: string | null }) {
  return (
    <LifecycleOverlay>
      <ArrowCircleUp size={22} />
      <b>{version ? `Updating to Scenri ${version}` : 'Updating Scenri'}</b>
      <small>Restarting. This page reconnects by itself.</small>
    </LifecycleOverlay>
  );
}

/**
 * Full-bleed over everything, dialogs included. The app tree sits inside the
 * Radix theme root, which is a stacking context of its own, so an overlay
 * rendered in place lost to a Settings dialog portaled to body whatever its
 * z-index said. Portal it to body too: the token then means what it says.
 */
function LifecycleOverlay({ children, className }: { children: ReactNode; className?: string }) {
  return createPortal(
    <div className={className ? `sc-upd-overlay ${className}` : 'sc-upd-overlay'} role="status" aria-live="polite">
      <div className="sc-upd-overlay-card">{children}</div>
    </div>,
    document.body,
  );
}

/**
 * After Shut down. The server answered and went away on purpose; nothing here
 * reconnects, because nothing is coming back until the person starts Scenri
 * again. The two ways to do that are the whole message.
 */
function StoppedOverlay() {
  return (
    <LifecycleOverlay className="sc-upd-stopped">
      <Power size={22} />
      <b>Scenri has shut down</b>
      <small>Double-click Scenri on your desktop, or run npx scenri in a terminal, to start it again.</small>
    </LifecycleOverlay>
  );
}

/**
 * The announcement, floating in the quiet corner — bottom-left, every screen
 * (the composer owns bottom-center, the work owns the canvas). One sentence,
 * one link, one button: Not now holds for this version, Update does the work.
 * Release notes live in Settings → About, where reading has room. Never a
 * modal, never a toast (auto-dismiss loses the one action that matters),
 * never a container stripe: the gold dot is the whole accent.
 */
function UpdateFloat() {
  const { status, dismiss, apply, busy, applyError } = useUpdateCenter();
  const openSettings = useOpenSettings();
  if (!status) return null;
  const st = floatState(status);

  const line =
    st.kind === 'downloading'
      ? 'Downloading update…'
      : st.kind === 'ready'
        ? `Scenri ${st.version} is ready`
        : st.kind === 'stage-error'
          ? "Couldn't download the update"
          : 'A new update is available';
  // One verb everywhere: the button says Update whatever step remains; the
  // line above it and the overlay carry the mechanics (downloaded, restarting).
  const action = busy === 'applying' ? 'Updating…' : st.kind === 'stage-error' ? 'Try again' : 'Update';
  // One click does the whole remaining job whenever the machine can; the only
  // fallback left is pointing at About, where the manual command lives.
  const oneClick = st.kind !== 'announce' || st.oneClick;

  return (
    <div className="sc-upd-float" role="status">
      <Gift className="sc-upd-float-dot" size={16} weight="fill" aria-hidden="true" />
      <span className="sc-upd-float-txt">
        {line}
        {applyError && st.kind !== 'downloading' && <small>{applyError}</small>}
      </span>
      <button type="button" className="sc-upd-float-later" onClick={dismiss}>
        {st.kind === 'ready' ? 'Later' : 'Not now'}
      </button>
      {st.kind !== 'downloading' && (
        <button
          type="button"
          className="sc-btn sc-btn-primary"
          disabled={busy !== 'idle'}
          onClick={() => (oneClick ? void apply() : openSettings('about'))}
        >
          {action}
        </button>
      )}
    </div>
  );
}
