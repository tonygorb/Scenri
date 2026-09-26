import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, useMemo } from 'react';
import { useMatch, useSearchParams } from 'react-router';
import { api, type ReleaseEntry, type ReleaseNotesResponse } from '../api.js';
import { P } from '../routes.js';
import { useDialogParam } from './AppShell.js';
import { useTaskCenter } from './TaskCenter.js';
import { useBrand } from './BrandLayout.js';
import { canAutoOpen } from './whatsNewRules.js';
import { ADDRESS_DIALOGS } from './dialogs.js';
import { useGuide } from '../guide.js';
import { useGuideShowing } from '../guideFacts.js';

/**
 * What's new — deliberately not the update system.
 *
 * UpdateCenter answers "there is a newer Scenri" and asks you to act. This
 * answers "here is what changed in the one you now have" and asks for nothing.
 * They meet in exactly one place: an update finishes, the new version boots,
 * and this introduces it.
 *
 * The data ships inside the build, so this is one local read at startup and
 * then silence — no polling, no registry, no GitHub. Machine-scoped like
 * UpdateCenter, and for the same reason: a version is about this install, not
 * about whichever brand happens to be open.
 */

/**
 * Long enough that it never lands on top of a first paint or a route change.
 * The e2e suite shortens it through localStorage before boot: several of its
 * assertions are "nothing appears", and each one has to out-wait this delay.
 */
const SETTLE_MS = Number(window.localStorage.getItem('scenri:whatsnew-settle-ms') ?? 2500) || 2500;

interface WhatsNewValue {
  /**
   * Where the one read got to. Three states rather than two, because "we have
   * not asked yet", "there is nothing to show" and "the read failed" are three
   * different sentences, and showing the middle one for the other two is how a
   * stale server ends up accusing a release of having no notes.
   */
  status: 'loading' | 'ready' | 'failed';
  /** The in-app history, newest first: down to the fifth headline update. */
  recent: ReleaseEntry[];
  /** The newest headline update in that history: what the dialog shows. */
  featured: ReleaseEntry | null;
  /** Versions in `recent` this machine has not read yet. */
  unseen: string[];
  /** An unread headline update: the one thing allowed to open by itself. */
  lead: ReleaseEntry | null;
  /** The releases index, for Full release notes. */
  releasesUrl: string | null;
  /** Anything in the history is unread: the mark on Help. Small updates count. */
  unread: boolean;
  /** Auto-open has already had its one chance this session. */
  autoOpenSpent: boolean;
  autoOpen(): void;
  /**
   * Everything up to the running version counts as read: closing the dialog,
   * opening the page, or finishing first use. It never comes back until a
   * newer version does.
   */
  markSeen(): void;
}

const Ctx = createContext<WhatsNewValue | null>(null);

export function useWhatsNew(): WhatsNewValue {
  const value = useContext(Ctx);
  if (!value) throw new Error('useWhatsNew must be used inside WhatsNewProvider');
  return value;
}

