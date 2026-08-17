import { useMemo, useState } from 'react';
import { sceneSearchText } from '../displayName.js';
import { useNavigate } from 'react-router';
import { Plus } from '@phosphor-icons/react';
import { api } from '../api.js';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { useTaskCenter } from '../app/TaskCenter.js';
import { useCreateAsset } from '../create/AssetCreateHost.js';
import { customScenesOf } from '../brandAssets.js';
import { scenePath } from '../routes.js';
import { useApplyScene } from '../app/useApplyScene.js';
import { bookmarkedScenes, toggleBookmarkScene } from '../bookmarks.js';
import { AssetBuildCard } from '../layout/AssetBuildCard.js';
import { SceneCard, SceneCardSkeleton } from '../layout/SceneCard.js';
import { DensityControl, densitySize, densityWallStyle } from '../layout/DensityControl.js';
import { DENSITY_DEFAULT, normalizeDensity, type DensityCols } from '../layout/masonry.js';
import { LibraryToolbar } from '../layout/library/LibraryToolbar.js';
import { LibrarySearch } from '../layout/library/LibrarySearch.js';
import { FacetFilter } from '../layout/library/FacetFilter.js';
import { LibraryEmpty, LibraryZero } from '../layout/library/LibraryEmpty.js';
import { StarterDivider } from '../layout/library/StarterDivider.js';
import { useLibraryQuery } from '../layout/library/useLibraryQuery.js';
import { useLibraryPage } from '../layout/library/useLibraryPage.js';
import { matchesQuery, type FacetMode } from '../layout/library/libraryRules.js';
import { ScrollPane } from '../layout/ScrollPane.js';
import { PREF, useLocalPref } from '../prefs.js';

/** Below this, a search box has nothing worth narrowing — the whole set is one screenful. */
const SEARCH_MIN = 8;

/**
 * The rail's value for the Bookmarks tab. A shortlist is a different axis from
 * vertical, so it rides its own `?bookmarked=1` param and this string never
 * reaches the URL — which is why it can't collide with a real vertical name.
 */
const BOOKMARKED = '__bookmarked';

/**
 * The scenes library, built on the shared Creative Library shell
 * (docs/product/patterns/creative-library.md). A scene is a photographic
 * setup, so browsing is nothing but the pictures — sections are collections
 * (Studio, Social, Portrait…), real art-direction groupings, not decoration,
 * so they survive the shared shell rather than being flattened into one
 * undifferentiated grid. That sectioning only makes sense while browsing:
 * the moment a search term is active, three matches scattered across five
 * sections reads worse than one flat result list, so search collapses to a
 * single grid instead. Bookmarks collapses it the same way, for the same
 * reason.
 *
 * Bookmarking a card is what makes a catalog this size yours, and the Bookmarks
 * tab is where that lands — one more tab on the rail you already use, holding
 * only the scenes you bookmarked.
 */
