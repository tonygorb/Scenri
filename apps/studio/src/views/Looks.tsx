import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useAppData, useFilterParam } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { useApplyLook } from '../app/useApplyLook.js';
import { TopBar, Wordmark } from '../layout/TopBar.js';
import { SettingsButton } from './SettingsDialog.js';

/**
 * The looks library. A look is a photographic setup, so the browsing surface
 * is nothing but the pictures: name, light and the Use action wait for hover.
 * Sections are collections; the sticky rail filters by vertical.
 */
export function LooksView() {
  const { looks, collections, verticals } = useAppData();
  const { brand } = useBrand();
  const navigate = useNavigate();
  const applyLook = useApplyLook();
  const [verticalParam, setVertical] = useFilterParam('vertical');
  const vertical = verticalParam || null;

  const openLook = (id: string) => navigate(`/b/${brand.id}/looks/${id}`);

  const shown = useMemo(
    () => (vertical ? looks.filter((l) => l.verticals.includes(vertical)) : looks),
    [looks, vertical],
  );
  const countFor = (v: string) => looks.filter((l) => l.verticals.includes(v)).length;

  return (
    <div className="bt-home">
      <TopBar left={<Wordmark />} right={<SettingsButton />} />

      <main className="bt-looks">
        <div className="bt-verticals" role="tablist" aria-label="Verticals">
          <button
            type="button"
            role="tab"
            aria-selected={!vertical}
            data-on={!vertical ? '' : undefined}
            onClick={() => setVertical(null)}
          >
            Every look <span className="bt-vcount">{looks.length}</span>
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
              {v} <span className="bt-vcount">{countFor(v)}</span>
            </button>
          ))}
        </div>

        {collections.map((c) => {
          const inCollection = shown.filter((l) => l.collections.includes(c));
          if (!inCollection.length) return null;
          return (
            <section className="bt-coll" key={c}>
              <h2>{c}</h2>
              <div className="bt-coll-names">
                {inCollection.map((l) => (
                  <button type="button" key={l.id} onClick={() => openLook(l.id)}>
                    {l.name}
                  </button>
                ))}
              </div>
              <div className="bt-masonry">
                {inCollection.map((l) => (
                  <button
                    type="button"
                    key={l.id}
                    className="bt-lookcard"
                    onClick={() => openLook(l.id)}
                    title={`${l.name} — ${l.lighting}`}
                  >
                    {l.previewUrl ? (
                      <img src={l.previewUrl} alt={l.name} loading="lazy" />
                    ) : (
                      <span className="bt-lookcard-blank" />
                    )}
                    <span className="bt-lookveil" />
                    <span
                      className="bt-lookuse"
                      onClick={(e) => {
                        e.stopPropagation();
                        void applyLook(l.id);
                      }}
                    >
                      Use this look
                    </span>
                    <span className="bt-lookcap">
                      <b>{l.name}</b>
                      <span>{l.lighting}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}

        {!shown.length && looks.length > 0 && <p className="bt-looks-empty">No look carries that vertical yet.</p>}
      </main>
    </div>
  );
}
