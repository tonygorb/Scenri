import { useEffect, useMemo, useRef, useState } from 'react';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { api, imgUrl, type EngineInfo, type Look, type TreeNode } from '../api.js';
import { TopBar, Wordmark, type NavItem } from '../layout/TopBar.js';

/**
 * One look. The reference frames say what the light is; they are ours and are
 * deliberately not clickable. Everything below is yours: what you made with it,
 * and which looks sit nearest by light.
 */
export function LookPage({
  lookId,
  brandId,
  engines,
  nav,
  brandPill,
  settingsButton,
  onOpenLook,
  onUseLook,
  onBack,
}: {
  lookId: string;
  brandId: string | null;
  engines: EngineInfo[];
  nav: NavItem[];
  brandPill?: React.ReactNode;
  settingsButton: React.ReactNode;
  onOpenLook: (id: string) => void;
  onUseLook: (id: string) => void;
  onBack: () => void;
}) {
  const [looks, setLooks] = useState<Look[]>([]);
  const [shots, setShots] = useState<TreeNode[]>([]);
  const [refs, setRefs] = useState<string[]>([]);
  const [openAll, setOpenAll] = useState(false);

  useEffect(() => {
    void api
      .looks()
      .then((r) => setLooks(r.looks))
      .catch(() => {});
  }, []);

  // Shots live per project, so gather them: this page is the only place that
  // asks "what did this look actually produce", across the whole brand.
  useEffect(() => {
    if (!brandId) {
      setShots([]);
      return;
    }
    let alive = true;
    void api
      .projects(brandId)
      // newest first, or a cap silently drops the work you just did
      .then((ps) => [...ps].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20))
      .then((ps) => Promise.all(ps.map((p) => api.tree(p.id).catch(() => null))))
      .then((trees) => {
        if (alive) setShots(trees.flatMap((t) => t?.nodes ?? []));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [brandId]);

  const look = looks.find((l) => l.id === lookId);

  // One ask for the whole set. Probing slot by slot filled the console with
  // 404s for every look that has no set yet.
  useEffect(() => {
    let alive = true;
    setRefs([]);
    setOpenAll(false);
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

  if (!look)
    return (
      <div className="bt-home">
        <TopBar
          left={
            <>
              <Wordmark />
              {brandPill}
            </>
          }
          nav={nav}
          engines={engines}
          right={settingsButton}
        />
      </div>
    );

  const visibleRefs = openAll ? refs : refs.slice(0, 3);
  const frames = refs.length ? visibleRefs : look.previewUrl ? [look.previewUrl] : [];

  return (
    <div className="bt-home">
      <TopBar
        left={
          <>
            <Wordmark />
            {brandPill}
          </>
        }
        nav={nav}
        engines={engines}
        right={settingsButton}
      />

      <main className="bt-lookpage">
        <div className="bt-lookpage-crumb">
          <button type="button" onClick={onBack}>
            Looks
          </button>
          <span>/</span>
          <span>{look.collections[0]}</span>
        </div>

        <h1>{look.name}</h1>
        <p className="bt-lookpage-lede">{look.description}</p>
        <p className="bt-lookpage-facts">
          {look.lighting} · {look.subject === 'either' ? 'product or person' : `for a ${look.subject}`} ·{' '}
          {look.width === look.height ? 'square by default' : `${look.width}×${look.height} by default`}
        </p>
        <div className="bt-lookpage-acts">
          <button type="button" className="bt-btn bt-btn-primary" onClick={() => onUseLook(look.id)}>
            Use this look
          </button>
        </div>

        {frames.length > 0 && (
          <>
            <div className="bt-lookpage-refs">
              {frames.map((src) => (
                <div className="bt-lookpage-ref" key={src}>
                  <img src={src} alt="" loading="lazy" />
                </div>
              ))}
            </div>
            {refs.length > 3 && (
              <button type="button" className="bt-lookpage-expand" onClick={() => setOpenAll((o) => !o)}>
                {openAll ? 'Enough, close it' : 'See the whole set'}
              </button>
            )}
          </>
        )}

        {made.length > 0 && (
          <Slider label="Your shots in this look">
            {made.map((s) => (
              <button type="button" className="bt-lookcard" key={s.id} title={s.prompt}>
                <img src={imgUrl(s.images[0])} alt="" loading="lazy" />
              </button>
            ))}
          </Slider>
        )}

        {near.length > 0 && (
          <Slider label="Other looks, similar light">
            {near.map((l) => (
              <figure key={l.id}>
                <button type="button" className="bt-lookcard bt-lookcard-plain" onClick={() => onOpenLook(l.id)}>
                  {l.previewUrl ? (
                    <img src={l.previewUrl} alt={l.name} loading="lazy" />
                  ) : (
                    <span className="bt-lookcard-blank" />
                  )}
                </button>
                <figcaption>
                  <b>{l.name}</b>
                  <span>{l.lighting}</span>
                </figcaption>
              </figure>
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
    <section className="bt-lookpage-band">
      <p className="bt-bandhead">{label}</p>
      <div className="bt-slider">
        <button type="button" className="bt-slider-arrow prev" aria-label="Previous" onClick={() => slide(-1)}>
          <CaretLeft size={13} weight="bold" />
        </button>
        <button type="button" className="bt-slider-arrow next" aria-label="Next" onClick={() => slide(1)}>
          <CaretRight size={13} weight="bold" />
        </button>
        <div className="bt-slider-track" ref={track}>
          {children}
          {children}
        </div>
      </div>
    </section>
  );
}
