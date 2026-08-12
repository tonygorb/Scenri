import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api } from '../api.js';
import { useAppData, useFilterParam } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { presenterPath, presentersPath, shotPath } from '../routes.js';
import { useApplyPresenter } from '../app/useApplyPresenter.js';
import { PresenterCard } from '../layout/PresenterCard.js';
import { EmptyRefFrame, RefFrame, ShotThumb, Slider } from '../layout/ReferenceGallery.js';
import { ScrollPane } from '../layout/ScrollPane.js';

/** Every presenter ships exactly 4 frames (front/left/right/back), so this never triggers "See the whole set" — kept as a cap rather than a magic 4 in the slice call below in case a future presenter ships more. */
const FRONT_ANGLES = 4;

/**
 * One presenter. The reference set says who they are — face, profile, hair,
 * build — from the same controlled setup every time; it is ours and is
 * deliberately not clickable. Everything below is yours: what you have made
 * with them so far.
 */
export function PresenterPage() {
  const { presenterId = '' } = useParams();
  const { presenters, presentersLoaded, presentersError, refetchPresenters } = useAppData();
  const { brand, nodes: shots } = useBrand();
  const navigate = useNavigate();
  const applyPresenter = useApplyPresenter();
  const [refs, setRefs] = useState<string[]>([]);
  const [allParam, setOpenAll] = useFilterParam('all');
  const openAll = allParam === '1';

  const presenter = presenters.find((p) => p.id === presenterId);

  useEffect(() => {
    let alive = true;
    setRefs([]);
    void api
      .presenterFrames(presenterId)
      .then((r) => {
        if (alive) setRefs(r.frames);
      })
      .catch(() => {
        if (alive) setRefs([]);
      });
    return () => {
      alive = false;
    };
  }, [presenterId]);

  // Older brands may still have a roster copy from before presenters attached
  // straight from the catalog — its shots used the copy's own id, not the
  // presenter's, so both are matched here to keep that history visible.
  const roster: any[] = (brand.json?.characters ?? []) as any[];
  const inRoster = roster.find((c) => c.presenterId === presenterId);

  /** Shots whose brief attached this presenter, directly or via an old roster copy. */
  const made = useMemo(
    () =>
      shots
        .filter(
          (s) =>
            s.status === 'done' &&
            s.images.length > 0 &&
            (s.brief?.tokens ?? []).some(
              (t: any) => t?.t === 'character' && (t.id === presenterId || t.id === inRoster?.id),
            ),
        )
        .slice(-12)
        .reverse(),
    [shots, presenterId, inRoster],
  );

  if (!presentersLoaded) {
    return (
      <ScrollPane>
        <main className="sc-lookpage" id="main">
          <div className="sc-tplrow" aria-hidden />
        </main>
      </ScrollPane>
    );
  }

  if (presentersError) {
    return (
      <ScrollPane>
        <main className="sc-lookpage" id="main">
          <h1>Couldn't load this presenter</h1>
          <p className="sc-lookpage-lede">Something went wrong reaching the catalog.</p>
          <div className="sc-lookpage-acts">
            <button type="button" className="sc-btn sc-btn-primary" onClick={() => refetchPresenters()}>
              Retry
            </button>
          </div>
        </main>
      </ScrollPane>
    );
  }

  if (!presenter) {
    return (
      <ScrollPane>
        <main className="sc-lookpage" id="main">
          <h1>This presenter isn't here anymore</h1>
          <p className="sc-lookpage-lede">They may have been removed from the catalog, or the link is out of date.</p>
          <div className="sc-lookpage-acts">
            <button type="button" className="sc-btn sc-btn-primary" onClick={() => navigate(presentersPath(brand))}>
              Browse presenters
            </button>
          </div>
        </main>
      </ScrollPane>
    );
  }

  const visibleRefs = openAll ? refs : refs.slice(0, FRONT_ANGLES);
  const frames = refs.length ? visibleRefs : presenter.previewUrl ? [presenter.previewUrl] : [];
  const others = presenters.filter((p) => p.id !== presenter.id).slice(0, 8);
  const avatarSrc = presenter.previewUrl ?? refs[0] ?? null;

  return (
    <ScrollPane>
      <main className="sc-lookpage sc-presenterpage" id="main">
        <div className="sc-lookpage-crumb">
          <button type="button" onClick={() => navigate(presentersPath(brand))}>
            Presenters
          </button>
          <span>/</span>
          <span>{presenter.suitableStyles[0] ?? presenter.presentation}</span>
        </div>

        {avatarSrc ? (
          <div className="sc-presenterpage-avatar" aria-hidden>
            <img src={avatarSrc} alt="" />
          </div>
        ) : null}

        <h1>{presenter.name}</h1>
        <p className="sc-lookpage-lede">{presenter.descriptor}</p>
        <p className="sc-lookpage-facts">
          {presenter.ageRange} · {presenter.hair} · {presenter.suitableCategories.join(', ')}
        </p>
        <div className="sc-lookpage-acts">
          <button type="button" className="sc-btn sc-btn-primary" onClick={() => applyPresenter(presenterId)}>
            Use in a brief
          </button>
        </div>

        {frames.length > 0 ? (
          <>
            <div className="sc-lookpage-refs">
              {frames.map((src) => (
                <RefFrame key={src} src={src} />
              ))}
            </div>
            {refs.length > FRONT_ANGLES && (
              <button type="button" className="sc-lookpage-expand" onClick={() => setOpenAll(openAll ? null : '1')}>
                {openAll ? 'Enough, close it' : 'See the whole set'}
              </button>
            )}
          </>
        ) : (
          <EmptyRefFrame />
        )}

        {made.length > 0 && (
          <Slider label={`Shots featuring ${presenter.name}`}>
            {made.map((s) => (
              <ShotThumb key={s.id} node={s} onClick={() => navigate(shotPath(brand, null, s.id))} />
            ))}
          </Slider>
        )}

        {others.length > 0 && (
          <Slider label="Other presenters">
            {others.map((p) => (
              <PresenterCard
                key={p.id}
                presenter={p}
                variant="navigate"
                size="slider"
                onOpen={(id) => navigate(presenterPath(brand, id))}
              />
            ))}
          </Slider>
        )}
      </main>
    </ScrollPane>
  );
}