export function WhatsNewProvider({ children }: { children: ReactNode }) {
  const [notes, setNotes] = useState<ReleaseNotesResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [autoOpenSpent, setAutoOpenSpent] = useState(false);
  const dialog = useDialogParam('whatsnew');

  useEffect(() => {
    let alive = true;
    void api
      .releaseNotes()
      .then((r) => {
        if (!alive) return;
        // A server older than the history answers without it. That is a stale
        // server, not an empty history, so it reads as a failed read (whose
        // sentence says to restart it) rather than as "nothing new".
        if (!Array.isArray(r.recent)) {
          setStatus('failed');
          return;
        }
        setNotes({ ...r, releasesUrl: r.releasesUrl ?? null, unseen: r.unseen ?? [], lead: r.lead ?? null });
        setStatus('ready');
      })
      .catch(() => {
        // The one read this feature makes. Nothing opens after a failure, and
        // the page says what actually happened instead of blaming the release.
        if (alive) setStatus('failed');
      });
    return () => {
      alive = false;
    };
  }, []);

  const recent = notes?.recent ?? EMPTY;
  const featured = useMemo(() => recent.find((r) => r.title) ?? null, [recent]);
  const lead = useMemo(() => recent.find((r) => r.version === notes?.lead) ?? null, [recent, notes?.lead]);

  const openDialog = dialog.open;
  const leadVersion = lead?.version ?? null;
  const autoOpen = useCallback(() => {
    setAutoOpenSpent(true);
    if (leadVersion) openDialog(leadVersion);
  }, [openDialog, leadVersion]);

  // What this tab has already acknowledged. Two closes can land in one commit
  // (the dialog's link closes it and mounts the page, and both read), each
  // holding the same `notes`; the second must not post again.
  const acked = useRef<string | null>(null);
  const markSeen = useCallback(() => {
    // Only when there is something to acknowledge: `unseen` cannot fill again
    // until the running version changes, so an empty one needs no write.
    if (!notes || notes.unseen.length === 0 || acked.current === notes.version) return;
    acked.current = notes.version;
    // optimistic: the mark must go the moment the dialog does, or the page opens
    setNotes({ ...notes, seen: notes.version, unseen: [], lead: null });
    void api.releaseSeen(notes.version).catch(() => {
      /* a failed write means it introduces itself once more; harmless */
    });
  }, [notes]);

  const value = useMemo(
    () => ({
      status,
      recent,
      featured,
      unseen: notes?.unseen ?? EMPTY_VERSIONS,
      lead,
      releasesUrl: notes?.releasesUrl ?? null,
      unread: (notes?.unseen.length ?? 0) > 0,
      autoOpenSpent,
      autoOpen,
      markSeen,
    }),
    [status, notes, recent, featured, lead, autoOpenSpent, autoOpen, markSeen],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const EMPTY: ReleaseEntry[] = [];
const EMPTY_VERSIONS: string[] = [];

/**
 * When it is safe to say something.
 *
 * Mounted inside TaskCenter and the brand, because that is where the signals
 * are: a generation in flight, an asset being built, another dialog already
 * open, a tab in the background, a brand still loading, the What's New page
 * already on screen. All of them mean the user is mid-something (or already
 * reading), and a modal over that is the whole reason people hate this pattern.
 *
 * If a safe moment never arrives, nothing pops: the unread mark on Help carries
 * it instead. Discoverable, never in the way.
 */
export function WhatsNewGate() {
  const wn = useWhatsNew();
  const { running, builds } = useTaskCenter();
  const { loaded } = useBrand();
  const [params] = useSearchParams();
  const onPage = !!useMatch(P.whatsNew);
  const [visible, setVisible] = useState(() => !document.hidden);
  const spent = useRef(false);
  const guide = useGuide();
  const showing = useGuideShowing();

  // Someone new has not answered the welcome yet: every note describes the
  // version they are meeting for the first time. Anyone else is only held back
  // by what the guide has on screen, or by the first shot still in hand.
  const learning = guide.eligible && guide.welcome === null;
  const teaching = learning || showing || (guide.active?.task === 'first-shot' && !guide.active.paused);
  const firstUse = !guide.loaded || teaching;

  // A session that introduced Scenri never ends in a modal: the notes would
  // land on the first shot as it finishes. The unread mark still carries them.
  if (teaching) spent.current = true;

  // First use ended here, on this version: its notes are already known.
  const wasLearning = useRef(false);
  const { markSeen } = wn;
  useEffect(() => {
    if (learning) wasLearning.current = true;
    else if (wasLearning.current) {
      wasLearning.current = false;
      markSeen();
    }
  }, [learning, markSeen]);

  useEffect(() => {
    const onVis = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Any dialog that owns the screen (Settings, provider setup, a creation flow,
  // Learn, the welcome) is work in progress with a URL of its own.
  const dialogOpen = ADDRESS_DIALOGS.some((k) => params.has(k));

  useEffect(() => {
    const ok = canAutoOpen({
      lead: wn.lead !== null,
      spent: spent.current || wn.autoOpenSpent,
      loaded,
      visible,
      dialogOpen,
      running,
      builds,
      firstUse,
      onPage,
    });
    if (!ok) return;
    const t = window.setTimeout(() => {
      spent.current = true;
      wn.autoOpen();
    }, SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [wn, loaded, visible, dialogOpen, running, builds, firstUse, onPage]);

  return null;
}
