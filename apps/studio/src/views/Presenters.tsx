import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { TextField } from '@radix-ui/themes';
import { MagnifyingGlass, Plus } from '@phosphor-icons/react';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { useApplyPresenter } from '../app/useApplyPresenter.js';
import { presenterPath } from '../routes.js';
import { PresenterCard, PresenterCardSkeleton } from '../layout/PresenterCard.js';
import { DensityControl, densitySize, densityWallStyle } from '../layout/DensityControl.js';
import { DENSITY_DEFAULT, normalizeDensity, type DensityCols } from '../layout/masonry.js';
import { LibraryToolbar } from '../layout/library/LibraryToolbar.js';
import { FacetFilter } from '../layout/library/FacetFilter.js';
import { LibraryEmpty } from '../layout/library/LibraryEmpty.js';
import { useLibraryQuery } from '../layout/library/useLibraryQuery.js';
import { useLibraryPage } from '../layout/library/useLibraryPage.js';
import { matchesQuery, facetMode } from '../layout/library/libraryRules.js';
import { ScrollPane } from '../layout/ScrollPane.js';
import { PREF, useLocalPref } from '../prefs.js';

/** Below this, a search box has nothing worth narrowing — the whole set is one screenful. */
const SEARCH_MIN = 8;

/**
 * The presenter library, built on the shared Creative Library shell
 * (docs/product/patterns/creative-library.md). One casting board, not a
 * Scene-style set of collection sections — eight-odd people don't need
 * Studio/Social-style grouping, and splitting into gendered sections by
 * default would read as a checkbox diversity grid rather than a curated
 * roster. Category tabs, same `.sc-verticals` pattern as Scenes — a longer
 * value list scrolls horizontally rather than collapsing into a menu.
 */
export function PresentersView() {
  const { presenters, presenterCategories, presentersLoaded, presentersError, refetchPresenters } = useAppData();
  const { brand } = useBrand();
  const navigate = useNavigate();
  const applyPresenter = useApplyPresenter();
  const { q, setQ, facets, setFacet, active, clear } = useLibraryQuery(['category']);
  const category = facets.category;
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
        matchesQuery(
          [p.name, p.descriptor, p.hair, p.facial, p.skin, p.build, p.ageRange, ...p.suitableCategories].join(' '),
          q,
        ),
      ),
    [byFacet, q],
  );

  const { visible, remaining, showMore } = useLibraryPage(filtered, `${category ?? ''}|${q}`);

  const mode = facetMode(presenterCategories.length);

  const facetGroup = {
    key: 'category',
    label: 'Category',
    everyLabel: 'Every presenter',
    everyCount: presenters.length,
    selected: category,
    onSelect: (v: string | null) => setFacet('category', v),
    options: presenterCategories.map((c) => ({
      value: c,
      label: c,
      count: presenters.filter((p) => p.suitableCategories.includes(c)).length,
    })),
  };

  return (
    <ScrollPane>
      <main className="sc-looks sc-presenters" id="main">
        <LibraryToolbar
          title="Presenters"
          filters={<FacetFilter mode={mode} group={facetGroup} />}
          active={active}
          summary={`Showing ${filtered.length} of ${presenters.length}`}
          onClear={clear}
          density={<DensityControl value={density} onChange={setDensity} />}
          search={
            presenters.length >= SEARCH_MIN && (
              <TextField.Root
                size="2"
                style={{ width: 220 }}
                placeholder={`Search ${presenters.length} presenters`}
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
              <Plus size={12} /> Create presenter
            </button>
          }
        />

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

        {presentersLoaded && !presentersError && visible.length > 0 && (
          <div className="sc-masonry" data-wall data-density data-density-size={densityAttr} style={wallStyle}>
            {visible.map((p) => (
              <PresenterCard
                key={p.id}
                presenter={p}
                variant="use"
                size="grid"
                onOpen={openPresenter}
                onUse={applyPresenter}
              />
            ))}
          </div>
        )}

        {presentersLoaded && !presentersError && !filtered.length && presenters.length > 0 && (
          <LibraryEmpty
            shape="zero"
            body="No presenters match these filters."
            action={
              <button type="button" className="sc-lib-clear" onClick={clear}>
                Clear filters
              </button>
            }
          />
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
