import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMatch, useNavigate, useSearchParams } from 'react-router';
import { useAppData, useDialogParam } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { useTaskCenter } from '../app/TaskCenter.js';
import type { GuideTaskId, GuideTaskNode } from '../api.js';
import { arrived, guideIntent, headFor, refreshGuide, useGuide, viaWayKey } from '../guide.js';
import { setGuideShowing, useGuideFacts } from '../guideFacts.js';
import {
  ASK_TAB,
  COMPOSE_CARD,
  WELCOME,
  askedKind,
  canWelcome,
  chipToTakeBack,
  coachCanBack,
  firstShotMoment,
  madeOne,
  mergeTaskNodes,
  presenterMoment,
  reuseMoment,
  productMoment,
  refineMoment,
  SHOT_COMPOSER,
  sceneMoment,
  startsHere,
  welcomeSet,
  type AskedKind,
  type Moment,
  LIBRARY_NEW,
} from '../guidedTasks.js';
import { stepOfMoment } from '../lessons.js';
import { brandPath, hubPath, presentersPath, P } from '../routes.js';
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
const DIALOG_PARAMS = ['settings', 'setup', 'new', 'whatsnew', 'learn', 'welcome'];
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
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const newDlg = useDialogParam('new');
  const home = !!useMatch(P.brand);
  const hub = !!useMatch(P.hub);
  const shot = useMatch(P.hubShot)?.params.shotId ?? null;
  const studio = !!useMatch(P.presenterStudio);
  const onProducts = !!useMatch(P.products);
  const onScenes = !!useMatch(P.scenes);
  const onPresenters = !!useMatch(P.presenters);

  const active = guide.active;
  // The task in hand for this brand, and the one being guided: a paused task
  // (its guide closed part way) is still in hand, and still finishes when the
  // product says so, but nothing of the tutor shows for it.
  const held: GuideTaskId | null = active && active.brandId === brand.id ? active.task : null;
  const task: GuideTaskId | null = held && !active?.paused ? held : null;
  // Both walks that make a shot watch the shots they make.
  const nodeKind = task === 'first-shot' || task === 'reuse' ? 'generation' : task === 'refine' ? 'edit' : null;
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

  const heading = guide.heading;
  const headingFor = (t: GuideTaskId | null) => !!t && heading?.brandId === brand.id && heading.task === t && !modal;
  const destOf = (t: GuideTaskId) =>
    t === 'first-shot' || t === 'reuse' || t === 'refine'
      ? hub
      : t === 'product'
        ? onProducts
        : t === 'scene'
          ? onScenes
          : t === 'presenter'
            ? onPresenters || studio
            : false;
  // A walk that began with the way to its place: arriving by their own hand
  // is the opening read, and Back on the first thing there asks for the way
  // again. Remembered where the opening is, for a reload part way.
  const [viaWay, setViaWay] = useState(false);
  useEffect(() => {
    let v = false;
    try {
      v = !!task && window.localStorage.getItem(viaWayKey(brand.id, task)) === '1';
    } catch {
      // a browser that refuses storage just has no Back to the way
    }
    setViaWay(v);
  }, [task, brand.id, heading]);
  useEffect(() => {
    if (!heading || heading.brandId !== brand.id) return;
    if (!destOf(heading.task)) return;
    try {
      window.localStorage.setItem(viaWayKey(brand.id, heading.task), '1');
    } catch {
      // the walk still happens, Back just has nothing to undo
    }
    setViaWay(true);
    if (heading.task === 'first-shot' || heading.task === 'reuse') beginNow();
    arrived();
  }, [heading, hub, onProducts, onScenes, onPresenters, studio, brand.id, beginNow]);
  // Back from the first thing on a destination must not set heading while
  // still there: the arrival effect would clear it before Home paints.
  const pendingWay = useRef<GuideTaskId | null>(null);
  useEffect(() => {
    const t = pendingWay.current;
    if (!t || destOf(t)) return;
    pendingWay.current = null;
    headFor(brand.id, t);
  }, [hub, onProducts, onScenes, onPresenters, studio, brand.id]);
  // A leftover way, after the lesson has let go of this brand.
  useEffect(() => {
    if (guide.loaded && !held && heading) arrived();
  }, [guide.loaded, held, heading]);

  // The one moment, from what is true now.
  let moment: Moment | null = null;
  if (task === 'first-shot' || task === 'reuse') {
    const c = facts.composer?.brandId === brand.id ? facts.composer : null;
    // The render that arrives by the way to Create already knows it did: the
    // flag is only written down after it, and a card placed for the in-between
    // (no Back, "1 of 4", the greeting still due) grew into what it points at.
    const arriving = hub && headingFor(task);
    const shotFacts = {
      here: hub && !modal,
      heading: headingFor(task) && !hub,
      viaBar: viaWay || arriving,
      composer: c && settling ? { ...c, busy: true } : c,
      nodes,
      begun: begun || arriving || nodes.length > 0,
    };
    moment = task === 'reuse' ? reuseMoment(shotFacts) : firstShotMoment(shotFacts);
  } else if (task === 'refine') {
    const c = facts.composer?.brandId === brand.id ? facts.composer : null;
    const open = !!shot;
    // The shot's own overlay carries `role="dialog"`, so it is `modal` by that
    // reading too: its own surface, never something sat over it, the way the
    // grid's discovery card must still give way to a real dialog on top.
    moment = refineMoment({
      here: open || (hub && !modal),
      heading: headingFor(task) && !hub && !open,
      open,
      armed: hub && !!c?.refining,
      nodes,
      asking: open ? !!firstVisible(SHOT_COMPOSER) : !!firstVisible(COMPOSE_CARD),
    });
  } else if (task === 'presenter')
    moment = presenterMoment({
      heading: headingFor(task) && !onPresenters && !studio,
      onPage: onPresenters && !studio && !modal,
      studio: studio ? facts.studio : null,
    });
  else if (task === 'scene')
    moment = sceneMoment({
      heading: headingFor(task) && !onScenes,
      onPage: onScenes && !modal && newKind !== 'scene',
      dialogOpen: newKind === 'scene',
    });
  else if (task === 'product')
    moment = productMoment({
      heading: headingFor(task) && !onProducts,
      onPage: onProducts && !modal && newKind !== 'product',
      dialogOpen: newKind === 'product',
    });

  /**
   * The picker shows the one kind being asked for, and moves on with the ask:
   * open it at a product and it is products, pick one and it is presenters.
   * Everything else in there is not what this moment is about.
   */
  const mine = facts.composer?.brandId === brand.id ? facts.composer : null;
  const asked: AskedKind | null =
    task === 'first-shot' && mine
      ? askedKind(mine)
      : // using a saved thing again asks for two of the three, in its own order
        task === 'reuse' && mine
        ? mine.products === 0
          ? 'product'
          : !mine.scene
            ? 'scene'
            : null
        : null;
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

  // Under 1280px a library page keeps its own Add button only in the bar's +
  // menu (styles/surfaces/add-to-brand.css). A step that asks for that button
  // brings the page's own back while it asks, or the card has nothing to point
  // at and says nothing: seen on a phone and on any laptop under 1280, for
  // anyone who already owns one of the kind (with none, the page's own offer
  // carries the button at every width).
  const libraryNew = moment?.point === LIBRARY_NEW;
  useEffect(() => {
    if (!libraryNew) return;
    document.documentElement.dataset.guideNew = '';
    return () => {
      delete document.documentElement.dataset.guideNew;
    };
  }, [libraryNew]);

  /**
   * Back undoes the last thing done: a chip in the brief, the walk that put
   * them on this page, or the surface this step opened (studio, dialog, shot).
   * Where there is nothing to undo there is no Back to press.
   */
  /**
   * Where this moment sits in its lesson, said the way Learn says it. One
   * list per lesson (lessons.ts) feeds both, so a card reading "3 of 6" is
   * the third of the six steps Learn shows, with the same words.
   */
  if (task && moment && moment.voice !== 'quiet') {
    const where = stepOfMoment(task, moment.id);
    if (where) {
      moment = { ...moment, ...where };
    }
  }
  /**
   * A milestone seen is the lesson's own to remember (routes/guide.ts). It is
   * written once, by the moment's name, so leaving this lesson for another
   * and coming back finds it where it was rather than at the beginning.
   */
  const seen = task && moment && moment.voice !== 'quiet' ? moment.id : null;
  const noted = useRef('');
  useEffect(() => {
    if (!task || !seen) return;
    const mark = `${task}:${seen}`;
    if (noted.current === mark) return;
    noted.current = mark;
    if (guide.progress?.[task]?.reached.includes(seen)) return;
    void guideIntent({ reached: { task, moment: seen } });
  }, [task, seen, guide.progress]);

  const shown = moment;

  // Tasks this visit has begun on its own, or seen end: neither is begun on its own again.
  const autoStarted = useRef(new Set<GuideTaskId>());
  // How a task ends. Ended here, it is not begun here again: the open shot's
  // composer is still reached for after Done, and the record's tick for it
  // can arrive a moment after the task has let go.
  const finish = useCallback((t: GuideTaskId) => {
    autoStarted.current.add(t);
    void guideIntent({ finish: t });
  }, []);
  const dismiss = useCallback(
    (t: GuideTaskId) => {
      void guideIntent({ dismiss: t });
      push({ kind: 'info', title: 'Guide closed', detail: 'Continue it any time from Learn.' });
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
  // otherwise quietly, so Learn offers it again rather than holding it.
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
  const assetTask = held === 'presenter' || held === 'scene' || held === 'product';
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
  // And again whenever Help asks for it: that changes nothing in the record.
  const welcomeParam = useDialogParam('welcome');
  const welcomeAsked = welcomeParam.value !== null;
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
          soft={drawn.soft}
          container={container as HTMLElement}
          title={drawn.title}
          body={drawn.body}
          at={drawn.at}
          of={drawn.of}
          canBack={coachCanBack(task, drawn.id, viaWay || !!(hub && headingFor(task)))}
          action={drawn.start ? { label: 'Start' } : drawn.done ? { label: 'Done' } : null}
          closeLabel={drawn.done ? 'Close' : 'Close guide'}
          onBack={() => {
            const kind = task ? chipToTakeBack(task, drawn.id) : null;
            if (kind) {
              window.dispatchEvent(new CustomEvent('scenri:guide-take-back', { detail: { kind } }));
              window.dispatchEvent(new CustomEvent('scenri:guide-picker', { detail: { tab: ASK_TAB[kind] } }));
              return;
            }
            if (task === 'presenter' && (drawn.id === 'start' || drawn.id === 'face' || drawn.id === 'save')) {
              return navigate(presentersPath(brand), { replace: true });
            }
            if ((task === 'product' || task === 'scene') && drawn.id === task) {
              return newDlg.close();
            }
            if (task === 'refine' && drawn.id === 'ask') {
              if (shot) return navigate(hubPath(brand), { replace: true });
              window.dispatchEvent(new Event('scenri:guide-clear-refine'));
              return;
            }
            // The first thing on a destination, after walking there: coming
            // here is what Back undoes, and the way here is asked for again.
            if (viaWay && task && (drawn.id === 'new' || drawn.id === 'choose' || drawn.id === 'product')) {
              window.dispatchEvent(new Event('scenri:guide-close-picker'));
              pendingWay.current = task;
              return navigate(brandPath(brand));
            }
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
        open={welcome || welcomeAsked}
        pictures={pictures}
        note={WELCOME.note({ engineReady, ownsProducts })}
        onTake={() => {
          const first = welcome;
          setWelcome(false);
          if (welcomeAsked) welcomeParam.close();
          if (first) void guideIntent({ welcome: 'taken' }).then(() => launch('first-shot'));
          // asked for from Help: its address has to be gone before the first
          // shot opens Create, or the move would carry it along
          else window.setTimeout(() => void launch('first-shot'), 0);
        }}
        onDecline={() => {
          const first = welcome;
          setWelcome(false);
          if (welcomeAsked) welcomeParam.close();
          if (first) void guideIntent({ welcome: 'declined' });
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