export function ScenesView() {
  const { scenes, collections, verticals, loaded, error, refetch } = useAppData();
  const { brand } = useBrand();
  const navigate = useNavigate();
  // The shortlist, per brand, in localStorage — deliberately not in the .brand
  // document. Read once here so every card on the wall shares one answer.
  const [marks, setMarks] = useState<string[]>(() => bookmarkedScenes(brand.id));
  const bookmark = (id: string) => setMarks(toggleBookmarkScene(brand.id, id));
  const applyScene = useApplyScene();
  // One poll for the whole app, owned by TaskCenter: a build started from the
  // top bar on any screen has to stay visible after you leave the screen that
  // started it.
  const { builds, poke: refreshBuilds } = useTaskCenter();
  const createAsset = useCreateAsset();
  const mine = useMemo(() => customScenesOf(brand), [brand]);
  const buildingScenes = builds.filter((b) => b.kind === 'scene' && (!b.finished || b.stage === 'failed'));
  const { q, setQ, facets, setFacets, clearSearch, clear } = useLibraryQuery(['vertical', 'bookmarked']);
  const vertical = facets.vertical;
  const onlyMarked = facets.bookmarked === '1';
  const searching = q.trim().length > 0;
  const [tile, setTile] = useLocalPref(PREF.wallDensity, DENSITY_DEFAULT);
  const density = normalizeDensity(tile);
  const setDensity = (cols: DensityCols) => setTile(cols);
  const wallStyle = densityWallStyle(density);
  const densityAttr = densitySize(density);

  const openScene = (id: string) => navigate(scenePath(brand, id));

  const byFacet = useMemo(() => {
    if (onlyMarked) return scenes.filter((s) => marks.includes(s.id));
    return vertical ? scenes.filter((s) => s.verticals.includes(vertical)) : scenes;
  }, [scenes, vertical, onlyMarked, marks]);

  const owned = mine.length > 0 || buildingScenes.length > 0;
  const heroMode = !owned;
  const markedTotal = scenes.reduce((n, s) => n + (marks.includes(s.id) ? 1 : 0), 0);
  /** The one empty wall that is not a failure: a tab you have not filled yet. */
  const bookmarksZero = onlyMarked && markedTotal === 0;
  /** Cold brands: an empty shortlist has nothing to show — keep the catalog up. */
  const bookmarksBrowse = bookmarksZero && heroMode;
  /**
   * The tab has its own thing to say, so nothing else should also speak.
   *
   * Gate the zero-result state on *this*, not on `bookmarksZero`: in
   * `bookmarksBrowse` the wall is the whole catalog, a search can still empty
   * it, and suppressing both messages left a blank page under a filled-in
   * search box — the same silence this file already fixed once.
   */
  const bookmarksMessage = bookmarksZero && !heroMode;

  /** Sections are for browsing. Narrow the wall by anything and one flat list reads better. */
  const flat = searching || (onlyMarked && !bookmarksBrowse);

  const wallSource = useMemo(
    () => (bookmarksBrowse ? scenes : byFacet),
    [bookmarksBrowse, scenes, byFacet],
  );

  const filtered = useMemo(
    () =>
      wallSource.filter((s) =>
        // sceneSearchText folds in keywords and pre-rename names, so a short
        // display name never costs a scene its findability.
        matchesQuery(sceneSearchText(s), q),
      ),
    [wallSource, q],
  );

  const { visible, remaining, showMore } = useLibraryPage(
    filtered,
    `${vertical ?? ''}|${onlyMarked ? 'bookmarked' : ''}|${bookmarksBrowse ? 'browse' : ''}|${q}`,
  );

  // Both halves of the wall, counted by the same rule the tab filters by
  // (untagged included), so the number always equals what the tab shows.
  const countFor = (v: string) =>
    [...mine, ...scenes].filter((s) => !s.verticals.length || s.verticals.includes(v)).length;

  // Bookmarks always leads the rail, including at zero. A tab that appears
  // with the first bookmark would shift every vertical along under the cursor
  // at the exact moment of clicking one, and a rail whose shape depends on your
  // history is a rail you can't build muscle memory for. Empty, it teaches
  // itself. The count is what the tab can actually show: a bookmark outlives
  // its scene leaving the catalog, so the stored list is not the same as the tab.
  const facetOptions = [
    { value: BOOKMARKED, label: 'Bookmarks', count: markedTotal },
    ...verticals.map((v) => ({ value: v, label: v, count: countFor(v) })),
  ];
  // Not facetMode's call any more: "Every scene" plus "Bookmarks" is already
  // two real choices, so the rail earns itself the moment there is a catalog,
  // however few verticals that catalog happens to carry.
  const mode: FacetMode = scenes.length > 0 ? 'tabs' : 'none';

  const facetGroup = {
    key: 'vertical',
    label: 'Vertical',
    everyLabel: 'Every scene',
    everyCount: scenes.length + mine.length,
    selected: onlyMarked ? BOOKMARKED : vertical,
    // One write, both axes: `bookmarked` and `vertical` are mutually exclusive,
    // and two separate setFacet calls would have the second undo the first.
    onSelect: (v: string | null) =>
      v === BOOKMARKED ? setFacets({ bookmarked: '1', vertical: null }) : setFacets({ bookmarked: null, vertical: v }),
    options: facetOptions,
  };

  /**
   * The brand's own places, narrowed by whatever the wall is narrowed by.
   *
   * A custom scene answers to search and to a vertical exactly as a curated one
   * does. Bookmarks is the one axis it stays out of: a bookmark is a way of
   * shortlisting a large catalog you did not write.
   */
  const mineShown = useMemo(
    () =>
      mine
        // Untagged is unfiltered: a scene nobody categorised would otherwise
        // vanish from every tab, which reads as losing it.
        .filter((s) => (vertical ? !s.verticals.length || s.verticals.includes(vertical) : true))
        .filter((s) => matchesQuery(sceneSearchText(s), q)),
    [mine, vertical, q],
  );
  /**
   * Whether this brand has scenes of its own at all, before any filter.
   *
   * Not "does the filtered list have anything": narrowing to a vertical your
   * one scene is not in used to drop the whole page back to the first-run
   * offer, chrome included.
   */
  const showMine = !onlyMarked && (buildingScenes.length > 0 || mineShown.length > 0);
  /**
   * Nothing of your own yet: the page leads with its offer.
   *
   * Ownership is the only input. A filter can never make the offer appear or
   * vanish — this used to also read `&& !onlyMarked`, which meant selecting
   * the Bookmarks tab tore the offer out from under the row and moved the row
   * itself to the top of the page, at the moment of the click.
   */

  const createCta = (
    <button type="button" className="sc-btn sc-btn-primary" onClick={() => createAsset('scene')}>
      <Plus size={12} /> Create scene
    </button>
  );

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
          bookmarked={marks.includes(s.id)}
          onBookmark={bookmark}
        />
      ))}
    </div>
  );

  /**
   * The filter row belongs to the wall it filters, and is gated on that wall
   * having contents — never on whether you own any of them. Home has always
   * read it this way (`showcase.length > 0`); the library pages rode ownership
   * instead, which hid search and every vertical from a brand that had not
   * authored a scene of its own. That is nearly every brand: leaving the cold
   * state takes a whole build flow, so it is the state this page lives in.
   *
   * In the cold state the wall is a screenful below the offer, so the row goes
   * down with it and sits directly on top of it. It stays sticky there — it is
   * a sibling of the wall, not wrapped in a box that ends above it, so it docks
   * under the nav for the whole length of the scroll.
   *
   * What it must never do is arrive. A row that appears when you bookmark your
   * first scene shoves the wall — and the card you just clicked — down by its
   * own height, which is the same objection the Bookmarks tab itself answers by
   * rendering at zero.
   */
  const toolbar = (
    <LibraryToolbar
      title="Scenes"
      filters={<FacetFilter mode={mode} group={facetGroup} />}
      density={<DensityControl value={density} onChange={setDensity} />}
      search={
        scenes.length >= SEARCH_MIN && <LibrarySearch value={q} onChange={setQ} noun="scenes" total={scenes.length} />
      }
      // One CTA on the page: the offer owns it while it is showing, the row
      // owns it the rest of the time.
      action={heroMode ? undefined : createCta}
    />
  );

  return (
    <ScrollPane>
      <main className="sc-looks sc-scenes" id="main" data-hero={heroMode || undefined}>
        {!heroMode && toolbar}

        {showMine && (
          <section className="sc-owned">
            <div className="sc-sec-head">
              <h2 className="sc-sec-title">Your scenes</h2>
            </div>
            <div className="sc-masonry" data-wall data-density data-density-size={densityAttr} style={wallStyle}>
              {buildingScenes.map((b) => (
                <AssetBuildCard
                  key={b.id}
                  build={b}
                  onCancel={(id) => void api.cancelAssetBuild(brand.id, id).then(refreshBuilds)}
                  onDismiss={(id) => void api.deleteAssetBuild(brand.id, id).then(refreshBuilds)}
                  onRetry={() => createAsset('scene')}
                />
              ))}
              {mineShown.map((s) => (
                <SceneCard key={s.id} scene={s} variant="use" size="grid" onOpen={openScene} onUse={applyScene} />
              ))}
            </div>
          </section>
        )}

        {/* The cold state, the same one Products shows. */}
        {heroMode && loaded && !error && scenes.length > 0 && (
          <LibraryEmpty
            shape="cold"
            title={
              <>
                Build your own <em>scene</em>
              </>
            }
            body="Upload a few references of a place, and its light and materials carry into every image you make."
            action={createCta}
          />
        )}

        {/* A heading only where it separates two things. */}
        {showMine && loaded && !error && !onlyMarked && byFacet.length > 0 && (
          <div className="sc-sec-head sc-owned-divider">
            <h2 className="sc-sec-title">Scenri scenes</h2>
          </div>
        )}

        {/* The seam, and the row that belongs to the wall under it. Both sit
            outside the sectioned branch below on purpose: searching or picking
            Bookmarks flips `flat`, and a row that unmounts as you type in it is
            worse than one that never appeared. */}
        {heroMode && loaded && !error && scenes.length > 0 && (
          <>
            <StarterDivider label="Or start from one of ours" />
            {toolbar}
          </>
        )}

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
            const inCollection = wallSource.filter((s) => s.collections.includes(c));
            if (!inCollection.length) return null;
            return (
              // Just the heading and the wall. The row of scene names that
              // used to sit here repeated, in text, every card directly
              // below it: two ways to open the same thing, stacked.
              <section className="sc-coll" key={c}>
                <h2>{c}</h2>
                {grid(inCollection)}
              </section>
            );
          })}

        {loaded && !error && flat && visible.length > 0 && grid(visible, true)}

        {/* An empty Bookmarks tab is not a failed search — nothing went wrong,
            there is just nothing here yet. Say what puts something here. In the
            cold state the catalog stays up instead: there is nothing to hide
            behind an empty wall, and the instruction only works if cards are
            on screen. */}
        {loaded && !error && bookmarksMessage && (
          <LibraryEmpty
            shape="zero"
            body="Nothing bookmarked yet. Bookmark a scene from its card and it stays here."
            action={
              <button type="button" className="sc-btn sc-btn-ghost" onClick={() => setFacets({ bookmarked: null })}>
                Browse every scene
              </button>
            }
          />
        )}

        {/* Everything else that empties the wall: a search, a vertical, or both.
            Gated on the message above actually rendering, never on a proxy for
            it. It used to read `markedTotal > 0`, then `!bookmarksZero`; both
            were shorthand for "not the case above" and both left a state where
            neither spoke and the page went blank under a filled-in search box.
            The facet it names is the one the wall was actually narrowed by —
            in `bookmarksBrowse` that is nothing, because the wall is the whole
            catalog. */}
        {loaded && !error && scenes.length > 0 && !bookmarksMessage && filtered.length === 0 && mineShown.length === 0 && (
          <LibraryZero
            noun="scenes"
            q={q}
            facet={bookmarksBrowse ? null : onlyMarked ? 'Bookmarks' : vertical}
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
