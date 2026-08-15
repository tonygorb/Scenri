import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowCircleUp, X } from '@phosphor-icons/react';
import { api, type UpdateStatus } from '../api.js';
import { useOpenSettings } from './dialogs.js';
import { canOneClick } from './updateRules.js';

/**
 * The machine-scoped update awareness, mounted once in AppShell — deliberately
 * above the brand tree. The notification feed would have been the obvious
 * channel, but it is keyed per brand and resets on brand switch; an app update
 * is about this machine, not about whichever brand happens to be open.
 *
 * The real check cadence lives on the server (one registry GET a day, cached
 * in the settings table). This poll only reads that cache, so its interval is
 * about how soon an already-made discovery reaches the chrome, not about
 * traffic.
 */
const POLL_MS = 6 * 60 * 60 * 1000;

/** Machine-scoped: which latest-version the user has already waved away. */
const DISMISS_KEY = 'scenri:update-dismissed';

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

function writeDismissed(version: string): void {
  try {
    localStorage.setItem(DISMISS_KEY, version);
  } catch {
    /* private mode */
  }
}

interface UpdateCenterValue {
  status: UpdateStatus | null;
  /** True while a user-asked re-check is in flight (the background poll never sets it). */
  checking: boolean;
  /** Settings → About's "Check for updates": forces past the day cache. */
  checkNow(): Promise<void>;
  /** The Home banner is dismissed per version; the next release brings it back. */
  dismissed: boolean;
  dismiss(): void;
  /** The one click: download + verify, then restart into the new version. */
  apply(): Promise<void>;
  busy: 'idle' | 'applying' | 'restarting';
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

  const checkNow = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await api.updateCheck());
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

  const [busy, setBusy] = useState<'idle' | 'applying' | 'restarting'>('idle');
  const [applyError, setApplyError] = useState<string | null>(null);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const restart = useCallback(async (oldVersion: string | undefined) => {
    setBusy('restarting');
    try {
      await api.updateRestart();
    } catch {
      /* the socket may die mid-reply; the polls below are the real answer */
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
    setApplyError('The restart did not complete — check the terminal scenri runs in.');
  }, []);

  const apply = useCallback(async () => {
    if (busy !== 'idle') return;
    setApplyError(null);
    const oldVersion = status?.current;
    try {
      if (status?.phase !== 'ready') {
        setBusy('applying');
        await api.updateApply();
        for (;;) {
          await sleep(1500);
          const s = await api.updateStatus();
          setStatus(s);
          if (s.phase === 'ready') break;
          if (s.phase === 'error') {
            setApplyError(s.error ?? 'The update could not be staged.');
            setBusy('idle');
            return;
          }
        }
      }
      await restart(oldVersion);
    } catch (err) {
      setApplyError(String((err as Error)?.message ?? err));
      setBusy('idle');
    }
  }, [busy, status, restart]);

  return (
    <Ctx.Provider value={{ status, checking, checkNow, dismissed, dismiss, apply, busy, applyError }}>
      {children}
      {busy === 'restarting' && <RestartOverlay version={status?.stagedVersion ?? status?.latest ?? null} />}
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
    <div className="sc-upd-overlay" role="status" aria-live="polite">
      <div className="sc-upd-overlay-card">
        <ArrowCircleUp size={22} />
        <b>{version ? `Updating to scenri ${version}` : 'Updating scenri'}</b>
        <small>Restarting — this page reconnects by itself.</small>
      </div>
    </div>
  );
}

/**
 * The quiet announcement on Home: title, one-line summary, What's new · Update.
 * Never a modal, never a toast (auto-dismiss loses the one action that
 * matters). Waving it away holds for this version only.
 */
export function UpdateBanner() {
  const { status, dismissed, dismiss, apply, busy, applyError } = useUpdateCenter();
  const openSettings = useOpenSettings();
  if (!status?.available || dismissed) return null;

  return (
    <div className="sc-banner sc-upd-banner" data-tone="action">
      <span className="sc-banner-ic">
        <ArrowCircleUp size={15} />
      </span>
      <span className="sc-banner-txt">
        <b>scenri {status.latest} is available</b>
        <small>
          {applyError ??
            (status.attention
              ? 'A major update — worth a look at the notes before you install.'
              : `You are on ${status.current}. Your work stays where it is.`)}
        </small>
      </span>
      <button type="button" className="sc-banner-act" onClick={() => openSettings('about')}>
        What's new
      </button>
      <button
        type="button"
        className="sc-banner-act"
        data-primary=""
        disabled={busy !== 'idle'}
        onClick={() => (canOneClick(status) ? void apply() : openSettings('about'))}
      >
        {busy === 'applying' ? 'Updating…' : 'Update'}
      </button>
      <button type="button" className="sc-banner-x" aria-label="Dismiss until the next release" onClick={dismiss}>
        <X size={13} />
      </button>
    </div>
  );
}
