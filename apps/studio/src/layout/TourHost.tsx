import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { useTaskCenter } from '../app/TaskCenter.js';
import { learn, restartTours, useGuide } from '../guide.js';
import {
  backStop,
  endTour,
  forgetTourProgress,
  leaveTour,
  nextStop,
  setWelcomeOpen,
  settleStop,
  startTour,
  tourSnapshot,
  useTour,
} from '../tourStore.js';
import {
  PAUSE_SELECTOR,
  canAutoStart,
  canGoBack,
  canWelcome,
  settleIndex,
  tourConcept,
  tourFor,
  welcomeSet,
  type TourId,
  type TourStop,
} from '../tours.js';
import { WelcomeDialog } from '../views/WelcomeDialog.js';
import { Tour } from './Tour.js';
import { useTourPage } from './useTourPage.js';

/** How long a ready page rests before the welcome arrives. e2e sets it to 0. */
const WELCOME_SETTLE_MS = Number(window.localStorage.getItem('scenri:welcome-settle-ms') ?? 900);

/**
 * Where first use happens (DESIGN.md, "First use"): the welcome once, and the
 * tour of whichever main page is on screen. It reads the page as a person sees
 * it, what has drawn and what is open over it, rather than asking every screen
 * to report, and only watches while there is something left to show.
 */
