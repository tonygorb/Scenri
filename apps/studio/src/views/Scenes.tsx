import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useAppData, useFilterParam } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { scenePath } from '../routes.js';
import { useApplyScene } from '../app/useApplyScene.js';
import { SceneCard, SceneCardSkeleton } from '../layout/SceneCard.js';

/**
 * The scenes library. A scene is a photographic setup, so the browsing surface
 * is nothing but the pictures: name, light and the Use action wait for hover.
 * Sections are collections; the sticky rail filters by vertical.
 */
export function ScenesView() {
  const { scenes, collections, verticals, loaded, error, refetch } = useAppData();
  const { brand } = useBrand();
  const navigate = useNavigate();
  const applyScene = useApplyScene();
  const [verticalParam, setVertical] = useFilterParam('vertical');
  const vertical = verticalParam || null;

  const openScene = (id: string) => navigate(scenePath(brand, id));

  const shown = useMemo(
    () => (vertical ? scenes.filter((s) => s.verticals.includes(vertical)) : scenes),
    [scenes, vertical],
  );
  const countFor = (v: string) => scenes.filter((s) => s.verticals.includes(v)).length;

  return (
    <div className="sc-home">
      <main className="sc-looks" id="main">
        <div className="sc-verticals" role="tablist" aria-label="Verticals">
          <button
            type="button"
            role="tab"
            aria-selected={!vertical}
            data-on={!vertical ? '' : undefined}
            onClick={() => setVertical(null)}
          >
            Every scene <span className="sc-vcount">{scenes.length}</span>
          </button>
          {verticals.map((v) => (
            <button
              type="button"
              key={v}
              role="tab"
              aria-selected={vertical === v}
              data-on={vertical === v ? '' : undefined}
              onClick={() => setVertical(v)}
            >
              {v} <span className="sc-vcount">{countFor(v)}</span>
            </button>
          ))}
        </div>

        {!loaded && (
          <div className="sc-masonry" aria-hidden>
            <SceneCardSkeleton size="grid" count={8} />
          </div>
        )}

        {loaded && error && (
          <>
            <h1>Couldn't load this scene</h1>
            <p className="sc-lookpage-lede">Something went wrong reaching the catalog.</p>
            <div className="sc-lookpage-acts">
              <button type="button" className="sc-btn sc-btn-primary" onClick={() => refetch()}>
                Retry
              </button>
            </div>
          </>
        )}

        {loaded &&
          !error &&
          collections.map((c) => {
            const inCollection = shown.filter((s) => s.collections.includes(c));
            if (!inCollection.length) return null;
            return (
              <section className="sc-coll" key={c}>
                <h2>{c}</h2>
                <div className="sc-coll-names">
                  {inCollection.map((s) => (
                    <button type="button" key={s.id} onClick={() => openScene(s.id)}>
                      {s.name}
                    </button>
                  ))}
                </div>
                <div className="sc-masonry">
                  {inCollection.map((s) => (
                    <SceneCard key={s.id} scene={s} variant="use" size="grid" onOpen={openScene} onUse={applyScene} />
                  ))}
                </div>
              </section>
            );
          })}

        {loaded && !error && !shown.length && scenes.length > 0 && (
          <p className="sc-looks-empty">No scene carries that vertical yet.</p>
        )}
      </main>
    </div>
  );
}
