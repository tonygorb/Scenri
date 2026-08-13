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
import { matchesQuery, type FacetMode } from '../layout/library/libraryRules.js';
import { ScrollPane } from '../layout/ScrollPane.js';
import { PREF, useLocalPref } from '../prefs.js';

/** Below this, a search box has nothing worth narrowing — the whole set is one screenful. */
const SEARCH_MIN = 8;

/**
 * The rail's value for the Favorites tab. Taste is a different axis from
 * vertical, so it rides its own `?starred=1` param and this string never
 * reaches the URL — which is why it can't collide with a real vertical name.
 */
const STARRED = '__starred';

/**
 * The scenes library, built on the shared Creative Library shell
 * (docs/product/patterns/creative-library.md). A scene is a photographic
 * setup, so browsing is nothing but the pictures — sections are collections
 * (Studio, Social, Portrait…), real art-direction groupings, not decoration,
 * so they survive the shared shell rather than being flattened into one
 * undifferentiated grid. That sectioning only makes sense while browsing:
 * the moment a search term is active, three matches scattered across five
 * sections reads worse than one flat result list, so search collapses to a
 * single grid instead. Favorites collapses it the same way, for the same
 * reason.
 *
 * Starring a card is what makes a catalog this size yours, and the Favorites
 * tab is where that lands — one more tab on the rail you already use, holding
 * only the scenes you starred.
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
  const { q, setQ, facets, setFacets, clearSearch, clear } = useLibraryQuery(['vertical', 'starred']);
  const vertical = facets.vertical;
  const onlyStarred = facets.starred === '1';
  const searching = q.trim().length > 0;
  /** Sections are for browsing. Narrow the wall by anything and one flat list reads better. */
  const flat = searching || onlyStarred;
  const [tile, setTile] = useLocalPref(PREF.wallDensity, DENSITY_DEFAULT);
  const density = normalizeDensity(tile);
  const setDensity = (cols: DensityCols) => setTile(cols);
  const wallStyle = densityWallStyle(density);
  const densityAttr = densitySize(density);

  const openScene = (id: string) => navigate(scenePath(brand, id));

  const byFacet = useMemo(() => {
    if (onlyStarred) return scenes.filter((s) => favs.includes(s.id));
    return vertical ? scenes.filter((s) => s.verticals.includes(vertical)) : scenes;
  }, [scenes, vertical, onlyStarred, favs]);

  const filtered = useMemo(
    () =>
      byFacet.filter((s) =>
        // sceneSearchText folds in keywords and pre-rename names, so a short
        // display name never costs a scene its findability.
        matchesQuery(sceneSearchText(s), q),
      ),
    [byFacet, q],
  );

  const { visible, remaining, showMore } = useLibraryPage(
    filtered,
    `${vertical ?? ''}|${onlyStarred ? 'starred' : ''}|${q}`,
  );

  const countFor = (v: string) => scenes.filter((s) => s.verticals.includes(v)).length;

  // Favorites always leads the rail, including at zero. A tab that appears
  // with the first star would shift every vertical along under the cursor at
  // the exact moment of clicking one, and a rail whose shape depends on your
  // history is a rail you can't build muscle memory for. Empty, it teaches
  // itself. The count is what the tab can actually show: a star outlives its
  // scene leaving the catalog, so the stored list is not the same as the tab.
  const starredTotal = scenes.reduce((n, s) => n + (favs.includes(s.id) ? 1 : 0), 0);
  const facetOptions = [
    { value: STARRED, label: 'Favorites', count: starredTotal },
    ...verticals.map((v) => ({ value: v, label: v, count: countFor(v) })),
  ];
  // Not facetMode's call any more: "Every scene" plus "Favorites" is already
  // two real choices, so the rail earns itself the moment there is a catalog,
  // however few verticals that catalog happens to carry.
  const mode: FacetMode = scenes.length > 0 ? 'tabs' : 'none';

  const facetGroup = {
    key: 'vertical',
    label: 'Vertical',
    everyLabel: 'Every scene',
    everyCount: scenes.length,
    selected: onlyStarred ? STARRED : vertical,
    // One write, both axes: `starred` and `vertical` are mutually exclusive,
    // and two separate setFacet calls would have the second undo the first.
    onSelect: (v: string | null) =>
      v === STARRED ? setFacets({ starred: '1', vertical: null }) : setFacets({ starred: null, vertical: v }),
    options: facetOptions,
  };

  const grid = (items: typeof scenes, wall = false) => (
    <div
      className="sc-masonry"
      data-wall={wall || undefined}
      data-density
      data-density-size={densityAttr}
      style={wallStyle}
    >
      {items.map((s) => (
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
  );

  return (
    <ScrollPane>
      <main className="sc-looks" id="main">
        <LibraryToolbar
          title="Scenes"
          filters={<FacetFilter mode={mode} group={facetGroup} />}
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
          !flat &&
          collections.map((c) => {
            const inCollection = byFacet.filter((s) => s.collections.includes(c));
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
                {grid(inCollection)}
              </section>
            );
          })}

        {loaded && !error && flat && visible.length > 0 && grid(visible, true)}

        {/* An empty Favorites tab is not a failed search — nothing went wrong,
            there is just nothing here yet. Say what puts something here. */}
        {loaded && !error && onlyStarred && starredTotal === 0 && (
          <LibraryEmpty
            shape="zero"
            body="Nothing starred yet. Star a scene from its card and it stays here."
            action={
              <button type="button" className="sc-lib-clear" onClick={() => setFacets({ starred: null })}>
                Browse every scene
              </button>
            }
          />
        )}

        {loaded && !error && scenes.length > 0 && starredTotal > 0 && filtered.length === 0 && (
          <LibraryZero
            noun="scenes"
            q={q}
            facet={onlyStarred ? 'Favorites' : vertical}
            onClearSearch={clearSearch}
            onClearAll={clear}
          />
        )}

        {flat && remaining > 0 && (
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
