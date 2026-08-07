import { useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router';
import { Badge, Dialog } from '@radix-ui/themes';
import { ImageSquare, Package, Sparkle, Star, UsersThree, WarningCircle, X, XCircle } from '@phosphor-icons/react';
import { hasNoShots, imgUrl, type Brand } from '../api.js';
import { useAppData, useFilterParam } from '../app/AppShell.js';
import { useApplyShowcase } from '../app/useApplyShowcase.js';
import { useBrand } from '../app/BrandLayout.js';
import { hubPath, presenterPath, presentersPath, shotPath } from '../routes.js';
import { ProductsPanel } from '../AssetPanel.js';
import { favoriteScenes } from '../favorites.js';
import { categoryLabel } from '../productCategories.js';
import { ShowcaseCard, ShowcaseCardSkeleton } from '../layout/ShowcaseCard.js';
import { masonryLayout, PHONE, useElementWidth, useViewportWidth } from '../layout/masonry.js';
import { PresenterCard, PresenterCardSkeleton } from '../layout/PresenterCard.js';

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
const RECENT = 12;

/** Same fixed column width Create's own grid-size slider starts at
 * (`TILE_DEFAULT` in Create.tsx) — Home has no slider to drag, but the two
 * feeds should still read as the same kind of grid. */
const HOME_TILE = 240;

export function HomeView() {
  const {
    scenes: templates,
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
  const { brand, nodes, loaded, products: library } = useBrand();
  const navigate = useNavigate();
  const applyShowcase = useApplyShowcase();
  const [categoryParam, setCategory] = useFilterParam('category');
  const category = categoryParam || null;
  // a callback ref rather than useRef: the feed isn't in the tree at all
  // until `loaded` and `recent.length > 0`, and an effect keyed on a ref
  // object would never see it arrive — same reasoning as Canvas's own feed.
  const [feedEl, setFeedEl] = useState<HTMLDivElement | null>(null);
  const { tile: colWidth, cols: fitting } = masonryLayout(
    useElementWidth(feedEl),
    HOME_TILE,
    useViewportWidth() < PHONE,
  );

  /** Newest first. The strip is a glance at the work, not the work itself —
   * including work still running or that failed, so leaving mid-generation
   * or coming back to a failure doesn't read as "nothing happened". */
  const recent = useMemo(
    () =>
      [...nodes]
        .filter((n) => n.kind !== 'root' && (n.status !== 'done' || n.images.length > 0))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, RECENT),
    [nodes],
  );

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

  /** Never more columns than there are tiles to put in them, or the row ends
   * in empty columns — same guard as Canvas's own feed. */
  const recentCols = Math.max(1, Math.min(fitting, recent.length));

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
              {showcaseCategories.map((c) => (
                <button
                  type="button"
                  key={c}
                  role="tab"
                  aria-selected={category === c}
                  data-on={category === c ? '' : undefined}
                  onClick={() => setCategory(c)}
                >
                  {categoryLabel(c) ?? c} <span className="sc-vcount">{countFor(c)}</span>
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
          <div className="sc-tplrow" aria-hidden>
            <PresenterCardSkeleton size="grid" count={4} />
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
            <div className="sc-tplrow">
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

        <div className="sc-sec-head">
          <span className="sc-sec-title">Recent work</span>
          {recent.length > 0 && (
            <button type="button" className="sc-sec-more" onClick={() => toCreate()}>
              Open Create
            </button>
          )}
        </div>

        {/* loaded, so an empty brand is told it is empty rather than left blank */}
        {!loaded && <div className="sc-tplrow" aria-hidden />}
        {loaded && hasNoShots(nodes) && (
          <div className="sc-feed-empty">
            <p>Nothing yet.</p>
            <button type="button" className="sc-btn" onClick={() => toCreate({ compose: '1' })}>
              Start from scratch
            </button>
          </div>
        )}
        {loaded && !hasNoShots(nodes) && recent.length === 0 && (
          <p className="sc-feed-empty">Still working on your first shots. Check back in a moment.</p>
        )}
        {loaded && recent.length > 0 && (
          <div className="sc-feed" ref={setFeedEl} style={{ '--sc-tile': `${colWidth}px` } as CSSProperties}>
            {Array.from({ length: recentCols }, (_, c) => (
              // Dealt round-robin like Canvas's own feed, for the same reason:
              // the first row then reads left to right in sorted order, and a
              // resize remounts columns rather than reshuffling tiles between
              // surviving ones.
              // biome-ignore lint/suspicious/noArrayIndexKey: position, not identity — see Canvas.tsx's own feed for the identical pattern.
              <div className="sc-feed-col" key={`col-${recentCols}-${c}`}>
                {recent
                  .filter((_, i) => i % recentCols === c)
                  .map((n) => (
                    <button
                      type="button"
                      key={n.id}
                      className="sc-cell"
                      data-running={n.status === 'running' || undefined}
                      data-failed={n.status === 'error' || undefined}
                      data-cancelled={n.status === 'cancelled' || undefined}
                      onClick={() => navigate(shotPath(brand, null, n.id))}
                      title={
                        n.status === 'running'
                          ? 'Generating…'
                          : n.status === 'error'
                            ? n.error?.slice(0, 60) || 'Failed'
                            : n.status === 'cancelled'
                              ? 'Cancelled'
                              : n.prompt
                      }
                    >
                      {n.status === 'done' && n.images[0] && <img src={imgUrl(n.images[0])} alt="" loading="lazy" />}
                      {n.status === 'running' && (
                        <>
                          <span className="sc-shimmer" />
                          <span className="sc-cell-tag">Generating…</span>
                        </>
                      )}
                      {n.status === 'error' && (
                        <span className="sc-cell-failed">
                          <WarningCircle size={16} />
                          <span>{n.error?.slice(0, 40) || 'Failed'}</span>
                        </span>
                      )}
                      {n.status === 'cancelled' && (
                        <span className="sc-cell-failed">
                          <XCircle size={16} />
                          <span>Cancelled</span>
                        </span>
                      )}
                      {n.status === 'done' && n.kept && (
                        <span className="sc-cell-star">
                          <Star size={13} weight="fill" />
                        </span>
                      )}
                    </button>
                  ))}
              </div>
            ))}
          </div>
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
