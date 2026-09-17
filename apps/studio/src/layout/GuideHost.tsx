import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMatch, useSearchParams } from 'react-router';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { useTaskCenter } from '../app/TaskCenter.js';
import type { GuideTaskId, GuideTaskNode } from '../api.js';
import { guideIntent, refreshGuide, useGuide } from '../guide.js';
import { setGuideHoldSend, setGuideShowing, setGuideStaged, useGuideFacts } from '../guideFacts.js';
import {
  REVIEWABLE,
  WELCOME,
  assetStep,
  canWelcome,
  firstShotStep,
  madeOne,
  mergeTaskNodes,
  presenterStep,
  starterRecipe,
  wordPrint,
  CHECK_TAB,
  refineStep,
  startsHere,
  welcomeSet,
  type Guidance,
} from '../guidedTasks.js';
import { P } from '../routes.js';
import { useToasts } from '../toasts.js';
import { WelcomeDialog } from '../views/WelcomeDialog.js';
import { Coachmark } from './Coachmark.js';
import { sideWithRoom, boxOf } from './coachGeometry.js';
import { useLaunchTask } from './useLaunchTask.js';

/** How long a ready page rests before the welcome arrives. e2e sets it to 0. */
const WELCOME_SETTLE_MS = Number(window.localStorage.getItem('scenri:welcome-settle-ms') ?? 900);
/**
 * What owns the screen above the page, so the guide waits under it. Never the
 * picker, which the first shot goes through, and never a chip's own menu,
 * which is part of building the brief.
 */
