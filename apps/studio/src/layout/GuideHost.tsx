import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMatch, useSearchParams } from 'react-router';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { useTaskCenter } from '../app/TaskCenter.js';
import type { GuideTaskId, GuideTaskNode } from '../api.js';
import { guideIntent, refreshGuide, useGuide } from '../guide.js';
import { setGuideShowing, useGuideFacts } from '../guideFacts.js';
import {
  ASK_TAB,
  WELCOME,
  askedKind,
  canWelcome,
  firstShotMoment,
  madeOne,
  mergeTaskNodes,
  presenterMoment,
  productMoment,
  refineMoment,
  SHOT_COMPOSER,
  sceneMoment,
  startsHere,
  welcomeSet,
  type AskedKind,
  type Moment,
} from '../guidedTasks.js';
import { P } from '../routes.js';
import { useToasts } from '../toasts.js';
import { WelcomeDialog } from '../views/WelcomeDialog.js';
import { Coachmark } from './Coachmark.js';
import { useLaunchTask } from './useLaunchTask.js';

/** How long a ready page rests before the welcome arrives. e2e sets it to 0. */
const WELCOME_SETTLE_MS = Number(window.localStorage.getItem('scenri:welcome-settle-ms') ?? 900);
/**
 * What owns the screen above the page, so the tutor waits under it. Never the
 * picker, which the first shot goes through, and never a chip's own menu,
 * which is part of building the brief.
 */
const MODAL = '[role="dialog"]:not(.sc-coach):not(.sc-attachpanel):not(.sc-swap), [role="alertdialog"], .sc-lightbox';
/** Dialogs that live in the address. */
const DIALOG_PARAMS = ['settings', 'setup', 'new', 'whatsnew'];
/** The picker: the one surface the first shot follows into, and the one that makes room on a phone. */
const PICKER = '[data-guide="compose"] .sc-attachpanel';

