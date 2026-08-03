import { useEffect, useMemo, useState } from 'react';
import { api, type EngineInfo, type Look } from '../api.js';
import { TopBar, Wordmark, type NavItem } from '../layout/TopBar.js';

/**
 * The looks library. A look is a photographic setup, so the browsing surface
 * is nothing but the pictures: name, light and the Use action wait for hover.
 * Sections are collections; the sticky rail filters by vertical.
 */
export function LooksView({
  engines,
  nav,
  brandPill,
  settingsButton,
  onOpenLook,
  onUseLook,
}: {
  engines: EngineInfo[];
  nav: NavItem[];
  brandPill?: React.ReactNode;
  settingsButton: React.ReactNode;
  onOpenLook: (id: string) => void;
  onUseLook: (id: string) => void;
}) {
  const [looks, setLooks] = useState<Look[]>([]);
  const [collections, setCollections] = useState<string[]>([]);
  const [verticals, setVerticals] = useState<string[]>([]);
  const [vertical, setVertical] = useState<string | null>(null);

  useEffect(() => {
    void api
      .looks()
      .then((r) => {
        setLooks(r.looks);
        setCollections(r.collections);
        setVerticals(r.verticals);
      })
      .catch(() => {});
  }, []);

  const shown = useMemo(
    () => (vertical ? looks.filter((l) => l.verticals.includes(vertical)) : looks),
    [looks, vertical],
  );
  const countFor = (v: string) => looks.filter((l) => l.verticals.includes(v)).length;

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
                  <button type="button" key={l.id} onClick={() => onOpenLook(l.id)}>
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
                    onClick={() => onOpenLook(l.id)}
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
                        onUseLook(l.id);
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
