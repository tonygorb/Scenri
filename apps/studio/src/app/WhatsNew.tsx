import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { api, type ReleaseEntry } from '../api.js';
import { useDialogParam } from './AppShell.js';
import { useTaskCenter } from './TaskCenter.js';
import { useBrand } from './BrandLayout.js';
import { canAutoOpen } from './whatsNewRules.js';

/**
 * What's new — deliberately not the update system.
 *
 * UpdateCenter answers "there is a newer scenri" and asks you to act. This
 * answers "here is what changed in the one you now have" and asks for nothing.
 * They meet in exactly one place: an update finishes, the new version boots,
 * and this introduces it.
 *
 * The data ships inside the build, so this is one local read at startup and
 * then silence — no polling, no registry, no GitHub. Machine-scoped like
 * UpdateCenter, and for the same reason: a version is about this install, not
 * about whichever brand happens to be open.
 */

/** Long enough that it never lands on top of a first paint or a route change. */
const SETTLE_MS = 2500;

interface WhatsNewValue {
  /**
   * Where the one read got to. Three states rather than two, because "we have
   * not asked yet", "there is nothing written for this version" and "the read
   * failed" are three different sentences, and showing the middle one for the
   * other two is how a stale server ends up accusing a release of having no
   * notes.
   */
  status: 'loading' | 'ready' | 'failed';
  /** The running version, once the server has said. */
  version: string | null;
  entry: ReleaseEntry | null;
  changelogUrl: string | null;
  /** The releases index, for the one link out of the dialog. */
  releasesUrl: string | null;
  /** This version's notes have not been acknowledged on this machine. */
  unread: boolean;
  /** Open it deliberately — the menu row, the About row. Always available. */
  open(): void;
  /** Auto-open has already had its one chance this session. */
  autoOpenSpent: boolean;
  autoOpen(): void;
  /** Any close is an acknowledgement: it never comes back for this version. */
  markSeen(): void;
}

const Ctx = createContext<WhatsNewValue | null>(null);

export function useWhatsNew(): WhatsNewValue {
  const value = useContext(Ctx);
  if (!value) throw new Error('useWhatsNew must be used inside WhatsNewProvider');
  return value;
}

export function WhatsNewProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState<string | null>(null);
  const [entry, setEntry] = useState<ReleaseEntry | null>(null);
  const [changelogUrl, setChangelogUrl] = useState<string | null>(null);
  const [releasesUrl, setReleasesUrl] = useState<string | null>(null);
  const [seen, setSeen] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [autoOpenSpent, setAutoOpenSpent] = useState(false);
  const dialog = useDialogParam('whatsnew');

  useEffect(() => {
    let alive = true;
    void api
      .releaseNotes()
      .then((r) => {
        if (!alive) return;
        setVersion(r.version);
        setEntry(r.entry);
        setChangelogUrl(r.changelogUrl);
        setReleasesUrl(r.releasesUrl ?? null);
        setSeen(r.seen);
        setStatus('ready');
      })
      .catch(() => {
        // The one read this feature makes. Nothing auto-opens after a failure
        // — `unread` needs a version — but the menu row still works, and the
        // dialog says what actually happened instead of blaming the release.
        if (alive) setStatus('failed');
      });
    return () => {
      alive = false;
    };
  }, []);

  const openDialog = dialog.open;
  const open = useCallback(() => openDialog(version ?? 'latest'), [openDialog, version]);

  const autoOpen = useCallback(() => {
    setAutoOpenSpent(true);
    open();
  }, [open]);

  const markSeen = useCallback(() => {
    if (!version || seen === version) return;
    setSeen(version); // optimistic: the dot must go the moment the dialog does
    void api.releaseSeen(version).catch(() => {
      /* a failed write means it introduces itself once more; harmless */
    });
  }, [version, seen]);

  /**
   * A version the user has not acknowledged AND that actually has something to
   * say. A maintenance release still gets a record (so nothing ships
   * undescribed) but its record carries no sections, and an empty dialog is
   * worse than no dialog. `seen` is deliberately left alone for those: when a
   * later release does have news, this turns true on its own.
   */
  const unread = version !== null && seen !== version && entry !== null && entry.sections.length > 0;

  return (
    <Ctx.Provider
      value={{
        status,
        version,
        entry,
        changelogUrl,
        releasesUrl,
        unread,
        open,
        autoOpenSpent,
        autoOpen,
        markSeen,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

/**
 * When it is safe to say something.
 *
 * Mounted inside TaskCenter and the brand, because that is where the signals
 * are: a generation in flight, an asset being built, another dialog already
 * open, a tab in the background, a brand still loading. All of them mean the
 * user is mid-something, and a modal over mid-something is the whole reason
 * people hate this pattern.
 *
 * If a safe moment never arrives, nothing pops — the unread dot in the brand
 * menu carries it instead. Discoverable, never in the way.
 */
export function WhatsNewGate() {
  const wn = useWhatsNew();
  const { running, builds } = useTaskCenter();
  const { loaded } = useBrand();
  const [params] = useSearchParams();
  const [visible, setVisible] = useState(() => !document.hidden);
  const spent = useRef(false);

  useEffect(() => {
    const onVis = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Any other dialog owning the screen — Settings, provider setup, a creation
  // flow — is work in progress with a URL of its own.
  const dialogOpen = params.has('settings') || params.has('setup') || params.has('new') || params.has('whatsnew');

  useEffect(() => {
    const ok = canAutoOpen({
      unread: wn.unread,
      spent: spent.current || wn.autoOpenSpent,
      loaded,
      visible,
      dialogOpen,
      running,
      builds: builds.length,
    });
    if (!ok) return;
    const t = window.setTimeout(() => {
      spent.current = true;
      wn.autoOpen();
    }, SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [wn, loaded, visible, dialogOpen, running, builds.length]);

  return null;
}
