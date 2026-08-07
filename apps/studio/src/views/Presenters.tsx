import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAppData, useFilterParam } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { useApplyPresenter } from '../app/useApplyPresenter.js';
import { presenterPath } from '../routes.js';
import { PresenterCard, PresenterCardSkeleton } from '../layout/PresenterCard.js';

/**
 * The presenter library: one casting board, not a Look-style set of
 * collection sections. Eight people don't need Studio/Social-style grouping,
 * and splitting into gendered sections by default would read as a checkbox
 * diversity grid rather than a curated roster — a light category filter is
 * enough to narrow by, alongside the "browse everyone" default.
 */
export function PresentersView() {
  const { presenters, presenterCategories, presentersLoaded, presentersError, refetchPresenters } = useAppData();
  const { brand } = useBrand();
  const navigate = useNavigate();
  const { cast, goToBrief } = useApplyPresenter();
  const [busy, setBusy] = useState<string | null>(null);
  const [categoryParam, setCategory] = useFilterParam('category');
  const category = categoryParam || null;

  const openPresenter = (id: string) => navigate(presenterPath(brand, id));
  const onUse = async (id: string) => {
    setBusy(id);
    try {
      await cast(id);
      goToBrief();
    } finally {
      setBusy(null);
    }
  };

  const shown = useMemo(
    () => (category ? presenters.filter((p) => p.suitableCategories.includes(category)) : presenters),
    [presenters, category],
  );

  return (
    <div className="sc-home">
      <main className="sc-looks sc-presenters" id="main">
        <div className="sc-verticals" role="tablist" aria-label="Categories">
          <button
            type="button"
            role="tab"
            aria-selected={!category}
            data-on={!category ? '' : undefined}
            onClick={() => setCategory(null)}
          >
            Every presenter <span className="sc-vcount">{presenters.length}</span>
          </button>
          {presenterCategories.map((c) => (
            <button
              type="button"
              key={c}
              role="tab"
              aria-selected={category === c}
              data-on={category === c ? '' : undefined}
              onClick={() => setCategory(c)}
            >
              {c} <span className="sc-vcount">{presenters.filter((p) => p.suitableCategories.includes(c)).length}</span>
            </button>
          ))}
        </div>

        {!presentersLoaded && (
          <div className="sc-masonry" aria-hidden>
            <PresenterCardSkeleton size="grid" count={8} />
          </div>
        )}

        {presentersLoaded && presentersError && (
          <>
            <h1>Couldn't load the presenter library</h1>
            <p className="sc-lookpage-lede">Something went wrong reaching the catalog.</p>
            <div className="sc-lookpage-acts">
              <button type="button" className="sc-btn sc-btn-primary" onClick={() => refetchPresenters()}>
                Retry
              </button>
            </div>
          </>
        )}

        {presentersLoaded && !presentersError && (
          <div className="sc-masonry">
            {shown.map((p) => (
              <PresenterCard
                key={p.id}
                presenter={p}
                variant="use"
                size="grid"
                onOpen={openPresenter}
                onUse={busy ? undefined : onUse}
              />
            ))}
          </div>
        )}

        {presentersLoaded && !presentersError && !shown.length && presenters.length > 0 && (
          <p className="sc-looks-empty">No presenter carries that category yet.</p>
        )}

        {presentersLoaded && !presentersError && !presenters.length && (
          <p className="sc-looks-empty">The presenter library is still being cast. Check back soon.</p>
        )}
      </main>
    </div>
  );
}
