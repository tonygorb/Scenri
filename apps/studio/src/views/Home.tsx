import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Badge } from '@radix-ui/themes';
import { ImageSquare, Package, Sparkle, Star, UsersThree } from '@phosphor-icons/react';
import { hasNoShots, imgUrl } from '../api.js';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { brandPath } from '../app/brandPath.js';
import { favoriteLooks } from '../favorites.js';
import { LookCard, LookCardSkeleton } from '../layout/LookCard.js';

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

export function HomeView() {
  const { looks: templates, loaded: looksLoaded } = useAppData();
  const { brand, nodes, loaded } = useBrand();
  const navigate = useNavigate();

  /** Newest first. The strip is a glance at the work, not the work itself. */
  const recent = useMemo(
    () =>
      [...nodes]
        .filter((n) => n.kind !== 'root' && n.status === 'done' && n.images.length > 0)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, RECENT),
    [nodes],
  );

  /** Every way in lands on the same hub, differing only in what it carries. */
  const toCreate = (qs?: Record<string, string>) => {
    const q = new URLSearchParams(qs ?? {}).toString();
    navigate(brandPath(brand, `/create${q ? `?${q}` : ''}`));
  };

  const products = (brand.json?.products ?? []) as any[];

  /** A real pre-fill, not "Start from scratch" with a different label: pick
   * the look for you (favorite first, else whatever's first) and go straight
   * to adding the product it's for — the two things every shoot needs. */
  const startPhotoshoot = () => {
    const favs = favoriteLooks(brand.id);
    const lookId = templates.find((t) => favs.includes(t.id))?.id ?? templates[0]?.id;
    toCreate(lookId ? { look: lookId, attach: 'products', compose: '1' } : { attach: 'products', compose: '1' });
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
          <button
            type="button"
            className="sc-create-card"
            onClick={() => toCreate({ attach: 'products', compose: '1' })}
          >
            <span className="sc-glyph">
              <Package size={16} />
            </span>
            <span>
              <b>
                Add a product{' '}
                {products.length > 0 && (
                  <Badge variant="soft" radius="full" size="1">
                    {products.length}
                  </Badge>
                )}
              </b>
              <small>Locked shots keep it exact</small>
            </span>
          </button>
          <button type="button" className="sc-create-card" onClick={() => navigate('/setup')}>
            <span className="sc-glyph">
              <UsersThree size={16} />
            </span>
            <span>
              <b>Set up a brand</b>
              <small>Kit from a URL in a minute</small>
            </span>
          </button>
        </div>

        {!looksLoaded && (
          <div className="sc-tplrow" aria-hidden>
            <LookCardSkeleton size="shelf" />
          </div>
        )}

        {looksLoaded && templates.length > 0 && (
          <>
            <div className="sc-sec-head">
              <span className="sc-sec-title">Looks</span>
              <button type="button" className="sc-sec-more" onClick={() => navigate(brandPath(brand, '/looks'))}>
                All looks
              </button>
            </div>
            <div className="sc-tplrow">
              {[...templates]
                .sort((a, b) => {
                  const favs = favoriteLooks(brand.id);
                  return Number(favs.includes(b.id)) - Number(favs.includes(a.id));
                })
                .map((t) => (
                  <LookCard
                    key={t.id}
                    look={t}
                    variant="navigate"
                    size="shelf"
                    onOpen={(id) => toCreate({ look: id, compose: '1' })}
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
          <div className="sc-recentrow">
            {recent.map((n) => (
              <button
                type="button"
                key={n.id}
                className="sc-recent"
                onClick={() => navigate(brandPath(brand, `/create/n/${n.id}`))}
                title={n.prompt}
              >
                <img src={imgUrl(n.images[0])} alt="" loading="lazy" />
                {n.kept && (
                  <span className="sc-cell-star">
                    <Star size={13} weight="fill" />
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
