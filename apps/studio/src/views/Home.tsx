import { useMemo, useState, type ReactNode } from 'react';
import { productLabel, sceneLabel, showcaseSearchText } from '../displayName.js';
import { useNavigate } from 'react-router';
import { Badge, Dialog } from '@radix-ui/themes';
import { Aperture, Mountains, Package, User, X } from '@phosphor-icons/react';
import { assetUrl, type Brand, type ShowcaseEntry } from '../api.js';
import { useAppData } from '../app/AppShell.js';
import { useApplyPresenter } from '../app/useApplyPresenter.js';
import { useApplyScene } from '../app/useApplyScene.js';
import { showcaseBrief, useApplyShowcase } from '../app/useApplyShowcase.js';
import { useBrand } from '../app/BrandLayout.js';
import { hubPath, presenterPath, presentersPath, productPath, scenePath, scenesPath } from '../routes.js';
import { ProductsPanel } from '../AssetPanel.js';
import { favoriteScenes } from '../favorites.js';
import { PREF, useLocalPref } from '../prefs.js';
import { useToasts } from '../toasts.js';
import { showcaseCategoryLabel, sortShowcaseCategories } from '../showcaseCategories.js';
import { DensityControl, densitySize, densityWallStyle } from '../layout/DensityControl.js';
import { DENSITY_DEFAULT, normalizeDensity, type DensityCols } from '../layout/masonry.js';
import { Composer } from '../layout/Composer.js';
import { ComposerDock } from '../layout/ComposerDock.js';
import { ShowcaseCard, ShowcaseCardSkeleton } from '../layout/ShowcaseCard.js';
import { PresenterCard, PresenterCardSkeleton } from '../layout/PresenterCard.js';
import { SceneCard, SceneCardSkeleton } from '../layout/SceneCard.js';
import { ScrollPane } from '../layout/ScrollPane.js';
import { LibraryToolbar } from '../layout/library/LibraryToolbar.js';
import { FacetFilter } from '../layout/library/FacetFilter.js';
import { LibrarySearch } from '../layout/library/LibrarySearch.js';
import { LibraryZero } from '../layout/library/LibraryEmpty.js';
import { matchesQuery } from '../layout/library/libraryRules.js';
import { useLibraryQuery } from '../layout/library/useLibraryQuery.js';
import { PHONE, useMediaQuery } from '../useMediaQuery.js';

/** Same floor as every catalog page: below this, scanning beats typing. */
const SEARCH_MIN = 8;

/**
 * The launcher.
 *
 * Home decides what to do; Create is where it gets done. They were briefly one
 * screen, and Home inherited the working surface's furniture — an assets rail
 * down the side, an "empty set" where the greeting should be. Two jobs, two
 * screens: nothing here is a tool, everything is a way in.
 *
 * So there is no assets panel, no lens row and no selection here — but the
 * composer itself now docks at the bottom, the way Kive fuses gallery and
 * prompt. A showcase tile lands its whole recipe in that composer, in place:
 * chips, prose, settings, still on the wall, free to swap for another tile or
 * edit before committing. Send is the one moment that leaves — the brief
 * starts for real and the screen changes to Create, where results live.
 * Results never render here; Home proposes, Create shows.
 */
