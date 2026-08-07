import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { TextField } from '@radix-ui/themes';
import { MagnifyingGlass, Plus } from '@phosphor-icons/react';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { scenePath } from '../routes.js';
import { useApplyScene } from '../app/useApplyScene.js';
import { SceneCard, SceneCardSkeleton } from '../layout/SceneCard.js';
import { LibraryToolbar } from '../layout/library/LibraryToolbar.js';
import { FacetFilter } from '../layout/library/FacetFilter.js';
import { LibraryEmpty } from '../layout/library/LibraryEmpty.js';
import { useLibraryQuery } from '../layout/library/useLibraryQuery.js';
import { useLibraryPage } from '../layout/library/useLibraryPage.js';
import { matchesQuery, facetMode } from '../layout/library/libraryRules.js';

/** Below this, a search box has nothing worth narrowing — the whole set is one screenful. */
const SEARCH_MIN = 8;

/**
 * The scenes library, built on the shared Creative Library shell
 * (docs/product/patterns/creative-library.md). A scene is a photographic
 * setup, so browsing is nothing but the pictures — sections are collections
 * (Studio, Social, Portrait…), real art-direction groupings, not decoration,
 * so they survive the shared shell rather than being flattened into one
 * undifferentiated grid. That sectioning only makes sense while browsing:
 * the moment a search term is active, three matches scattered across five
 * sections reads worse than one flat result list, so search collapses to a
 * single grid instead.
 */
export function ScenesView() {
  const { scenes, collections, verticals, loaded, error, refetch } = useAppData();
  const { brand } = useBrand();
  const navigate = useNavigate();
  const applyScene = useApplyScene();
  const { q, setQ, facets, setFacet, active, clear } = useLibraryQuery(['vertical']);
  const vertical = facets.vertical;
  const searching = q.trim().length > 0;

  const openScene = (id: string) => navigate(scenePath(brand, id));

  const byVertical = useMemo(
    () => (vertical ? scenes.filter((s) => s.verticals.includes(vertical)) : scenes),
    [scenes, vertical],
  );

  const filtered = useMemo(
    () =>
      byVertical.filter((s) =>
        matchesQuery([s.name, s.description, s.lighting, s.subject, ...s.collections, ...s.verticals].join(' '), q),
      ),
    [byVertical, q],
  );

  const { visible, remaining, showMore } = useLibraryPage(filtered, `${vertical ?? ''}|${q}`);

  const countFor = (v: string) => scenes.filter((s) => s.verticals.includes(v)).length;
  const mode = facetMode(verticals.length);

  const facetGroup = {
    key: 'vertical',
    label: 'Vertical',
    everyLabel: 'Every scene',
    everyCount: scenes.length,
    selected: vertical,
    onSelect: (v: string | null) => setFacet('vertical', v),
    options: verticals.map((v) => ({ value: v, label: v, count: countFor(v) })),
  };

  return (
    <div className="sc-home">
      <main className="sc-looks" id="main">
        <LibraryToolbar
          title="Scenes"
          filters={<FacetFilter mode={mode} group={facetGroup} />}
          active={active}
          summary={`Showing ${filtered.length} of ${scenes.length}`}
          onClear={clear}
          search={
            scenes.length >= SEARCH_MIN && (
              <TextField.Root
                size="2"
                style={{ width: 220 }}
                placeholder={`Search ${scenes.length} scenes`}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              >
                <TextField.Slot>
                  <MagnifyingGlass size={14} />
                </TextField.Slot>
              </TextField.Root>
            )
          }
          action={
            <button type="button" className="sc-btn sc-btn-ghost">
              <Plus size={12} /> Create scene
            </button>
          }
        />

        {!loaded && (
          <div className="sc-masonry" aria-hidden>
            <SceneCardSkeleton size="grid" count={8} />
          </div>
        )}

        {loaded && error && (
          <LibraryEmpty
            shape="error"
            title="Couldn't load this library"
            body="Something went wrong reaching the catalog."
            onRetry={() => refetch()}
          />
        )}

        {loaded &&
          !error &&
          !searching &&
          collections.map((c) => {
            const inCollection = byVertical.filter((s) => s.collections.includes(c));
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

        {loaded && !error && searching && visible.length > 0 && (
          <div className="sc-masonry">
            {visible.map((s) => (
              <SceneCard key={s.id} scene={s} variant="use" size="grid" onOpen={openScene} onUse={applyScene} />
            ))}
          </div>
        )}

        {loaded && !error && scenes.length > 0 && filtered.length === 0 && (
          <LibraryEmpty
            shape="zero"
            body="No scenes match these filters."
            action={
              <button type="button" className="sc-lib-clear" onClick={clear}>
                Clear filters
              </button>
            }
          />
        )}

        {searching && remaining > 0 && (
          <div className="sc-lib-more">
            <button type="button" className="sc-btn sc-btn-ghost" onClick={showMore}>
              Show {Math.min(remaining, 60)} more
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
