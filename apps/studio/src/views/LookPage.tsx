import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { api, imgUrl, type Look } from '../api.js';
import { useAppData, useFilterParam } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { brandPath } from '../app/brandPath.js';
import { useApplyLook } from '../app/useApplyLook.js';
import { favoriteLooks } from '../favorites.js';
import { LookCard } from '../layout/LookCard.js';

/**
 * One look. The reference frames say what the light is; they are ours and are
 * deliberately not clickable. Everything below is yours: what you made with it,
 * and which looks sit nearest by light.
 */
export function LookPage() {
  const { lookId = '' } = useParams();
  const { looks, loaded, error, refetch } = useAppData();
  // one ask upstairs holds the whole brand now, so this page no longer walks
  // twenty project trees to answer "what did this look actually produce"
  const { brand, nodes: shots } = useBrand();
  const navigate = useNavigate();
  const applyLook = useApplyLook();
  const brandId = brand.id;
  const base = brandPath(brand);
  const [refs, setRefs] = useState<string[]>([]);
  const [allParam, setOpenAll] = useFilterParam('all');
  const openAll = allParam === '1';

  const openLook = (id: string) => navigate(`${base}/looks/${id}`);

  const look = looks.find((l) => l.id === lookId);

  // One ask for the whole set. Probing slot by slot filled the console with
  // 404s for every look that has no set yet.
  useEffect(() => {
    let alive = true;
    setRefs([]);
    void api
      .lookFrames(lookId)
      .then((r) => {
        if (alive) setRefs(r.frames);
      })
      .catch(() => {
        if (alive) setRefs([]);
      });
    return () => {
      alive = false;
    };
  }, [lookId]);

  /** Shots whose brief carried this look, newest first. */
  const made = useMemo(
    () =>
      shots
        .filter(
          (s) =>
            s.status === 'done' &&
            s.images.length > 0 &&
            (s.brief?.tokens ?? []).some((t: any) => t?.t === 'template' && t.id === lookId),
        )
        .slice(-12)
        .reverse(),
    [shots, lookId],
  );

  const near = useMemo(() => {
    if (!look) return [];
    const others = looks.filter((l) => l.id !== look.id);
    // nearest by light: same lighting phrase first, then the same collection
    return others.sort((a, b) => score(b) - score(a)).slice(0, 8);
    function score(l: Look) {
      const sameLight = l.lighting
        .split(/[ ,]+/)
        .some((w) => w.length > 3 && look!.lighting.toLowerCase().includes(w.toLowerCase()));
      const sameCollection = l.collections.some((c) => look!.collections.includes(c));
      return (sameLight ? 2 : 0) + (sameCollection ? 1 : 0);
    }
  }, [looks, look]);

  /** Favorites-first, same ordering rule as Home's shelf and Create's FirstRun. */
  const recovery = useMemo(() => {
    if (look || !loaded || error) return [];
    const favs = favoriteLooks(brandId);
    return [...looks].sort((a, b) => Number(favs.includes(b.id)) - Number(favs.includes(a.id))).slice(0, 6);
  }, [look, loaded, error, looks, brandId]);

  if (!loaded) {
    return (
      <div className="sc-home">
        <main className="sc-lookpage" id="main">
          <div className="sc-tplrow" aria-hidden />
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="sc-home">
        <main className="sc-lookpage" id="main">
          <h1>Couldn't load this look</h1>
          <p className="sc-lookpage-lede">Something went wrong reaching the catalog.</p>
          <div className="sc-lookpage-acts">
            <button type="button" className="sc-btn sc-btn-primary" onClick={() => refetch()}>
              Retry
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (!look) {
    return (
      <div className="sc-home">
        <main className="sc-lookpage" id="main">
          <h1>This look isn't here anymore</h1>
          <p className="sc-lookpage-lede">It may have been removed from the catalog, or the link is out of date.</p>
          <div className="sc-lookpage-acts">
            <button
              type="button"
              className="sc-btn sc-btn-primary"
              onClick={() => navigate(`${base}/create?compose=1`)}
            >
              Start from scratch
            </button>
            <button type="button" className="sc-btn sc-btn-ghost" onClick={() => navigate(`${base}/looks`)}>
              Browse all looks
            </button>
          </div>
          {recovery.length > 0 && (
            <Slider label="You might like">
              {recovery.map((l) => (
                <LookCard key={l.id} look={l} variant="navigate" size="slider" onOpen={openLook} />
              ))}
            </Slider>
          )}
        </main>
      </div>
    );
  }

  const visibleRefs = openAll ? refs : refs.slice(0, 3);
  const frames = refs.length ? visibleRefs : look.previewUrl ? [look.previewUrl] : [];

  return (
    <div className="sc-home">
      <main className="sc-lookpage" id="main">
        <div className="sc-lookpage-crumb">
          <button type="button" onClick={() => navigate(`${base}/looks`)}>
            Looks
          </button>
          <span>/</span>
          <span>{look.collections[0]}</span>
        </div>

        <h1>{look.name}</h1>
        <p className="sc-lookpage-lede">{look.description}</p>
        <p className="sc-lookpage-facts">
          {look.lighting} · {look.subject === 'either' ? 'product or person' : `for a ${look.subject}`} ·{' '}
          {look.width === look.height ? 'square by default' : `${look.width}×${look.height} by default`}
        </p>
        <div className="sc-lookpage-acts">
          <button type="button" className="sc-btn sc-btn-primary" onClick={() => void applyLook(look.id)}>
            Use this look
          </button>
        </div>

        {frames.length > 0 && (
          <>
            <div className="sc-lookpage-refs">
              {frames.map((src) => (
                <div className="sc-lookpage-ref" key={src}>
                  <img src={src} alt="" loading="lazy" />
                </div>
              ))}
            </div>
            {refs.length > 3 && (
              <button type="button" className="sc-lookpage-expand" onClick={() => setOpenAll(openAll ? null : '1')}>
                {openAll ? 'Enough, close it' : 'See the whole set'}
              </button>
            )}
          </>
        )}

        {made.length > 0 && (
          <Slider label="Your shots in this look">
            {made.map((s) => (
              <button type="button" className="sc-lookcard" key={s.id} title={s.prompt}>
                <img src={imgUrl(s.images[0])} alt="" loading="lazy" />
              </button>
            ))}
          </Slider>
        )}

        {near.length > 0 && (
          <Slider label="Other looks, similar light">
            {near.map((l) => (
              <LookCard key={l.id} look={l} variant="navigate" size="slider" onOpen={openLook} />
            ))}
          </Slider>
        )}
      </main>
    </div>
  );
}

/** A row that keeps going: the run is cloned once and the seam is invisible. */
function Slider({ label, children }: { label: string; children: React.ReactNode }) {
  const track = useRef<HTMLDivElement>(null);
  const busy = useRef(false);

  const slide = (dir: 1 | -1) => {
    const t = track.current;
    if (!t?.firstElementChild) return;
    const step = (t.firstElementChild as HTMLElement).getBoundingClientRect().width + 12;
    const run = t.scrollWidth / 2;
    if (dir < 0 && t.scrollLeft < step) t.scrollLeft += run; // hop into the clone first
    const from = t.scrollLeft,
      delta = dir * step,
      start = performance.now();
    busy.current = true;
    const frame = (now: number) => {
      const p = Math.min(1, (now - start) / 420);
      t.scrollLeft = from + delta * (1 - (1 - p) ** 3);
      if (p < 1) requestAnimationFrame(frame);
      else {
        busy.current = false;
        if (t.scrollLeft >= run) t.scrollLeft -= run;
      }
    };
    requestAnimationFrame(frame);
  };

  return (
    <section className="sc-lookpage-band">
      <p className="sc-bandhead">{label}</p>
      <div className="sc-slider">
        <button type="button" className="sc-slider-arrow prev" aria-label="Previous" onClick={() => slide(-1)}>
          <CaretLeft size={13} weight="bold" />
        </button>
        <button type="button" className="sc-slider-arrow next" aria-label="Next" onClick={() => slide(1)}>
          <CaretRight size={13} weight="bold" />
        </button>
        <div className="sc-slider-track" ref={track}>
          {children}
          {children}
        </div>
      </div>
    </section>
  );
}
