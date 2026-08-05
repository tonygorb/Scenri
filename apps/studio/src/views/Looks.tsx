import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useAppData, useFilterParam } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { brandPath } from '../app/brandPath.js';
import { useApplyLook } from '../app/useApplyLook.js';

/**
 * The looks library. A look is a photographic setup, so the browsing surface
 * is nothing but the pictures: name, light and the Use action wait for hover.
 * Sections are collections; the sticky rail filters by vertical.
 */
export function LooksView() {
  const { looks, collections, verticals, loaded } = useAppData();
  const { brand } = useBrand();
  const navigate = useNavigate();
  const applyLook = useApplyLook();
  const [verticalParam, setVertical] = useFilterParam('vertical');
  const vertical = verticalParam || null;

  const openLook = (id: string) => navigate(brandPath(brand, `/looks/${id}`));

  const shown = useMemo(
    () => (vertical ? looks.filter((l) => l.verticals.includes(vertical)) : looks),
    [looks, vertical],
  );
  const countFor = (v: string) => looks.filter((l) => l.verticals.includes(v)).length;

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
            Every look <span className="sc-vcount">{looks.length}</span>
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

        {!loaded && <div className="sc-tplrow" aria-hidden />}

        {loaded &&
          collections.map((c) => {
            const inCollection = shown.filter((l) => l.collections.includes(c));
            if (!inCollection.length) return null;
            return (
              <section className="sc-coll" key={c}>
                <h2>{c}</h2>
                <div className="sc-coll-names">
                  {inCollection.map((l) => (
                    <button type="button" key={l.id} onClick={() => openLook(l.id)}>
                      {l.name}
                    </button>
                  ))}
                </div>
                <div className="sc-masonry">
                  {inCollection.map((l) => (
                    <button
                      type="button"
                      key={l.id}
                      className="sc-lookcard"
                      onClick={() => openLook(l.id)}
                      title={`${l.name} — ${l.lighting}`}
                    >
                      {l.previewUrl ? (
                        <img src={l.previewUrl} alt={l.name} loading="lazy" />
                      ) : (
                        <span className="sc-lookcard-blank" />
                      )}
                      <span className="sc-lookveil" />
                      <span
                        className="sc-lookuse"
                        onClick={(e) => {
                          e.stopPropagation();
                          void applyLook(l.id);
                        }}
                      >
                        Use this look
                      </span>
                      <span className="sc-lookcap">
                        <b>{l.name}</b>
                        <span>{l.lighting}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}

        {loaded && !shown.length && looks.length > 0 && (
          <p className="sc-looks-empty">No look carries that vertical yet.</p>
        )}
      </main>
    </div>
  );
}
