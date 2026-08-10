import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Badge, Dialog } from '@radix-ui/themes';
import { ImageSquare, Package, Sparkle, UsersThree, X } from '@phosphor-icons/react';
import type { Brand } from '../api.js';
import { useAppData, useFilterParam } from '../app/AppShell.js';
import { useApplyShowcase } from '../app/useApplyShowcase.js';
import { useBrand } from '../app/BrandLayout.js';
import { hubPath, presenterPath, presentersPath, scenePath, scenesPath } from '../routes.js';
import { ProductsPanel } from '../AssetPanel.js';
import { favoriteScenes } from '../favorites.js';
import { showcaseCategoryLabel, sortShowcaseCategories } from '../showcaseCategories.js';
import { ShowcaseCard, ShowcaseCardSkeleton } from '../layout/ShowcaseCard.js';
import { PresenterCard, PresenterCardSkeleton } from '../layout/PresenterCard.js';
import { SceneCard, SceneCardSkeleton } from '../layout/SceneCard.js';

/**
 * The launcher.
 *
 * Home decides what to do; Create is where it gets done. They were briefly one
 * screen, and Home inherited the working surface's furniture — an assets rail
 * down the side, an "empty set" where the greeting should be. Two jobs, two
 * screens: nothing here is a tool, everything is a way in.
 *
 * So there is no assets panel, no lens row and no selection here. Every control
 * on this page ends in a navigation to Create, carrying whatever it chose.
 */