export function HomeView() {
  const {
    engines,
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
  const { brand, workspace, nodes, products: library } = useBrand();
  const navigate = useNavigate();
  const { push } = useToasts();
  const applyPresenter = useApplyPresenter();
  const applyScene = useApplyScene();
  const applyShowcase = useApplyShowcase();
  /** Phones drop the docked composer, so tiles deep-link into Create instead. */
  const phone = useMediaQuery(PHONE);
  // One URL-backed owner for search + category — two separate param hooks
  // writing from the same handler clobber each other (see useLibraryQuery).
  const { q, setQ, facets, setFacet, clearSearch, clear } = useLibraryQuery(['category']);
  const category = facets.category;
  const setCategory = (next: string | null) => setFacet('category', next);
  const searching = q.trim().length > 0;
  /** Shared wall density (compact | large) — separate from Create’s tile slider. */
  const [densityRaw, setDensityRaw] = useLocalPref(PREF.wallDensity, DENSITY_DEFAULT);
  const density = normalizeDensity(densityRaw);
  const setDensity = (cols: DensityCols) => setDensityRaw(cols);
  const wallStyle = densityWallStyle(density);
  const densityAttr = densitySize(density);

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

  /** The catalog objects a tile's recipe points at — one resolution shared by
   * the card chips and the search haystack. */
  const resolveRecipe = (entry: ShowcaseEntry) => {
    const productId = entry.brief.tokens.find((t: any) => t.t === 'product')?.id as string | undefined;
    const presenterId = entry.brief.tokens.find((t: any) => t.t === 'character')?.id;
    const sceneId = entry.brief.tokens.find((t: any) => t.t === 'template')?.id as string | undefined;
    return {
      product: productId ? demoProducts.find((p) => p.id === productId) : undefined,
      presenter: presenterId ? presenters.find((p) => p.id === presenterId) : undefined,
      scene: sceneId ? templates.find((t) => t.id === sceneId) : undefined,
    };
  };

  /** Haystack per tile, built once per catalog change, not per keystroke. */
  const searchText = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of showcase) {
      const { product, presenter, scene } = resolveRecipe(s);
      map.set(s.id, showcaseSearchText(s, { product, presenter, scene }, showcaseCategoryLabel(s.category)));
    }
    return map;
  }, [showcase, demoProducts, presenters, templates]);

  /** The gallery for the selected category — the API ships entries sorted by
   * their curated `order` field (the art-directed wall sequence), so no
   * client-side sorting: filtering must preserve that order. */
  const shownShowcase = useMemo(() => {
    const byCategory = category ? showcase.filter((s) => s.category === category) : showcase;
    return byCategory.filter((s) => matchesQuery(searchText.get(s.id) ?? s.title, q));
  }, [showcase, category, q, searchText]);

  /** Counts against the full gallery, not the filtered view — a tab always
   * states how many examples it holds, not how many are currently shown. */
  const categoryFacet = useMemo(() => {
    const cats = sortShowcaseCategories(showcaseCategories);
    return {
      key: 'category',
      label: 'Categories',
      everyLabel: 'All examples',
      everyCount: showcase.length,
      selected: category,
      onSelect: setCategory,
      options: cats.map((c) => ({
        value: c,
        label: showcaseCategoryLabel(c) ?? c,
        count: showcase.filter((s) => s.category === c).length,
      })),
    };
  }, [showcase, showcaseCategories, category, setCategory]);

  /** A showcase entry's tokens only carry ids — resolve the names the card
   * actually shows (the product/presenter/scene chips this recipe was built
   * from) against the same catalogs Composer resolves them against. */
  const recipeOf = (entry: (typeof showcase)[number]) => {
    const { product, presenter, scene } = resolveRecipe(entry);
    return {
      // Three names share one ellipsis-capped line here, so each gets its
      // tightest form. The full label lives in the credit tooltip.
      productName: product ? productLabel(product, 'chip') : null,
      productPreviewUrl: product?.previewUrl ?? null,
      productId: product?.id ?? null,
      presenterName: presenter?.name ?? null,
      // .sc-showcase-chip img is a circle — the square portrait fills it cleanly.
      presenterPreviewUrl: presenter?.avatarUrl ?? presenter?.previewUrl ?? null,
      presenterId: presenter?.id ?? null,
      sceneName: scene ? sceneLabel(scene, 'chip') : null,
      scenePreviewUrl: scene?.previewUrl ?? null,
      sceneId: scene?.id ?? null,
    };
  };

  /**
   * A tile's recipe, parked in the docked composer through the same
   * replace-wholesale channel Create's `?showcase=` arrival uses.
   */
  const [dockBrief, setDockBrief] = useState<any>(null);
  const stageShowcase = (id: string) => {
    const entry = showcase.find((s) => s.id === id);
    if (!entry) return;
    setDockBrief(showcaseBrief(entry));
    push({ kind: 'success', title: `Starting from "${entry.title}"` });
  };
  /** On a phone there is no dock to stage into — the tap carries the recipe to
   * Create via `?showcase=`, and Create's apply fires the one toast. */
  const openShowcase = phone ? applyShowcase : stageShowcase;

  /** The brand feed root, the same parent Create hangs new shots off. */
  const root = nodes.find((n) => n.kind === 'root') ?? null;

  /** Seed a scene (favorite first, else first in catalog) and open the products
   * attach — product, presenter, and scene chain in Create from there. */
  const startCompose = () => {
    const favs = favoriteScenes(brand.id);
    const sceneId = templates.find((t) => favs.includes(t.id))?.id ?? templates[0]?.id;
    toCreate(sceneId ? { scene: sceneId, attach: 'products', compose: '1' } : { attach: 'products', compose: '1' });
  };

  /** Curated create-strip heroes — preferred showcase/scene ids in quality
   * order. Claimed uniquely so the row never repeats a still. */
  const createThumbs = useMemo(() => {
    const used = new Set<string>();
    const claim = (url: string | null | undefined) => {
      if (!url || used.has(url)) return null;
      used.add(url);
      return url;
    };
    const fromShowcaseIds = (ids: string[]) => {
      for (const id of ids) {
        const hit = showcase.find((s) => s.id === id && s.previewUrl);
        const url = claim(hit?.previewUrl);
        if (url) return url;
      }
      return null;
    };
    const fromSceneIds = (ids: string[]) => {
      for (const id of ids) {
        const hit = templates.find((t) => t.id === id && t.previewUrl);
        const url = claim(hit?.previewUrl);
        if (url) return url;
      }
      return null;
    };
    const anyShowcase = (kind?: 'product' | 'character' | 'template') => {
      for (const s of showcase) {
        if (!s.previewUrl || used.has(s.previewUrl)) continue;
        if (kind && !s.brief.tokens.some((t: any) => t.t === kind)) continue;
        return claim(s.previewUrl);
      }
      return null;
    };

    const libraryShot = products.find((p: any) => assetUrl(p?.shots?.[0]?.file));

    return {
      // Was the product card hero — serum still reads as “make a shot”
      compose:
        claim(libraryShot ? assetUrl(libraryShot.shots?.[0]?.file) : null) ??
        fromShowcaseIds([
          'aurelia-serum-succulent-dew',
          'verity-pearls-suspended-silk',
          'solstice-aviators-screen-print',
        ]) ??
        claim(demoProducts.find((p) => p.id === 'aurelia-amber-serum')?.previewUrl) ??
        claim(demoProducts.find((p) => p.previewUrl)?.previewUrl) ??
        anyShowcase('product'),
      // Product in a moment — the volcanic runner we liked earlier
      product:
        fromShowcaseIds(['voss-rowe-runner-volcanic-ash', 'birchwood-salt-flat', 'voss-rowe-dune-slip-face']) ??
        claim(demoProducts.find((p) => p.id === 'voss-rowe-trail-runner')?.previewUrl) ??
        anyShowcase('product'),
      // Identity ref — Maren's square portrait, which fills the 1:1 glyph exactly
      presenter:
        claim(presenters.find((p) => p.id === 'maren')?.avatarUrl) ??
        claim(presenters.find((p) => p.avatarUrl)?.avatarUrl) ??
        claim(presenters.find((p) => p.previewUrl)?.previewUrl) ??
        anyShowcase('character'),
      // Place / light — scene catalog first, then environment-led showcase
      scene:
        fromSceneIds([
          'furniture-travertine-atrium',
          'wide-establishing-environment',
          'studio-soft-horizon',
          'studio-volcanic-ash-field',
          'furniture-lamplight-hours',
        ]) ??
        fromShowcaseIds(['moss-larkin-chair-travertine-atrium', 'calder-snow-loft', 'basalt-snells-window']) ??
        anyShowcase('template'),
    };
  }, [templates, presenters, products, demoProducts, showcase]);

  return (
    <ScrollPane>
      <main className="sc-main" id="main" data-no-dock={phone || undefined}>
        <h1 className="sc-greet">
          Compose a shot <em>on brand</em>
        </h1>

        <div className="sc-create-grid">
          <button type="button" className="sc-create-card" data-tone="compose" data-main="" onClick={startCompose}>
            <CreateGlyph thumbUrl={createThumbs.compose} fallback={<Aperture size={22} weight="fill" />} />
            <b>Create an image</b>
          </button>
          <ProductsCard brand={brand} onChanged={refresh} count={products.length} thumbUrl={createThumbs.product} />
          <ComingSoonCard
            tone="presenter"
            title="Create a presenter"
            thumbUrl={createThumbs.presenter}
            fallback={<User size={22} weight="fill" />}
          />
          <ComingSoonCard
            tone="scene"
            title="Create a scene"
            thumbUrl={createThumbs.scene}
            fallback={<Mountains size={22} weight="fill" />}
          />
        </div>

        {!showcaseLoaded && (
          <div className="sc-masonry" data-density data-density-size={densityAttr} style={wallStyle} aria-hidden>
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
            <LibraryToolbar
              filters={<FacetFilter mode="tabs" group={categoryFacet} />}
              search={
                showcase.length >= SEARCH_MIN && (
                  <LibrarySearch value={q} onChange={setQ} noun="examples" total={showcase.length} />
                )
              }
              density={<DensityControl value={density} onChange={setDensity} />}
            />

            {shownShowcase.length > 0 && (
              <div className="sc-masonry" data-wall data-density data-density-size={densityAttr} style={wallStyle}>
                {shownShowcase.map((s) => (
                  <ShowcaseCard
                    key={s.id}
                    entry={s}
                    size="grid"
                    onOpen={openShowcase}
                    onOpenProduct={(id) => navigate(productPath(brand, id))}
                    onOpenPresenter={(id) => navigate(presenterPath(brand, id))}
                    onOpenScene={(id) => navigate(scenePath(brand, id))}
                    {...recipeOf(s)}
                  />
                ))}
              </div>
            )}

            {shownShowcase.length === 0 &&
              (searching ? (
                <LibraryZero
                  noun="examples"
                  q={q}
                  facet={category ? showcaseCategoryLabel(category) : null}
                  onClearSearch={clearSearch}
                  onClearAll={clear}
                />
              ) : (
                <p className="sc-looks-empty">No example carries that category yet.</p>
              ))}
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
                <PresenterCard key={p.id} presenter={p} variant="navigate" size="grid" onOpen={applyPresenter} />
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
                <SceneCard key={s.id} scene={s} variant="navigate" size="grid" onOpen={applyScene} />
              ))}
            </div>
          </>
        )}
      </main>

      {/* The real Composer, not a stand-in: chips, attach, settings, drafts —
          everything Create's dock has, sharing the same per-brand draft. Send
          actually starts the brief (the workspace is brand-level, so it exists
          here the same as there), then moves to Create to watch it land.
          Desktop/tablet only: on a phone the dock is unmounted (the unmount
          flushes the draft, so half-typed briefs still reach Create). */}
      {!phone && (
        <ComposerDock>
          <Composer
            projectId={workspace?.id || null}
            brand={brand}
            engines={engines}
            parent={root}
            shots={nodes}
            initialBrief={dockBrief}
            onQueued={() => navigate(hubPath(brand))}
          />
        </ComposerDock>
      )}
    </ScrollPane>
  );
}