/**
 * Where first use happens (DESIGN.md, "First use"): the welcome, once, and
 * whichever guided task is in hand.
 *
 * It owns no steps. Every render it asks the task's rule what the one moment
 * is, from what the product holds right now, and draws it. Leaving, coming
 * back, a reload or a change of mind all land on the right moment because the
 * question is asked again, never because an index was kept.
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

  // Watching, only while something may show. A task needs to know when a
  // dialog, a sheet or the lightbox opens over the page: they all mount as
  // children of the body, so the body's own children are enough. The welcome
  // waits for a page to finish drawing, which only a deeper look can tell.
  const [, setTick] = useState(0);
  const bump = useRef(0);
  const rerender = useCallback(() => {
    cancelAnimationFrame(bump.current);
    bump.current = requestAnimationFrame(() => setTick((t) => t + 1));
  }, []);
  useEffect(() => {
    if (!task && !welcomePending) return;
    const mo = new MutationObserver(rerender);
    mo.observe(document.body, { childList: true, subtree: welcomePending });
    window.addEventListener('resize', rerender);
    return () => {
      cancelAnimationFrame(bump.current);
      mo.disconnect();
      window.removeEventListener('resize', rerender);
    };
  }, [task, welcomePending, rerender]);

  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const on = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  const watching = !!task || welcomePending;
  const dialogParam = DIALOG_PARAMS.some((k) => params.has(k));
  // A control's own popover or the phone's settings sheet is part of the moment, never something over it.
  const modal =
    watching &&
    (dialogParam ||
      [...document.querySelectorAll(MODAL)].some(
        (el) => !el.closest('[data-radix-popper-content-wrapper], .sc-shotsheet'),
      ));
  const newKind = params.get('new');

  /**
   * The opening is a greeting, not a step: once someone has read it for this
   * task it stays read, through a navigation, a reload or a restart. It is
   * kept where the composer keeps its own draft, because it belongs to this
   * browser rather than to the install's record.
   */
  const begunKey = task ? `scenri:guide-begun:${brand.id}:${task}` : null;
  const [begun, setBegun] = useState(false);
  useEffect(() => {
    setBegun(!!begunKey && window.localStorage.getItem(begunKey) === '1');
  }, [begunKey]);
  const beginNow = useCallback(() => {
    if (begunKey) {
      try {
        window.localStorage.setItem(begunKey, '1');
      } catch {
        // a browser that refuses storage simply greets them again
      }
    }
    setBegun(true);
  }, [begunKey]);

  // The one moment, from what is true now.
  let moment: Moment | null = null;
  if (task === 'first-shot') {
    const c = facts.composer?.brandId === brand.id ? facts.composer : null;
    moment = firstShotMoment({
      here: hub && !modal,
      composer: c && settling ? { ...c, busy: true } : c,
      nodes,
      begun: begun || nodes.length > 0,
    });
  } else if (task === 'refine') moment = refineMoment({ here: !!shot, nodes, asking: !!firstVisible(SHOT_COMPOSER) });
  else if (task === 'presenter') moment = studio ? presenterMoment(facts.studio) : null;
  else if (task === 'scene') moment = sceneMoment(newKind === 'scene');
  else if (task === 'product') moment = productMoment(newKind === 'product');

  /**
   * The picker shows the one kind being asked for, and moves on with the ask:
   * open it at a product and it is products, pick one and it is presenters.
   * Everything else in there is not what this moment is about.
   */
  const asked: AskedKind | null =
    task === 'first-shot' && facts.composer?.brandId === brand.id ? askedKind(facts.composer) : null;
  const pickerOpen = !!facts.composer?.pickerOpen;
  useEffect(() => {
    if (!pickerOpen) return;
    // nothing left to add: the picker has done its job, so it gets out of the
    // way rather than asking them to close it
    if (task === 'first-shot' && !asked) window.dispatchEvent(new Event('scenri:guide-close-picker'));
    else if (asked) window.dispatchEvent(new CustomEvent('scenri:guide-picker', { detail: { tab: ASK_TAB[asked] } }));
  }, [task, pickerOpen, asked]);
  // Asking for nothing lets the picker be everything it is again.
  useEffect(() => {
    if (task === 'first-shot' && !asked)
      window.dispatchEvent(new CustomEvent('scenri:guide-picker', { detail: { tab: null } }));
  }, [task, asked]);

  /**
   * A task in hand, said on the page itself: while the tutor is walking
   * someone through a brief, a chip can be changed but not taken out, so a
   * wrong pick is swapped rather than leaving a hole in the walk. Back is what
   * takes one out (below), one step at a time.
   */
  useEffect(() => {
    if (!task) return;
    document.documentElement.dataset.guideTask = task;
    return () => {
      delete document.documentElement.dataset.guideTask;
    };
  }, [task]);

  // On a screen too narrow for a card beside the picker, the picker gives up
  // the height that card needs above it.
  const pickerRoom = moment?.point === PICKER && window.innerWidth < 1024;
  useEffect(() => {
    if (!pickerRoom) return;
    document.documentElement.dataset.guidePicker = '';
    return () => {
      delete document.documentElement.dataset.guidePicker;
    };
  }, [pickerRoom]);

  /**
   * Back through the brief: the ask before this one put a chip in, so going
   * back takes that chip out and the moment before is simply true again. It is
   * the one way anything leaves the brief while the tutor is walking them
   * through it, it never touches more than the one step behind, and where
   * there is nothing to take back there is no Back to press.
   */
  const TAKES_BACK: Record<string, AskedKind> = { presenter: 'product', scene: 'presenter', make: 'scene' };
  // The ids are the first shot's own: another task's moment may share a name
  // (the scene task's one ask is called scene) and has no chip to take back.
  const shown = moment;

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

  // A refinement moves the open shot onto the version it made: read the task
  // again then, rather than waiting for the activity poll to mention it.
  useEffect(() => {
    if (task === 'refine' && shot) void refreshGuide();
  }, [task, shot]);

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

  // A task that makes something (a product, a presenter, a scene): re-read what
  // the brand holds whenever it may have changed, and end once there is one
  // more than when it began. Closing its surface does not end it: a build may
  // still be landing, and the task waits for whoever comes back to it.
  const assetTask = task === 'presenter' || task === 'scene' || task === 'product';
  const buildsRunning = builds.filter((b) => !b.finished).length;
  useEffect(() => {
    if (assetTask) void refreshGuide();
  }, [assetTask, brand, products.length, buildsRunning, importing]);
  useEffect(() => {
    if (assetTask && guide.counts && madeOne(guide, guide.counts)) finish(active?.task as GuideTaskId);
  }, [assetTask, guide, active, finish]);

  // Someone new reaching for a surface on their own begins its task, once. The
  // shot overlay only counts once its composer is reached for: opening a shot
  // to look at it is not asking to learn refining.
  const engaged = !!facts.overlay?.engaged;
  const autoStarted = useRef(new Set<GuideTaskId>());
  useEffect(() => {
    if (!guide.loaded || !guide.eligible) return;
    const s = { eligible: guide.eligible, hidden: guide.hidden, done: guide.done, dismissed: guide.dismissed, active };
    const doneShot = !!shot && engaged && recent.some((n) => n.id === shot && n.status === 'done');
    const want: GuideTaskId | null =
      doneShot && startsHere('refine', s)
        ? 'refine'
        : newKind === 'scene' && startsHere('scene', s)
          ? 'scene'
          : newKind === 'product' && startsHere('product', s)
            ? 'product'
            : studio && startsHere('presenter', s)
              ? 'presenter'
              : null;
    if (!want || autoStarted.current.has(want)) return;
    autoStarted.current.add(want);
    void guideIntent({ start: { task: want, brandId: brand.id } });
  }, [guide, active, shot, engaged, recent, newKind, studio, brand.id]);

  // Announced once per moment into a region that was already there, unless the
  // card took focus, which reads itself out.
  const [said, setSaid] = useState('');
  const latestShown = useRef(shown);
  latestShown.current = shown;
  const onShown = useCallback((_id: string, focusMoved: boolean) => {
    setSaid('');
    if (focusMoved) return;
    const m = latestShown.current;
    const words = m ? [m.title, m.body].filter(Boolean).join('. ') : '';
    if (words) requestAnimationFrame(() => setSaid(words));
  }, []);

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

  // What gets drawn: an ask or a note, inside whichever surface owns the screen.
  const drawn =
    shown && (shown.voice === 'ask' || shown.voice === 'note') ? (shown as Moment & { voice: 'ask' | 'note' }) : null;
  const container = drawn?.shell ? firstVisible(drawn.shell) : document.body;
  const target = drawn?.point ? firstVisible(drawn.point) : null;
  // What the moment says can be used: the control it points at, unless it named
  // something else. An ask that names nothing is the opening, where the page is
  // held and the only thing to do is read it.
  const wanted = drawn?.live ?? (drawn?.point ? [drawn.point] : []);
  const live = wanted.map((sel) => firstVisible(sel)).filter((el): el is HTMLElement => !!el);
  // Usable beside what is asked, when it is there; never waited for.
  const also = (drawn?.also ?? []).map((sel) => firstVisible(sel)).filter((el): el is HTMLElement => !!el);
  // Lit but not for using, and never a reason to hold the card back.
  const lit = (drawn?.lit ?? []).map((sel) => firstVisible(sel)).filter((el): el is HTMLElement => !!el);
  // A moment with nothing to point at (the opening) is ready as soon as the
  // surface it belongs to is there.
  const drawReady = !!drawn && !!container && (!drawn.point || !!target) && live.length === wanted.length;
  const missing = drawn && !drawReady ? drawn : null;
  const showing = welcome || drawReady;
  useEffect(() => setGuideShowing(showing), [showing]);
  useEffect(() => () => setGuideShowing(false), []);

  // What a moment points at can arrive a moment after the moment does: a tile
  // the feed has still to fetch, a question still being written into the
  // studio. Watch for it where it will appear, and only until it does.
  useEffect(() => {
    if (!missing) return;
    const root =
      (missing.shell ? document.querySelector(missing.shell) : null) ??
      document.querySelector('.sc-feed') ??
      document.body;
    const mo = new MutationObserver(rerender);
    mo.observe(root, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [missing?.id, missing?.shell, rerender]);

  const close = (m: Moment) => {
    if (!task) return;
    if (m.done) finish(task);
    else dismiss(task);
  };

  return (
    <>
      <span className="sc-vh" role="status" aria-live="polite">
        {said}
      </span>
      {drawn && drawReady && (
        <Coachmark
          id={drawn.id}
          voice={drawn.voice}
          target={target}
          live={live}
          also={also}
          lit={lit}
          side={drawn.side ?? 'top'}
          beside={drawn.beside}
          container={container as HTMLElement}
          title={drawn.title}
          body={drawn.body}
          at={drawn.at}
          of={drawn.of}
          canBack={task === 'first-shot' && !!TAKES_BACK[drawn.id]}
          action={drawn.start ? { label: 'Start' } : drawn.done ? { label: 'Done' } : null}
          closeLabel={drawn.done ? 'Close' : 'Close guide'}
          onBack={() => {
            // Back takes the last chip out and opens the shelf it came from, on
            // that kind: one press, and they are looking at the choice again.
            const kind = TAKES_BACK[drawn.id];
            window.dispatchEvent(new CustomEvent('scenri:guide-take-back', { detail: { kind } }));
            window.dispatchEvent(new CustomEvent('scenri:guide-picker', { detail: { tab: ASK_TAB[kind] } }));
          }}
          onAction={() => {
            if (drawn.start) return beginNow();
            if (drawn.done && task) finish(task);
          }}
          onClose={() => close(drawn)}
          onEscape={() => close(drawn)}
          onShown={onShown}
          onLost={rerender}
        />
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