export function TourHost() {
  const page = useTourPage();
  const guide = useGuide();
  const tour = useTour();
  const data = useAppData();
  const { productsLoaded } = useBrand();
  const { running, builds } = useTaskCenter();
  const [params] = useSearchParams();

  const shownPage = tour?.page ?? page;
  const stops = useMemo(() => (shownPage ? tourFor(shownPage) : []), [shownPage]);

  const learned = guide.learned;
  const watching =
    !!tour ||
    (!!page &&
      guide.eligible &&
      (!learned.includes('welcome') || (!learned.includes('tours-off') && !learned.includes(tourConcept(page)))));

  // One observer, only while something may still show: a stop's target
  // drawing, a dialog opening over it, a skeleton giving way.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!watching) return;
    let frame = 0;
    const bump = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setTick((t) => t + 1));
    };
    const mo = new MutationObserver(bump);
    mo.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-variant'],
    });
    window.addEventListener('resize', bump);
    bump();
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

  const paused = watching && !!document.querySelector(PAUSE_SELECTOR);
  const ready = watching && !!page && pageReady(page, { data, productsLoaded });
  const engineReady = data.engines.some((e) => e.available);

  // The page changed under a tour: close it and keep its place. Leaving from
  // a stop whose step opens somewhere else (Create an image, Create presenter)
  // is usually doing that step, so it resumes past it; leaving from the last
  // stop (Home's points at Create itself) finishes the tour.
  useEffect(() => {
    const t = tourSnapshot();
    if (!t || t.page === page) return;
    if (t.stopId && t.at >= stops.length - 1 && t.ahead.length === 0) return endTour(t.page, { skipped: false });
    const left = stops.find((s) => s.id === t.stopId);
    leaveTour(left?.advanceOnParam ? { resumeAt: t.at + 1 } : {});
  }, [page]);

  useEffect(() => {
    if (
      page &&
      canAutoStart({
        page,
        eligible: guide.eligible,
        learned,
        paused,
        ready,
        engineReady,
        refining: params.has('branch'),
        active: !!tour,
      })
    )
      startTour(page);
  });

  // Settle on the first stop not yet taken, once the page has drawn. A stop
  // reached by Back stays put even if its step has since been taken.
  const stopAt =
    tour && tour.page === page && ready && !paused
      ? settleIndex(stops, tour.at, tour.revisit, isDone, (s) => !!firstVisible(s.targets))
      : null;
  useEffect(() => {
    if (!tour || stopAt === null) return;
    if (stopAt >= stops.length) endTour(tour.page, { skipped: false });
    else settleStop(stopAt, stops[stopAt].id);
  }, [tour, stopAt, stops]);

  // Opening the step's own dialog is doing the step.
  const current = tour?.stopId ? stops[tour.at] : null;
  useEffect(() => {
    if (current?.advanceOnParam && params.has(current.advanceOnParam)) nextStop(current.id);
  }, [current, params]);

  const showing = !!current && !paused;
  const last = !!tour && tour.at >= stops.length - 1 && tour.ahead.length === 0;

  // X is a skip, except on the last stop, where there is nothing left to skip.
  const close = useCallback(
    (stopId: string) => {
      const t = tourSnapshot();
      if (!t || t.stopId !== stopId) return;
      endTour(t.page, { skipped: t.at < stops.length - 1 || t.ahead.length > 0 });
    },
    [stops],
  );
  const next = useCallback(
    (stopId: string) => {
      const t = tourSnapshot();
      if (!t || t.stopId !== stopId) return;
      if (t.at >= stops.length - 1 && t.ahead.length === 0) endTour(t.page, { skipped: false });
      else nextStop(stopId);
    },
    [stops],
  );

  // Announced once per stop, into a region that was already there, unless the
  // card took focus: a dialog taking focus is read out on its own.
  const [said, setSaid] = useState('');
  const shown = useCallback(
    (stopId: string, focusMoved: boolean) => {
      const t = tourSnapshot();
      const stop = stops.find((s) => s.id === stopId);
      setSaid('');
      if (focusMoved || !t || !stop) return;
      requestAnimationFrame(() => setSaid(`Tour, ${t.at + 1} of ${stops.length}. ${stop.title}. ${stop.body}`));
    },
    [stops],
  );
  useEffect(() => {
    if (!showing) setSaid('');
  }, [showing]);

  // The welcome: once, on the first ready page, when nothing else is happening.
  // 'first' is the one a new install is shown; 'again' is asked for from the help menu.
  const [welcome, setWelcome] = useState<false | 'first' | 'again'>(false);
  useEffect(() => {
    const again = () => setWelcome('again');
    window.addEventListener('scenri:welcome', again);
    return () => window.removeEventListener('scenri:welcome', again);
  }, []);
  const mayWelcome = canWelcome({
    page,
    eligible: guide.eligible,
    learned,
    ready,
    visible,
    paused,
    busy: running > 0 || builds.length > 0,
  });
  useEffect(() => {
    if (!mayWelcome) return;
    const t = window.setTimeout(() => setWelcome((w) => w || 'first'), WELCOME_SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [mayWelcome]);
  useEffect(() => {
    setWelcomeOpen(!!welcome);
  }, [welcome]);
  useEffect(() => () => setWelcomeOpen(false), []);

  const pictures = useMemo(() => welcomeSet(data.showcase).map((e) => sized(e.previewUrl as string)), [data.showcase]);

  const target = showing && current ? firstVisible(current.targets) : null;
  const region = showing && current?.region ? document.querySelector<HTMLElement>(current.region) : null;

  return (
    <>
      <span className="sc-vh" role="status" aria-live="polite">
        {said}
      </span>
      {showing && current && target && tour && (
        <Tour
          stopId={current.id}
          target={target}
          region={region}
          side={current.side}
          index={tour.at}
          total={stops.length}
          title={current.title}
          body={current.body}
          canBack={canGoBack(tour.behind, stops, (s) => !!firstVisible(s.targets))}
          last={last}
          onBack={backStop}
          onNext={next}
          onClose={close}
          onShown={shown}
        />
      )}
      <WelcomeDialog
        open={!!welcome}
        again={welcome === 'again'}
        pictures={pictures}
        onTake={() => {
          if (welcome === 'again') {
            restartTours();
            forgetTourProgress();
          } else learn('welcome');
          setWelcome(false);
          // Create's tour still waits for an engine: it would end on a Generate that cannot run.
          if (page && (page !== 'create' || engineReady)) startTour(page);
        }}
        onSkip={() => {
          // Declining the first welcome turns tours off; declining a restart changes nothing.
          if (welcome === 'first') {
            learn('welcome');
            learn('tours-off');
          }
          setWelcome(false);
        }}
      />
    </>
  );
}

function firstVisible(selectors: readonly string[]): HTMLElement | null {
  for (const s of selectors) {
    for (const el of document.querySelectorAll<HTMLElement>(s)) if (el.getClientRects().length > 0) return el;
  }
  return null;
}

function isDone(s: TourStop): boolean {
  return !!s.doneWhen && !!document.querySelector(s.doneWhen);
}

/** A page is ready when what its tour points at has drawn, never on a skeleton. */
function pageReady(page: TourId, o: { data: ReturnType<typeof useAppData>; productsLoaded: boolean }): boolean {
  if (document.querySelector('[data-variant="skeleton"]')) return false;
  switch (page) {
    case 'home':
      return !!document.querySelector('.sc-create-grid') && o.data.showcaseLoaded;
    case 'create':
      return !!document.querySelector('[data-tour="create.prompt"]');
    case 'products':
      return o.productsLoaded && o.data.demoProductsLoaded;
    case 'presenters':
      return o.data.presentersLoaded;
    case 'scenes':
      return o.data.loaded;
  }
}

/** The curated pictures take a width, the way every tile asks for its own size. */
function sized(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}w=320`;
}
