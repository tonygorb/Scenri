import { useMemo } from 'react';
import { presenterSearchText } from '../displayName.js';
import { useNavigate } from 'react-router';
import { Plus } from '@phosphor-icons/react';
import { api } from '../api.js';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { useTaskCenter } from '../app/TaskCenter.js';
import { useCreateAsset } from '../create/AssetCreateHost.js';
import { useApplyPresenter } from '../app/useApplyPresenter.js';
import { customPresentersOf } from '../brandAssets.js';
import { presenterPath } from '../routes.js';
import { AssetBuildCard } from '../layout/AssetBuildCard.js';
import { PresenterCard, PresenterCardSkeleton } from '../layout/PresenterCard.js';
import { DensityControl, densitySize, densityWallStyle } from '../layout/DensityControl.js';
import { DENSITY_DEFAULT, normalizeDensity, type DensityCols } from '../layout/masonry.js';
import { LibraryToolbar } from '../layout/library/LibraryToolbar.js';
import { LibrarySearch } from '../layout/library/LibrarySearch.js';
import { FacetFilter } from '../layout/library/FacetFilter.js';
import { LibraryEmpty, LibraryZero } from '../layout/library/LibraryEmpty.js';
import { StarterDivider } from '../layout/library/StarterDivider.js';
import { useLibraryQuery } from '../layout/library/useLibraryQuery.js';
import { useLibraryPage } from '../layout/library/useLibraryPage.js';
import { matchesQuery, facetMode } from '../layout/library/libraryRules.js';
import { ScrollPane } from '../layout/ScrollPane.js';
import { PREF, useLocalPref } from '../prefs.js';

/** Below this, a search box has nothing worth narrowing — the whole set is one screenful. */
const SEARCH_MIN = 8;

/**
 * The presenter library, built on the shared Creative Library shell
 * (layout/library/). One casting board, not a
 * Scene-style set of collection sections — eight-odd people don't need
 * Studio/Social-style grouping, and splitting into gendered sections by
 * default would read as a checkbox diversity grid rather than a curated
 * roster. Category tabs, same `.sc-verticals` pattern as Scenes — a longer
 * value list scrolls horizontally rather than collapsing into a menu.
 *
 * The brand's own people sit above that board in their own section, the same
 * split Products makes between what you brought and what we cast. The roster
 * below is always there, so this page is never an empty room.
 */
