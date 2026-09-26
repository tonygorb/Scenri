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
 *
 * The same read also names the few features saying New on this install
 * (DESIGN.md, "New"). They go one at a time, when each is used where it lives,
 * and reading What's New takes none of them away: reading about a feature is
 * not finding it.
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
  /** Every public release with something to say, newest first: the page's history. */
  history: ReleaseEntry[];
  /**
   * The newest update in that history, headline or small: what the dialog shows
   * and what the page leads with, so the two never name different versions.
   */
  featured: ReleaseEntry | null;
  /** The version this computer runs; null on an unreleased (0.0.0) build. */
  running: string | null;
  /** Versions in `recent` this machine has not read yet. */
  unseen: string[];
  /** An unread headline update: the one thing allowed to open by itself. */
  lead: ReleaseEntry | null;
  /** The releases index, for Full release notes. */
  releasesUrl: string | null;
  /** One version's own release page, or null where nothing was ever published. */
  notesFor(version: string): string | null;
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
  /** Whether a feature says New on this install (`layout/NewBadge.tsx`). */
  isNew(feature: string): boolean;
  /**
   * The feature was used where it lives: its page opened, its action ran, its
   * way to make something was taken. Its New goes and does not come back. A
   * feature not saying New is left alone, so a page can say this on every open.
   */
  markUsed(feature: string): void;
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
  const [newFeatures, setNewFeatures] = useState<string[]>([]);
  const dialog = useDialogParam('whatsnew');

  useEffect(() => {
    let alive = true;
    void api
      .releaseNotes()
      .then((r) => {
        if (!alive) return;
        // New belongs to the install, not to the history: it reads whatever
        // the history turns out to be.
        setNewFeatures(r.newFeatures ?? []);
        // A server older than the history answers without it. That is a stale
        // server, not an empty history, so it reads as a failed read (whose
        // sentence says to restart it) rather than as "nothing new".
        if (!Array.isArray(r.recent)) {
          setStatus('failed');
          return;
        }
        setNotes({
          ...r,
          releasesUrl: r.releasesUrl ?? null,
          history: r.history ?? r.recent,
          unseen: r.unseen ?? [],
          lead: r.lead ?? null,
        });
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
  const featured = recent[0] ?? null;
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

  const releasesUrl = notes?.releasesUrl ?? null;
  const notesFor = useCallback(
    (version: string) => (releasesUrl ? `${releasesUrl}/tag/v${version}` : null),
    [releasesUrl],
  );

  const isNew = useCallback((feature: string) => newFeatures.includes(feature), [newFeatures]);

  // Keyed on the list, so a page opened by a link before the read lands still
  // counts once it does. It returns before touching state for anything not
  // saying New, which is what lets a page mark itself on every open without a
  // render loop, and write nothing once it has been used.
  const markUsed = useCallback(
    (feature: string) => {
      if (!newFeatures.includes(feature)) return;
      setNewFeatures((list) => list.filter((f) => f !== feature)); // optimistic, as markSeen is
      void api.releaseUsed(feature).catch(() => {
        /* a failed write says New once more at next launch; harmless */
      });
    },
    [newFeatures],
  );

  const value = useMemo(
    () => ({
      status,
      recent,
      history: notes?.history ?? EMPTY,
      featured,
      running: notes && notes.version !== '0.0.0' ? notes.version : null,
      unseen: notes?.unseen ?? EMPTY_VERSIONS,
      lead,
      releasesUrl,
      notesFor,
      unread: (notes?.unseen.length ?? 0) > 0,
      autoOpenSpent,
      autoOpen,
      markSeen,
      isNew,
      markUsed,
    }),
    [status, notes, recent, featured, lead, releasesUrl, notesFor, autoOpenSpent, autoOpen, markSeen, isNew, markUsed],
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
