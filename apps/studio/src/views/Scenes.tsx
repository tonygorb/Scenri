import { useMemo, useState } from 'react';
import { sceneSearchText } from '../displayName.js';
import { useNavigate } from 'react-router';
import { Plus } from '@phosphor-icons/react';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { scenePath } from '../routes.js';
import { useApplyScene } from '../app/useApplyScene.js';
import { favoriteScenes, toggleFavoriteScene } from '../favorites.js';
import { SceneCard, SceneCardSkeleton } from '../layout/SceneCard.js';
import { DensityControl, densitySize, densityWallStyle } from '../layout/DensityControl.js';
import { DENSITY_DEFAULT, normalizeDensity, type DensityCols } from '../layout/masonry.js';
import { LibraryToolbar } from '../layout/library/LibraryToolbar.js';
import { LibrarySearch } from '../layout/library/LibrarySearch.js';
import { FacetFilter } from '../layout/library/FacetFilter.js';
import { LibraryEmpty, LibraryZero } from '../layout/library/LibraryEmpty.js';
import { useLibraryQuery } from '../layout/library/useLibraryQuery.js';
import { useLibraryPage } from '../layout/library/useLibraryPage.js';
import { matchesQuery, facetMode } from '../layout/library/libraryRules.js';
import { ScrollPane } from '../layout/ScrollPane.js';
import { PREF, useLocalPref } from '../prefs.js';

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
  // Taste, per brand, in localStorage — deliberately not in the .brand
  // document. Read once here so every card on the wall shares one answer.
  const [favs, setFavs] = useState<string[]>(() => favoriteScenes(brand.id));
  const star = (id: string) => setFavs(toggleFavoriteScene(brand.id, id));
  const applyScene = useApplyScene();
  const { q, setQ, facets, setFacet, active, clearSearch, clear } = useLibraryQuery(['vertical']);
  const vertical = facets.vertical;
  const searching = q.trim().length > 0;
  const [tile, setTile] = useLocalPref(PREF.wallDensity, DENSITY_DEFAULT);
  const density = normalizeDensity(tile);
  const setDensity = (cols: DensityCols) => setTile(cols);
  const wallStyle = densityWallStyle(density);
  const densityAttr = densitySize(density);

  const openScene = (id: string) => navigate(scenePath(brand, id));

  const byVertical = useMemo(
    () => (vertical ? scenes.filter((s) => s.verticals.includes(vertical)) : scenes),
    [scenes, vertical],
  );

  const filtered = useMemo(
    () =>
      byVertical.filter((s) =>
        // sceneSearchText folds in keywords and pre-rename names, so a short
        // display name never costs a scene its findability.
        matchesQuery(sceneSearchText(s), q),
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
    <ScrollPane>
      <main className="sc-looks" id="main">
        <LibraryToolbar
          title="Scenes"
          filters={<FacetFilter mode={mode} group={facetGroup} />}
          active={active}
          summary={`Showing ${filtered.length} of ${scenes.length}`}
          onClear={clear}
          density={<DensityControl value={density} onChange={setDensity} />}
          search={
            scenes.length >= SEARCH_MIN && (
              <LibrarySearch value={q} onChange={setQ} noun="scenes" total={scenes.length} />
            )
          }
          action={
            <button type="button" className="sc-btn sc-btn-ghost">
              <Plus size={12} /> Create scene
            </button>
          }
        />

        {!loaded && (
          <div className="sc-masonry" data-density data-density-size={densityAttr} style={wallStyle} aria-hidden>
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
                <div className="sc-masonry" data-density data-density-size={densityAttr} style={wallStyle}>
                  {inCollection.map((s) => (
                    <SceneCard
                      key={s.id}
                      scene={s}
                      variant="use"
                      size="grid"
                      onOpen={openScene}
                      onUse={applyScene}
                      starred={favs.includes(s.id)}
                      onStar={star}
                    />
                  ))}
                </div>
              </section>
            );
          })}

        {loaded && !error && searching && visible.length > 0 && (
          <div className="sc-masonry" data-wall data-density data-density-size={densityAttr} style={wallStyle}>
            {visible.map((s) => (
              <SceneCard
                key={s.id}
                scene={s}
                variant="use"
                size="grid"
                onOpen={openScene}
                onUse={applyScene}
                starred={favs.includes(s.id)}
                onStar={star}
              />
            ))}
          </div>
        )}

        {loaded && !error && scenes.length > 0 && filtered.length === 0 && (
          <LibraryZero noun="scenes" q={q} facet={vertical} onClearSearch={clearSearch} onClearAll={clear} />
        )}

        {searching && remaining > 0 && (
          <div className="sc-lib-more">
            <button type="button" className="sc-btn sc-btn-ghost" onClick={showMore}>
              Show {Math.min(remaining, 60)} more
            </button>
          </div>
        )}
      </main>
    </ScrollPane>
  );
}