const MODAL = '[role="dialog"]:not(.sc-coach):not(.sc-attachpanel):not(.sc-swap), [role="alertdialog"], .sc-lightbox';
/** Dialogs that live in the address. */
const DIALOG_PARAMS = ['settings', 'setup', 'new', 'whatsnew'];
/** A card beside its target: its width, the air to the target and to the screen's edge. */
const BESIDE = 280 + 17 + 12;

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
  const [params, setParams] = useSearchParams();
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

  /**
   * The first one is on us (DESIGN.md, "First use"): Scenri keeps a recipe it
   * ships in mind and offers it a part at a time, where that part is added.
   * Nothing is ever put in the brief unasked: the card's **Use ours** is what
   * hands a part over, and their own pick is always the other answer.
   */
  const starter = useMemo(() => starterRecipe(data.showcase), [data.showcase]);
  const tokensOf = (t: string) =>
    ((starter?.brief?.tokens ?? []) as { t?: string; id?: string; v?: string }[]).filter((k) => k?.t === t);
  const offers = useMemo(() => {
    const has = (t: string) => tokensOf(t).length > 0;
    return [
      ...(has('product') ? (['product'] as const) : []),
      ...(has('character') ? (['presenter'] as const) : []),
      ...(has('template') ? (['scene'] as const) : []),
      ...(has('text') ? (['words'] as const) : []),
    ];
    // tokensOf reads only from starter
  }, [starter]);
  /** Hands one part of that recipe to the composer, the way a pick or a typed line would arrive. */
  const fill = (part: string) => {
    const kind = part === 'presenter' ? 'character' : part === 'scene' ? 'template' : part === 'words' ? 'text' : part;
    const tokens = tokensOf(kind);
    if (!tokens.length) return;
    const format = tokensOf('format')[0] as { w?: number; h?: number } | undefined;
    window.dispatchEvent(
      new CustomEvent('scenri:guide-fill', {
        detail: {
          tokens,
          // the shape, the number and the size that recipe was shot with ride along with its words
          ...(part === 'words'
            ? {
                settings: {
                  ...(format?.w && format?.h ? { format: { w: format.w, h: format.h } } : {}),
                  variants: starter?.variants,
                  quality: starter?.quality,
                },
              }
            : {}),
        },
      }),
    );
    if (part === 'words') setConfirmed((c) => (c.includes('words') ? c : [...c, 'words']));
  };
  /**
   * Scenri makes the shot itself only while the brief is the one it had in
   * mind: their ingredients and their words are their own shot, made the real way.
   */
  const starterIds = useMemo(
    () =>
      ((starter?.brief?.tokens ?? []) as { t?: string; id?: string }[])
        .flatMap((t) => (t.id && (t.t === 'product' || t.t === 'character' || t.t === 'template') ? [t.id] : []))
        .sort()
        .join(','),
    [starter],
  );
  const starterWords = useMemo(
    () =>
      wordPrint(
        ((starter?.brief?.tokens ?? []) as { t?: string; v?: string }[])
          .flatMap((t) => (t.t === 'text' ? [t.v ?? ''] : []))
          .join(' '),
      ),
    [starter],
  );
  const sameAsStarter =
    !!starter &&
    !!facts.composer &&
    starterIds !== '' &&
    [...facts.composer.ids].sort().join(',') === starterIds &&
    facts.composer.wordPrint === starterWords;
  useEffect(() => {
    setGuideStaged(task === 'first-shot' && sameAsStarter && starter ? starter.id : null);
    return () => setGuideStaged(null);
  }, [task, sameAsStarter, starter]);

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
  // A control's own popover or the phone's settings sheet is part of the step, never something over it.
  const modal =
    watching &&
    (dialogParam ||
      [...document.querySelectorAll(MODAL)].some(
        (el) => !el.closest('[data-radix-popper-content-wrapper], .sc-shotsheet'),
      ));
  const newKind = params.get('new');

  // Steps the person has said are done, for this task in hand. The direction
  // is only done while there are words: emptying the brief asks for it again.
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const words = !!facts.composer?.words;
  useEffect(() => setConfirmed([]), [task]);
  useEffect(() => {
    if (!words) setConfirmed((c) => (c.includes('direct') ? c.filter((x) => x !== 'direct') : c));
  }, [words]);

  // The step, from what is true now.
  let step: Guidance | null = null;
  if (task === 'first-shot') {
    const c = facts.composer?.brandId === brand.id ? facts.composer : null;
    step = firstShotStep({
      here: hub && !modal,
      composer: c && settling ? { ...c, busy: true } : c,
      nodes,
      confirmed,
      staged: sameAsStarter,
      offers,
    });
  } else if (task === 'refine') step = refineStep({ here: !!shot, nodes });
  else if (task === 'presenter') step = studio ? presenterStep(facts.studio) : null;
  else if (task === 'product' || task === 'scene') step = assetStep(task, newKind === task);

  // A card beside its target (the picker, a dialog, a question) where there is
  // room for it, and above it where there is not: never inside, never hidden.
  if (step?.beside && step.target) {
    // measured against the target and the surface it sits in, so a card beside a
    // setting clears the whole composer rather than landing on it
    const boxes = [step.target, ...(step.surfaces ?? []).slice(0, 1)]
      .map((sel) => firstVisible(sel))
      .filter((el): el is HTMLElement => !!el)
      .map((el) => boxOf(el.getBoundingClientRect()));
    const around = boxes.reduce<ReturnType<typeof boxOf> | null>(
      (u, b) =>
        u
          ? {
              left: Math.min(u.left, b.left),
              top: Math.min(u.top, b.top),
              right: Math.max(u.right, b.right),
              bottom: Math.max(u.bottom, b.bottom),
            }
          : b,
      null,
    );
    const side = around ? sideWithRoom(around, window.innerWidth, BESIDE) : null;
    step = { ...step, side: side ?? 'top' };
  }
  // On a narrow screen the open picker makes room above itself for that card.
  const pickerRoom = !!step?.beside && step.target === PICKER_TARGET && step.side === 'top';
  useEffect(() => {
    if (!pickerRoom) return;
    document.documentElement.dataset.guidePicker = '';
    return () => {
      delete document.documentElement.dataset.guidePicker;
    };
  }, [pickerRoom]);

  // Escape or an X that only snoozes puts a card away until the step changes;
  // Back shows the card before again, for review, and touches nothing.
  const [snoozed, setSnoozed] = useState<string | null>(null);
  const [review, setReview] = useState<Guidance | null>(null);
  const visited = useRef<Guidance[]>([]);
  const stepId = step ? `${task}:${step.id}` : null;
  const lastStep = useRef<string | null>(null);
  if (lastStep.current !== stepId) {
    lastStep.current = stepId;
    if (snoozed) setSnoozed(null);
    if (review) setReview(null);
    if (step && REVIEWABLE.includes(step.id)) {
      const at = visited.current.findIndex((g) => g.id === step?.id);
      visited.current = at >= 0 ? visited.current.slice(0, at + 1) : [...visited.current, step];
    }
  }
  useEffect(() => {
    if (!task) visited.current = [];
  }, [task]);

  const shown = review ?? (step && snoozed !== step.id ? step : null);
  const reviewBefore = (g: Guidance) => {
    if (!REVIEWABLE.includes(g.id)) return null;
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

  // A product, presenter or scene task: re-read what the brand holds whenever
  // it may have changed, and end once there is one more than when it began.
  // Closing its surface does not end it: a build may still be landing, and the
  // task waits in First steps for whoever comes back to it.
  const assetTask = task === 'product' || task === 'presenter' || task === 'scene';
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
  // Each surface begins its task at most once per visit: a task just finished
  // or put away is never begun again by the same moment that began it.
  const autoStarted = useRef(new Set<GuideTaskId>());
  useEffect(() => {
    if (!guide.loaded || !guide.eligible) return;
    const s = { eligible: guide.eligible, hidden: guide.hidden, done: guide.done, dismissed: guide.dismissed, active };
    const doneShot = !!shot && engaged && recent.some((n) => n.id === shot && n.status === 'done');
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
    if (!want || autoStarted.current.has(want)) return;
    autoStarted.current.add(want);
    void guideIntent({ start: { task: want, brandId: brand.id } });
  }, [guide, active, shot, engaged, recent, newKind, studio, brand.id]);

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

  // Words inside a surface, and a quiet step's one sentence, are said here; a
  // coach or a card says itself when it is shown.
  const spoken = shown?.voice === 'quiet' ? (shown.announce ?? '') : '';
  useEffect(() => {
    setSaid('');
    if (!spoken) return;
    const frame = requestAnimationFrame(() => setSaid(spoken));
    return () => cancelAnimationFrame(frame);
  }, [spoken]);

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

  // What gets drawn: a coach or a card, inside whichever surface owns the screen.
  const drawn = shown && (shown.voice === 'coach' || shown.voice === 'card') ? shown : null;
  const container = drawn?.container ? firstVisible(drawn.container) : document.body;
  const target = drawn?.target ? firstVisible(drawn.target) : null;
  const found = (sels: readonly string[] | undefined) =>
    (sels ?? []).map((s) => firstVisible(s)).filter((el): el is HTMLElement => !!el);
  const required = found(drawn?.surfaces);
  // a popover or sheet the step's control opened joins the windows, live, while it is open
  const opened = found(drawn?.optional);
  const surfaces = [...required, ...opened];
  const live = [...found(drawn?.live ?? drawn?.surfaces), ...opened];
  const drawReady =
    !!drawn && !!container && !!target && (drawn.voice === 'card' || required.length === (drawn.surfaces ?? []).length);
  const missing = drawn && !drawReady ? drawn : null;
  const showing = welcome || drawReady;
  useEffect(() => setGuideShowing(showing), [showing]);
  useEffect(() => () => setGuideShowing(false), []);

  // What a step points at can arrive a moment after the step does: a tile the
  // feed has still to fetch, a question still being written into the studio.
  // Watch for it where it will appear, and only until it does.
  useEffect(() => {
    if (!missing) return;
    const root =
      (missing.container ? document.querySelector(missing.container) : null) ??
      document.querySelector('.sc-feed') ??
      document.body;
    const mo = new MutationObserver(rerender);
    mo.observe(root, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [missing?.id, missing?.container, rerender]);

  const close = (g: Guidance) => {
    if (!task) return;
    if (g.done) finish(task);
    else if (g.snooze) setSnoozed(g.id);
    else dismiss(task);
  };
  const act = (g: Guidance) => {
    if (review) return setReview(null);
    if (g.action?.disabled) return;
    if (g.action?.kind === 'fill') return fill(g.id);
    if (g.action?.kind === 'close-picker') {
      // closing the picker is also being done with that part of the brief
      window.dispatchEvent(new Event('scenri:guide-close-picker'));
      setConfirmed((c) => (c.includes(g.id) ? c : [...c, g.id]));
    } else if (g.action?.kind === 'confirm') setConfirmed((c) => (c.includes(g.id) ? c : [...c, g.id]));
    else if (g.done && task) finish(task);
  };
  // Hold the brief's own send until the Generate step, and let Enter say the step in hand is done.
  const holdSend = task === 'first-shot' && !!step && step.voice === 'coach' && step.id !== 'generate';
  useEffect(() => {
    setGuideHoldSend(holdSend);
    return () => setGuideHoldSend(false);
  }, [holdSend]);
  const actRef = useRef(act);
  actRef.current = act;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  useEffect(() => {
    const onEnter = () => {
      const g = shownRef.current;
      if (g?.action?.kind === 'confirm') actRef.current(g);
    };
    window.addEventListener('scenri:guide-enter', onEnter);
    return () => window.removeEventListener('scenri:guide-enter', onEnter);
  }, []);
  const actionOf = (g: Guidance) =>
    review
      ? { label: 'Next' }
      : g.action
        ? { label: g.action.label, disabled: g.action.disabled }
        : g.done
          ? { label: 'Done' }
          : null;
  /**
   * The picker shows the one kind being asked for, and moves on with the step:
   * open it at a product and it is products, take or pick one and it is
   * presenters. Everything else in there is not what this step is about.
   */
  const askedKind = step && step.id in CHECK_TAB ? (step.id as keyof typeof CHECK_TAB) : null;
  const pickerOpen = !!facts.composer?.pickerOpen;
  useEffect(() => {
    if (task !== 'first-shot' || !pickerOpen || !askedKind) return;
    openPickerAt(askedKind);
  }, [task, pickerOpen, askedKind]);
  const closeLabel = (g: Guidance) => (g.done || g.snooze ? 'Close' : 'Close guide');

  return (
    <>
      <span className="sc-vh" role="status" aria-live="polite">
        {said}
      </span>
      {drawn && drawReady && (
        <Coachmark
          id={`${review ? 'review:' : ''}${drawn.id}`}
          voice={drawn.voice === 'coach' ? 'coach' : 'card'}
          target={target}
          surfaces={surfaces}
          live={live}
          side={drawn.side ?? 'top'}
          beside={drawn.beside}
          container={container as HTMLElement}
          title={drawn.title}
          body={drawn.body}
          canBack={!review && !!reviewBefore(drawn)}
          action={actionOf(drawn)}
          checklist={review ? undefined : drawn.checklist}
          onCheck={openPickerAt}
          closeLabel={closeLabel(drawn)}
          onBack={() => setReview(reviewBefore(drawn))}
          onAction={() => act(drawn)}
          onClose={() => close(drawn)}
          onEscape={() => (review ? setReview(null) : setSnoozed(drawn.id))}
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

/** The one step that follows into the picker: it gives the card its room on a phone. */
const PICKER_TARGET = '[data-guide="compose"] .sc-attachpanel';

/** Opens Create's picker on one ingredient's own tab, or moves the open picker there. */
function openPickerAt(kind: keyof typeof CHECK_TAB) {
  window.dispatchEvent(new CustomEvent('scenri:guide-picker', { detail: { tab: CHECK_TAB[kind] } }));
}