export function HomeView() {
  const {
    scenes: templates,
    loaded: scenesLoaded,
    presenters,
    presentersLoaded,
    demoProducts,
    showcase,
    showcaseCategories,
    showcaseLoaded,
    showcaseError,
    refetchShowcase,
    refresh,
  } = useAppData();
  const { brand, products: library } = useBrand();
  const navigate = useNavigate();
  const applyShowcase = useApplyShowcase();
  const [categoryParam, setCategory] = useFilterParam('category');
  const category = categoryParam || null;

  /** Every way in lands on the same hub, differing only in what it carries. */
  const toCreate = (qs?: Record<string, string>) => {
    const q = new URLSearchParams(qs ?? {}).toString();
    navigate(`${hubPath(brand)}${q ? `?${q}` : ''}`);
  };

  // the brand-level poll starts at [] and only fills in after its first poll
  // resolves — brand.json is already loaded by the time this mounts, so it
  // covers that gap instead of flashing the badge hidden (same fallback
  // every other consumer of BrandLayout's product library already uses)
  const products = library.length ? library : ((brand.json?.products ?? []) as any[]);

  /** The gallery for the selected category — same ordering the catalog
   * already ships in (curated order, not favorites-sorted: every entry here
   * is already hand-picked, unlike the raw scene catalog). */
  const shownShowcase = useMemo(
    () => (category ? showcase.filter((s) => s.category === category) : showcase),
    [showcase, category],
  );

  /** Counts against the full gallery, not the filtered view — a tab always
   * states how many examples it holds, not how many are currently shown. */
  const countFor = (c: string) => showcase.filter((s) => s.category === c).length;

  /** A showcase entry's tokens only carry ids — resolve the names the card
   * actually shows (the product/presenter/scene chips this recipe was built
   * from) against the same catalogs Composer resolves them against. */
  const recipeOf = (entry: (typeof showcase)[number]) => {
    const productId = entry.brief.tokens.find((t: any) => t.t === 'product')?.id;
    const presenterId = entry.brief.tokens.find((t: any) => t.t === 'character')?.id;
    const sceneId = entry.brief.tokens.find((t: any) => t.t === 'template')?.id;
    const presenter = presenterId ? presenters.find((p) => p.id === presenterId) : undefined;
    return {
      productName: productId ? demoProducts.find((p) => p.id === productId)?.name : null,
      presenterName: presenter?.name ?? null,
      presenterPreviewUrl: presenter?.previewUrl ?? null,
      sceneName: sceneId ? templates.find((t) => t.id === sceneId)?.name : null,
    };
  };

  /** A real pre-fill, not "Start from scratch" with a different label: pick
   * the scene for you (favorite first, else whatever's first) and go straight
   * to adding the product it's for — the two things every shoot needs. */
  const startPhotoshoot = () => {
    const favs = favoriteScenes(brand.id);
    const sceneId = templates.find((t) => favs.includes(t.id))?.id ?? templates[0]?.id;
    toCreate(sceneId ? { scene: sceneId, attach: 'products', compose: '1' } : { attach: 'products', compose: '1' });
  };

  return (
    <div className="sc-home">
      <main className="sc-main" id="main">
        <h1 className="sc-greet">
          Make something <em>on brand</em>
        </h1>

        <div className="sc-create-grid">
          <button type="button" className="sc-create-card" onClick={startPhotoshoot}>
            <span className="sc-glyph">
              <Sparkle size={16} />
            </span>
            <span>
              <b>New photoshoot</b>
              <small>Template plus your product</small>
            </span>
          </button>
          <button type="button" className="sc-create-card" onClick={() => toCreate({ compose: '1' })}>
            <span className="sc-glyph">
              <ImageSquare size={16} />
            </span>
            <span>
              <b>Start from scratch</b>
              <small>Describe any visual</small>
            </span>
          </button>
          <ProductsCard brand={brand} onChanged={refresh} count={products.length} />
        </div>

        {/* Already one click away from BrandMenu at every viewport — this is
            a convenience for a first-time visitor, not the only way in, so it
            doesn't compete with the three things this screen is actually for. */}
        <button type="button" className="sc-create-more" onClick={() => navigate('/setup')}>
          <UsersThree size={13} /> Set up a brand
        </button>

        {!showcaseLoaded && (
          <div className="sc-masonry" aria-hidden>
            <ShowcaseCardSkeleton size="grid" count={8} />
          </div>
        )}

        {showcaseLoaded && showcaseError && (
          <p className="sc-feed-empty">
            Couldn't load the showcase gallery.{' '}
            <button type="button" className="sc-sec-more" onClick={() => refetchShowcase()}>
              Retry
            </button>
          </p>
        )}

        {showcaseLoaded && !showcaseError && showcase.length > 0 && (
          <>
            <div className="sc-verticals" role="tablist" aria-label="Categories">
              <button
                type="button"
                role="tab"
                aria-selected={!category}
                data-on={!category ? '' : undefined}
                onClick={() => setCategory(null)}
              >
                Every example <span className="sc-vcount">{showcase.length}</span>
              </button>
              {sortShowcaseCategories(showcaseCategories).map((c) => (
                <button
                  type="button"
                  key={c}
                  role="tab"
                  aria-selected={category === c}
                  data-on={category === c ? '' : undefined}
                  onClick={() => setCategory(c)}
                >
                  {showcaseCategoryLabel(c) ?? c} <span className="sc-vcount">{countFor(c)}</span>
                </button>
              ))}
            </div>

            {shownShowcase.length > 0 && (
              <div className="sc-masonry">
                {shownShowcase.map((s) => (
                  <ShowcaseCard key={s.id} entry={s} size="grid" onOpen={applyShowcase} {...recipeOf(s)} />
                ))}
              </div>
            )}

            {shownShowcase.length === 0 && <p className="sc-looks-empty">No example carries that category yet.</p>}
          </>
        )}

        {!presentersLoaded && (
          <div className="sc-masonry" aria-hidden>
            <PresenterCardSkeleton size="grid" count={8} />
          </div>
        )}

        {presentersLoaded && presenters.length > 0 && (
          <>
            <div className="sc-sec-head">
              <span className="sc-sec-title">Presenters</span>
              <button type="button" className="sc-sec-more" onClick={() => navigate(presentersPath(brand))}>
                Browse presenters
              </button>
            </div>
            <div className="sc-masonry">
              {presenters.slice(0, 8).map((p) => (
                <PresenterCard
                  key={p.id}
                  presenter={p}
                  variant="navigate"
                  size="grid"
                  onOpen={(id) => navigate(presenterPath(brand, id))}
                />
              ))}
            </div>
          </>
        )}

        {!scenesLoaded && (
          <div className="sc-masonry" aria-hidden>
            <SceneCardSkeleton size="grid" count={8} />
          </div>
        )}

        {scenesLoaded && templates.length > 0 && (
          <>
            <div className="sc-sec-head">
              <span className="sc-sec-title">Scenes</span>
              <button type="button" className="sc-sec-more" onClick={() => navigate(scenesPath(brand))}>
                Browse scenes
              </button>
            </div>
            <div className="sc-masonry">
              {templates.slice(0, 8).map((s) => (
                <SceneCard
                  key={s.id}
                  scene={s}
                  variant="navigate"
                  size="grid"
                  onOpen={(id) => navigate(scenePath(brand, id))}
                />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function ProductsCard({ brand, onChanged, count }: { brand: Brand; onChanged: () => void; count: number }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger>
        <button type="button" className="sc-create-card">
          <span className="sc-glyph">
            <Package size={16} />
          </span>
          <span>
            <b>
              Add a product{' '}
              {count > 0 && (
                <Badge variant="soft" radius="full" size="1">
                  {count}
                </Badge>
              )}
            </b>
            <small>Locked shots keep it exact</small>
          </span>
        </button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="560px">
        <Dialog.Close>
          <button type="button" className="sc-set-close sc-dlg-close" aria-label="Close">
            <X size={16} />
          </button>
        </Dialog.Close>
        <Dialog.Title>Products: {brand.json?.meta?.name}</Dialog.Title>
        <ProductsPanel brand={brand} onChanged={onChanged} />
      </Dialog.Content>
    </Dialog.Root>
  );
}
