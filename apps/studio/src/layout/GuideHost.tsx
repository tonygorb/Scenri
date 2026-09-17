import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMatch, useSearchParams } from 'react-router';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { useTaskCenter } from '../app/TaskCenter.js';
import type { GuideTaskId, GuideTaskNode } from '../api.js';
import { guideIntent, guideSnapshot, refreshGuide, useGuide } from '../guide.js';
import { setGuideShowing, useGuideFacts } from '../guideFacts.js';
import {
  assetStep,
  canWelcome,
  firstShotStep,
  madeOne,
  mergeTaskNodes,
  presenterStep,
  refineStep,
  startsHere,
  WELCOME,
  welcomeSet,
  type Guidance,
} from '../guidedTasks.js';
import { P } from '../routes.js';
import { useToasts } from '../toasts.js';
import { WelcomeDialog } from '../views/WelcomeDialog.js';
import { Coachmark } from './Coachmark.js';
import { GuideNote } from './GuideNote.js';
import { useLaunchTask } from './useLaunchTask.js';

/** How long a ready page rests before the welcome arrives. e2e sets it to 0. */
const WELCOME_SETTLE_MS = Number(window.localStorage.getItem('scenri:welcome-settle-ms') ?? 900);
/** What owns the screen above the page, so the guide waits under it. Never the picker: the first shot goes through it. */
const MODAL = '[role="dialog"]:not(.sc-coach):not(.sc-attachpanel), [role="alertdialog"], .sc-lightbox';
/** Dialogs that live in the address. */
const DIALOG_PARAMS = ['settings', 'setup', 'new', 'whatsnew'];

/**
 * Where first use happens (DESIGN.md, "First use"): the welcome, once, and
 * whichever guided task is in hand. What it shows is derived every render from
 * what the product holds (the composer's facts, the shots the task has sent,
 * the studio's open question), so leaving, coming back, a reload or a change
 * of mind lands on the right step rather than on a remembered index.
 *
 * With no task in hand and the welcome answered it watches nothing.
 */
