import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { useTaskCenter } from '../app/TaskCenter.js';
import { learn, useGuide } from '../guide.js';
import { endTour, leaveTour, nextStop, settleStop, startTour, tourSnapshot, useTour } from '../tourStore.js';
import {
  PAUSE_SELECTOR,
  canAutoStart,
  canWelcome,
  firstOpenStop,
  tourConcept,
  tourFor,
  type TourId,
  type TourStop,
} from '../tours.js';
import { useHoverNone } from '../useMediaQuery.js';
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
  const { brand, products, productsLoaded } = useBrand();
  const { running, builds } = useTaskCenter();
  const [params] = useSearchParams();
  const touch = useHoverNone();
  const ownsProducts = products.length > 0 || ((brand.json as { products?: unknown[] })?.products?.length ?? 0) > 0;

  const shownPage = tour?.page ?? page;
  const stops = useMemo(
    () => (shownPage ? tourFor(shownPage, { touch, ownsProducts }) : []),
    [shownPage, touch, ownsProducts],
  );

  const learned = guide.learned;
  const watching =
    !!tour ||
    (!!page &&
      guide.eligible &&
      (!learned.includes('welcome') || (!learned.includes('tours-off') && !learned.includes(tourConcept(page)))));

  // One observer, only while something may still show: a stop's target
  // drawing, a dialog opening over it, the composer publishing a step.
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
      attributeFilter: ['data-ingredients', 'data-words', 'data-variant'],
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
  // is usually doing that step, so it resumes past it.
  useEffect(() => {
    const t = tourSnapshot();
    if (!t || t.page === page) return;
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

  // Settle on the first stop not yet taken, once the page has drawn.
  const stopAt = tour && tour.page === page && ready && !paused ? openStop(stops, tour.at) : null;
  useEffect(() => {
    if (!tour || stopAt === null) return;
    if (stopAt >= stops.length) endTour(tour.page, { skipped: false });
    else settleStop(stopAt, stops[stopAt].id);
  }, [tour, stopAt, stops]);

  // Opening the step's own dialog is doing the step.
  const current = tour && tour.stopId ? stops[tour.at] : null;
  useEffect(() => {
    if (current?.advanceOnParam && params.has(current.advanceOnParam)) nextStop();
  }, [current, params]);

  const skip = () => tour && endTour(tour.page, { skipped: true });

  // Escape skips, unless something else is taking the key: a field, a menu, a dialog.
  useEffect(() => {
    if (!current || paused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const el = document.activeElement as HTMLElement | null;
      if (el?.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="listbox"]')) return;
      if (el?.closest('[role="dialog"]:not(.sc-tour)')) return;
      skip();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // Announced once per stop, into a region that was already there.
  const [said, setSaid] = useState('');
  const showing = !!current && !paused;
  useEffect(() => {
    setSaid('');
    if (!showing || !current) return;
    const f = requestAnimationFrame(() =>
      setSaid(`Tour, ${(tour?.at ?? 0) + 1} of ${stops.length}. ${current.title}. ${current.body}`),
    );
    return () => cancelAnimationFrame(f);
  }, [showing, current?.id]);

  // The welcome: once, on the first ready page, when nothing else is happening.
  const [welcome, setWelcome] = useState(false);
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
    const t = window.setTimeout(() => setWelcome(true), WELCOME_SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [mayWelcome]);

  const pictures = useMemo(
    () =>
      data.showcase
        .filter((e) => e.previewUrl)
        .slice(0, 3)
        .map((e) => sized(e.previewUrl as string)),
    [data.showcase],
  );

  const target = showing && current ? firstVisible(current.targets) : null;
  const clearOf = showing && current?.clearOf ? document.querySelector<HTMLElement>(current.clearOf) : null;

  return (
    <>
      <span className="sc-vh" role="status" aria-live="polite">
        {said}
      </span>
      {showing && current && target && tour && (
        <Tour
          target={target}
          clearOf={clearOf}
          index={tour.at}
          total={stops.length}
          title={current.title}
          body={current.body}
          onNext={() => (tour.at >= stops.length - 1 ? endTour(tour.page, { skipped: false }) : nextStop())}
          onSkip={skip}
        />
      )}
      <WelcomeDialog
        open={welcome}
        pictures={pictures}
        onTake={() => {
          learn('welcome');
          setWelcome(false);
          if (page) startTour(page);
        }}
        onSkip={() => {
          learn('welcome');
          learn('tours-off');
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

function openStop(stops: readonly TourStop[], from: number): number {
  return firstOpenStop(
    stops,
    from,
    (s) => !!s.doneWhen && !!document.querySelector(s.doneWhen),
    (s) => !!firstVisible(s.targets),
  );
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