function ProductsCard({
  brand,
  onChanged,
  count,
  thumbUrl,
}: {
  brand: Brand;
  onChanged: () => void;
  count: number;
  thumbUrl?: string | null;
}) {
  return (
    <Dialog.Root>
      <Dialog.Trigger>
        <button type="button" className="sc-create-card" data-tone="product">
          <CreateGlyph thumbUrl={thumbUrl} fallback={<Package size={22} weight="fill" />} />
          <b>
            Add your product
            {count > 0 && (
              <Badge variant="soft" radius="full" size="1">
                {count}
              </Badge>
            )}
          </b>
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

/** Ingredient slot that is not buildable yet — keeps the composition story
 * visible without a dead click into a missing flow. */
function ComingSoonCard({
  tone,
  title,
  thumbUrl,
  fallback,
}: {
  tone: 'scene' | 'presenter';
  title: string;
  thumbUrl?: string | null;
  fallback: ReactNode;
}) {
  return (
    <button
      type="button"
      className="sc-create-card"
      data-tone={tone}
      data-soon=""
      disabled
      aria-disabled="true"
      aria-label={`${title} (coming soon)`}
      title="Coming soon"
    >
      <CreateGlyph thumbUrl={thumbUrl} fallback={fallback} />
      <b>{title}</b>
      <span className="sc-create-soon">Soon</span>
    </button>
  );
}

/** Photo well when we have a catalog frame; tinted icon only as fallback. */
function CreateGlyph({ thumbUrl, fallback }: { thumbUrl?: string | null; fallback?: ReactNode }) {
  return (
    <span className="sc-glyph" data-photo={thumbUrl ? '' : undefined} aria-hidden>
      {thumbUrl ? (
        <span className="sc-glyph-shot">
          <img src={thumbUrl} alt="" loading="lazy" />
        </span>
      ) : (
        fallback
      )}
    </span>
  );
}