export function PresentersView() {
  const { presenters, presenterCategories, presentersLoaded, presentersError, refetchPresenters } = useAppData();
  const { brand } = useBrand();
  const navigate = useNavigate();
  const applyPresenter = useApplyPresenter();
  const { q, setQ, facets, setFacet, clearSearch, clear } = useLibraryQuery(['category']);
  const category = facets.category;
  // One poll for the whole app, owned by TaskCenter: a build started from the
  // top bar on any screen has to stay visible after you leave the screen that
  // started it.
  const { builds, poke: refreshBuilds } = useTaskCenter();
  const createAsset = useCreateAsset();
  const mine = useMemo(() => customPresentersOf(brand), [brand]);
  const running = builds.filter((b) => b.kind === 'presenter' && (!b.finished || b.stage === 'failed'));
  const [tile, setTile] = useLocalPref(PREF.wallDensity, DENSITY_DEFAULT);
  const density = normalizeDensity(tile);
  const setDensity = (cols: DensityCols) => setTile(cols);
  const wallStyle = densityWallStyle(density);
  const densityAttr = densitySize(density);

  const openPresenter = (id: string) => navigate(presenterPath(brand, id));

  const byFacet = useMemo(
    () => (category ? presenters.filter((p) => p.suitableCategories.includes(category)) : presenters),
    [presenters, category],
  );

  const filtered = useMemo(
    () =>
      byFacet.filter((p) =>
        // presenterSearchText carries the whole casting sheet — hair, skin,
        // build, age, wardrobe — none of which the card shows.
        matchesQuery(presenterSearchText(p), q),
      ),
    [byFacet, q],
  );

  const { visible, remaining, showMore } = useLibraryPage(filtered, `${category ?? ''}|${q}`);

  const mode = facetMode(presenterCategories.length);

  const createCta = (
    <button type="button" className="sc-btn sc-btn-primary" onClick={() => createAsset('presenter')}>
      <Plus size={12} /> Create presenter
    </button>
  );

  /** A person the brand owns, narrowed by whatever the wall is narrowed by. */
  const minePlusBuilds = useMemo(
    () =>
      mine
        // Untagged is unfiltered: a person nobody categorised would otherwise
        // vanish from every tab, which reads as losing them.
        .filter((p) => (category ? !p.suitableCategories.length || p.suitableCategories.includes(category) : true))
        .filter((p) => matchesQuery(presenterSearchText(p), q)),
    [mine, category, q],
  );
  /**
   * Whether this brand has people of its own at all, before any filter.
   *
   * Deliberately not "does the filtered list have anything in it": that made
   * narrowing to a category your one presenter is not in read as losing the
   * page, chrome and all, and snapping back to the first-run offer.
   */
  const owned = mine.length > 0 || running.length > 0;
  const showMine = running.length > 0 || minePlusBuilds.length > 0;
  /**
   * Nothing of your own yet: the page leads with its offer.
   *
   * Ownership is the only input. It used to fold away on a filter too, which
   * meant clicking a category tab made the whole offer vanish and read as the
   * page breaking. The cold state now carries no filter chrome at all, so
   * there is nothing to click, and a deep link carrying a facet narrows the
   * wall underneath without disturbing the offer above it.
   */
  const heroMode = !owned;

  // Counts cover both halves of the wall. A tab that said "6" while showing
  // seven, because one of them was yours, is a tab that cannot be trusted.
  const facetGroup = {
    key: 'category',
    label: 'Category',
    everyLabel: 'Every presenter',
    everyCount: presenters.length + mine.length,
    selected: category,
    onSelect: (v: string | null) => setFacet('category', v),
    options: presenterCategories.map((c) => ({
      value: c,
      label: c,
      // Counted by the same rule the tab filters by, untagged included, so
      // the number always equals what the tab actually shows.
      count: [...mine, ...presenters].filter((p) => !p.suitableCategories.length || p.suitableCategories.includes(c))
        .length,
    })),
  };

  /**
   * The filter row belongs to the wall it filters, and is gated on that wall
   * having contents — never on whether you own any of them. Home has always
   * read it this way (`showcase.length > 0`).
   *
   * In the cold state that wall is the roster, a screenful below the offer, so
   * the row travels down and sits directly on top of it. Left at the top it
   * filtered something you could not see, across an empty band. It is a sibling
   * of the wall rather than wrapped in a box that ends above it, so it stays
   * sticky for the whole length of the scroll.
   */
  const toolbar = (
    <LibraryToolbar
      title="Presenters"
      filters={<FacetFilter mode={mode} group={facetGroup} />}
      density={<DensityControl value={density} onChange={setDensity} />}
      search={
        presenters.length >= SEARCH_MIN && (
          <LibrarySearch value={q} onChange={setQ} noun="presenters" total={presenters.length} />
        )
      }
      // Products' rule: one CTA on the page. The offer owns it while it is
      // showing; the row owns it the rest of the time.
      action={heroMode ? undefined : createCta}
    />
  );

  return (
    <ScrollPane>
      <main className="sc-looks sc-presenters" id="main" data-hero={heroMode || undefined}>
        {!heroMode && toolbar}

        {showMine && (
          <section className="sc-owned">
            <div className="sc-sec-head">
              <h2 className="sc-sec-title">Your presenters</h2>
            </div>
            <div className="sc-masonry" data-wall data-density data-density-size={densityAttr} style={wallStyle}>
              {running.map((b) => (
                <AssetBuildCard
                  key={b.id}
                  build={b}
                  onCancel={(id) => void api.cancelAssetBuild(brand.id, id).then(refreshBuilds)}
                  onDismiss={(id) => void api.deleteAssetBuild(brand.id, id).then(refreshBuilds)}
                  onRetry={() => createAsset('presenter')}
                />
              ))}
              {minePlusBuilds.map((p) => (
                <PresenterCard
                  key={p.id}
                  presenter={p}
                  variant="use"
                  size="grid"
                  onOpen={openPresenter}
                  href={presenterPath(brand, p.id)}
                  onUse={applyPresenter}
                />
              ))}
            </div>
          </section>
        )}

        {/* The cold state, the same one Products shows: the offer, centred,
            with the roster underneath so the page is never an empty room. */}
        {heroMode && presentersLoaded && !presentersError && presenters.length > 0 && (
          <LibraryEmpty
            shape="cold"
            title={
              <>
                Cast your own <em>presenter</em>
              </>
            }
            body="Upload a few photos of one person, and they stay the same person in every image you make."
            action={createCta}
          />
        )}

        {/* A heading only where it separates two things. Filter your own half
            away and the page is simply a wall of ours, which needs no label. */}
        {showMine && presentersLoaded && !presentersError && visible.length > 0 && (
          <div className="sc-sec-head sc-owned-divider">
            <h2 className="sc-sec-title">Scenri presenters</h2>
          </div>
        )}

        {!presentersLoaded && (
          <div className="sc-masonry" data-density data-density-size={densityAttr} style={wallStyle} aria-hidden>
            <PresenterCardSkeleton size="grid" count={8} />
          </div>
        )}

        {presentersLoaded && presentersError && (
          <LibraryEmpty
            shape="error"
            title="Couldn't load the presenter library"
            body="Something went wrong reaching the catalog."
            onRetry={() => refetchPresenters()}
          />
        )}

        {/* The seam, and the row that belongs to the roster under it. The only
            eyebrow on this page. */}
        {heroMode && presentersLoaded && !presentersError && presenters.length > 0 && (
          <>
            <StarterDivider label="Or cast someone from ours" />
            {toolbar}
          </>
        )}

        {presentersLoaded && !presentersError && visible.length > 0 && (
          <div className="sc-masonry" data-wall data-density data-density-size={densityAttr} style={wallStyle}>
            {visible.map((p) => (
              <PresenterCard
                key={p.id}
                presenter={p}
                variant="use"
                size="grid"
                onOpen={openPresenter}
                href={presenterPath(brand, p.id)}
                onUse={applyPresenter}
              />
            ))}
          </div>
        )}

        {presentersLoaded && !presentersError && !filtered.length && presenters.length > 0 && (
          <LibraryZero noun="presenters" q={q} facet={category} onClearSearch={clearSearch} onClearAll={clear} />
        )}

        {presentersLoaded && !presentersError && !presenters.length && (
          <LibraryEmpty shape="zero" body="The presenter library is still being cast. Check back soon." />
        )}

        {remaining > 0 && (
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