export function GuideHost() {
  const guide = useGuide();
  const facts = useGuideFacts();
  const data = useAppData();
  const { brand, recent, subscribeActivity, products, importing } = useBrand();
  const { tasks, builds } = useTaskCenter();
  const { push } = useToasts();
  const launch = useLaunchTask();
  const [params] = useSearchParams();
  const home = !!useMatch(P.brand);
  const hub = !!useMatch(P.hub);
  const shot = useMatch(P.hubShot)?.params.shotId ?? null;
  const studio = !!useMatch(P.presenterStudio);

  const active = guide.active;
  const task: GuideTaskId | null = active && active.brandId === brand.id ? active.task : null;
  const nodeKind = task === 'first-shot' ? 'generation' : task === 'refine' ? 'edit' : null;
  const welcomePending = guide.loaded && guide.eligible && guide.welcome === null;

  // What the task has sent: the server's answer, kept current by the activity
  // stream while a task that sends is in hand.
  const [nodes, setNodes] = useState<GuideTaskNode[]>(guide.activeNodes);
  useEffect(() => setNodes(guide.activeNodes), [guide.activeNodes]);
  useEffect(() => {
    if (!nodeKind || !active) return;
    return subscribeActivity((records) => setNodes((prev) => mergeTaskNodes(prev, records, active.since, nodeKind)));
  }, [nodeKind, active, subscribeActivity]);

  // A send just left the composer: hold still until its shots are in hand, so
  // the emptied brief never reads as starting again.
  const busy = !!facts.composer?.busy;
  const wasBusy = useRef(false);
  const [settling, setSettling] = useState(false);
  useEffect(() => {
    if (wasBusy.current && !busy && nodeKind) {
      setSettling(true);
      void refreshGuide().finally(() => setSettling(false));
    }
    wasBusy.current = busy;
  }, [busy, nodeKind]);

  // One observer, only while something may show: a dialog opening over the
  // page, a tile drawing, the surface a step points at arriving.
  const [, setTick] = useState(0);
  const watching = !!task || welcomePending;
  useEffect(() => {
    if (!watching) return;
    let frame = 0;
    const bump = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setTick((t) => t + 1));
    };
    const mo = new MutationObserver(bump);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', bump);
    return () => {
      cancelAnimationFrame(frame);
      mo.disconnect();
      window.removeEventListener('resize', bump);
    };
  }, [watching]);

  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const on = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  const dialogParam = DIALOG_PARAMS.some((k) => params.has(k));
  const modal = watching && (dialogParam || !!document.querySelector(MODAL));
  const newKind = params.get('new');

  // The step, from what is true now.
  let step: Guidance | null = null;
  if (task === 'first-shot') {
    const c = facts.composer?.brandId === brand.id ? facts.composer : null;
    step = firstShotStep({
      here: hub && !modal,
      composer: c && settling ? { ...c, busy: true } : c,
      nodes,
    });
  } else if (task === 'refine') step = refineStep({ here: !!shot, nodes });
  else if (task === 'presenter') step = studio ? presenterStep(facts.studio) : null;
  else if (task === 'product' || task === 'scene') step = assetStep(task, newKind === task);

  // Escape puts a coach away until the step changes; Back reviews the card before.
  const [snoozed, setSnoozed] = useState<string | null>(null);
  const [review, setReview] = useState<Guidance | null>(null);
  const visited = useRef<Guidance[]>([]);
  const stepId = step ? `${task}:${step.id}` : null;
  const lastStep = useRef<string | null>(null);
  if (lastStep.current !== stepId) {
    lastStep.current = stepId;
    if (snoozed) setSnoozed(null);
    if (review) setReview(null);
    if (step?.voice === 'coach' && step.target && step.title) {
      const at = visited.current.findIndex((g) => g.id === step?.id);
      visited.current = at >= 0 ? visited.current.slice(0, at + 1) : [...visited.current, step];
    }
  }
  useEffect(() => {
    if (!task) visited.current = [];
  }, [task]);

  const shown = review ?? (step && snoozed !== step.id ? step : null);
  const reviewBefore = (g: Guidance) => {
    const at = visited.current.findIndex((v) => v.id === g.id);
    const prev = at > 0 ? visited.current[at - 1] : null;
    return prev?.target && firstVisible(prev.target) ? prev : null;
  };

  // How a task ends.
  const finish = useCallback((t: GuideTaskId) => void guideIntent({ finish: t }), []);
  const dismiss = useCallback(
    (t: GuideTaskId) => {
      void guideIntent({ dismiss: t });
      push({ kind: 'success', title: 'Guide closed', detail: 'Pick it up again from First steps on Home.' });
    },
    [push],
  );

  // Opening a shot the first shot made is what its last card asks for.
  useEffect(() => {
    if (task === 'first-shot' && shot && nodes.some((n) => n.id === shot && n.status === 'done' && n.images > 0))
      finish('first-shot');
  }, [task, shot, nodes, finish]);

  // Refining ends when the shot closes: done if a new version exists, and
  // otherwise quietly, so First steps offers it again rather than holding it.
  const onShot = useRef(false);
  useEffect(() => {
    if (task !== 'refine') {
      onShot.current = false;
      return;
    }
    if (shot) onShot.current = true;
    else if (onShot.current) {
      onShot.current = false;
      finish('refine');
    }
  }, [task, shot, finish]);

  // A product, presenter or scene task: re-read what the brand holds whenever
  // it may have changed, and end once there is one more than when it began.
  const assetTask = task === 'product' || task === 'presenter' || task === 'scene';
  const buildsRunning = builds.filter((b) => !b.finished).length;
  useEffect(() => {
    if (assetTask) void refreshGuide();
  }, [assetTask, brand, products.length, buildsRunning, importing]);
  useEffect(() => {
    if (assetTask && guide.counts && madeOne(guide, guide.counts)) finish(active?.task as GuideTaskId);
  }, [assetTask, guide, active, finish]);

  // Left the surface with nothing made and nothing still building: the task
  // ends quietly, and First steps offers it again. A presenter with a draft
  // stays in hand, so its item continues that draft.
  const onSurface = task === 'presenter' ? studio : task === 'product' || task === 'scene' ? newKind === task : true;
  const wasOn = useRef(false);
  useEffect(() => {
    if (!assetTask) {
      wasOn.current = false;
      return;
    }
    if (onSurface) {
      wasOn.current = true;
      return;
    }
    if (!wasOn.current) return;
    wasOn.current = false;
    const t = task as GuideTaskId;
    void refreshGuide().then(() => {
      const g = guideSnapshot();
      if (g.active?.task !== t || (g.counts && madeOne(g, g.counts))) return;
      if (buildsRunning > 0 || importing || (t === 'presenter' && g.activeDraftId)) return;
      finish(t);
    });
  }, [assetTask, onSurface, task, buildsRunning, importing, finish]);

  // A surface someone new opens on their own begins its task, once.
  useEffect(() => {
    if (!guide.loaded || task || active) return;
    const s = { eligible: guide.eligible, hidden: guide.hidden, done: guide.done, dismissed: guide.dismissed, active };
    const doneShot = !!shot && recent.some((n) => n.id === shot && n.status === 'done');
    const want: GuideTaskId | null =
      doneShot && startsHere('refine', s)
        ? 'refine'
        : newKind === 'product' && startsHere('product', s)
          ? 'product'
          : newKind === 'scene' && startsHere('scene', s)
            ? 'scene'
            : studio && startsHere('presenter', s)
              ? 'presenter'
              : null;
    if (want) void guideIntent({ start: { task: want, brandId: brand.id } });
  }, [guide, task, active, shot, recent, newKind, studio, brand.id]);

  // Announced once per step into a region that was already there, unless a
  // coach card took focus, which reads itself out.
  const [said, setSaid] = useState('');
  const wordsOf = (g: Guidance | null) => (g ? (g.announce ?? [g.title, g.body].filter(Boolean).join('. ')) : '');
  const latestShown = useRef(shown);
  latestShown.current = shown;
  const onShown = useCallback((_id: string, focusMoved: boolean) => {
    setSaid('');
    if (focusMoved) return;
    const words = wordsOf(latestShown.current);
    if (words) requestAnimationFrame(() => setSaid(words));
  }, []);
  // A card or coach says itself through onShown; a note in a slot and a quiet step are said here.
  const drawsItself = !!shown && (shown.voice === 'coach' || shown.voice === 'card') && !shown.slot;
  const shownWords = drawsItself ? '' : wordsOf(shown);
  useEffect(() => {
    setSaid('');
    if (!shownWords) return;
    const frame = requestAnimationFrame(() => setSaid(shownWords));
    return () => cancelAnimationFrame(frame);
  }, [shownWords]);

  // The welcome: once, on the first ready main page, when nothing else is happening.
  const [welcome, setWelcome] = useState(false);
  const ready = (home && data.showcaseLoaded) || hub;
  const busyWork = builds.some((b) => !b.finished) || tasks.some((t) => t.state === 'running' && t.kind !== 'catalog');
  const mayWelcome = canWelcome({
    onMainPage: home || hub,
    eligible: guide.eligible,
    welcome: guide.welcome,
    ready: ready && !document.querySelector('[data-variant="skeleton"]'),
    visible,
    blocked: modal,
    busy: busyWork,
  });
  useEffect(() => {
    if (!mayWelcome) return;
    const t = window.setTimeout(() => setWelcome(true), WELCOME_SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [mayWelcome]);

  const pictures = useMemo(() => welcomeSet(data.showcase).map((e) => sized(e.previewUrl as string)), [data.showcase]);
  const engineReady = data.engines.some((e) => e.available);
  const ownsProducts = products.length > 0;

  // What gets drawn.
  const drawn = shown && shown.voice !== 'quiet' && shown.voice !== 'note' ? shown : null;
  const target = drawn?.target ? firstVisible(drawn.target) : null;
  const surfaces = (drawn?.surfaces ?? []).map((s) => firstVisible(s)).filter((el): el is HTMLElement => !!el);
  const coachReady = !!drawn && (drawn.target ? !!target : surfaces.length > 0);
  const slotEl = shown?.slot ? (facts.slots[shown.slot] ?? null) : null;
  const note =
    shown?.slot && shown.body && slotEl && (shown.voice === 'note' || shown.voice === 'coach') ? shown : null;
  const showing = welcome || coachReady || !!note;
  useEffect(() => setGuideShowing(showing), [showing]);
  useEffect(() => () => setGuideShowing(false), []);

  const close = (g: Guidance) => {
    if (!task) return;
    if (g.done) finish(task);
    else dismiss(task);
  };

  return (
    <>
      <span className="sc-vh" role="status" aria-live="polite">
        {said}
      </span>
      {drawn && coachReady && (
        <Coachmark
          id={`${review ? 'review:' : ''}${drawn.id}`}
          voice={drawn.voice === 'coach' ? 'coach' : 'card'}
          target={target}
          surfaces={surfaces}
          side={drawn.side ?? 'top'}
          title={drawn.slot ? undefined : drawn.title}
          body={drawn.slot ? undefined : drawn.body}
          canBack={!review && !!reviewBefore(drawn)}
          action={review ? 'next' : drawn.done ? 'done' : null}
          closeLabel={drawn.done ? 'Close' : 'Close guide'}
          onBack={() => setReview(reviewBefore(drawn))}
          onAction={() => (review ? setReview(null) : close(drawn))}
          onClose={() => close(drawn)}
          onEscape={() => (review ? setReview(null) : setSnoozed(drawn.id))}
          onShown={onShown}
        />
      )}
      {note &&
        slotEl &&
        createPortal(
          <GuideNote
            text={note.body as string}
            closeLabel={note.done ? 'Close' : 'Close guide'}
            onClose={() => close(note)}
          />,
          slotEl,
        )}
      <WelcomeDialog
        open={welcome}
        pictures={pictures}
        note={WELCOME.note({ engineReady, ownsProducts })}
        onTake={() => {
          setWelcome(false);
          void guideIntent({ welcome: 'taken' }).then(() => launch('first-shot'));
        }}
        onDecline={() => {
          setWelcome(false);
          void guideIntent({ welcome: 'declined' });
        }}
      />
    </>
  );
}

function firstVisible(selector: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(selector)) if (el.getClientRects().length > 0) return el;
  return null;
}

/** The curated pictures take a width, the way every tile asks for its own size. */
function sized(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}w=320`;
}
