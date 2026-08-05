import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertDialog, Button, Flex } from '@radix-ui/themes';
import { ImageSquare, Star, TrashSimple } from '@phosphor-icons/react';
import { api, assetUrl } from '../api.js';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { ProductsPanel } from '../AssetPanel.js';
import { favoriteLooks, toggleFavoriteLook } from '../favorites.js';

const ROLE_NAMES = ['Primary', 'Secondary', 'Accent', 'Accent 2', 'Neutral', 'Neutral 2'];

/** The kit page: everything generation starts from, first class. */
export function BrandView() {
  const { looks: templates, loaded: looksLoaded, refresh } = useAppData();
  const { brand } = useBrand();
  const navigate = useNavigate();
  const [favs, setFavs] = useState<string[]>(() => favoriteLooks(brand.id));

  useEffect(() => {
    setFavs(favoriteLooks(brand.id));
  }, [brand.id]);

  const json = brand.json ?? {};
  const name: string = json.meta?.name ?? brand.slug;
  const logo = assetUrl(json.logos?.[0]?.file);
  const palette: { hex: string; name: string }[] = [
    json.palette?.primary,
    json.palette?.secondary,
    ...(json.palette?.accent ?? []),
    ...(json.palette?.neutrals ?? []),
  ]
    .filter((c: any) => c?.hex)
    .map((c: any, i: number) => ({
      hex: String(c.hex).toUpperCase(),
      name: c.name ?? ROLE_NAMES[i] ?? `Color ${i + 1}`,
    }));
  const sorted = [...templates].sort((a, b) => Number(favs.includes(b.id)) - Number(favs.includes(a.id)));

  return (
    <div className="sc-home">
      <main className="sc-brandpage" id="main">
        <div className="sc-kit-hero">
          <span className="sc-kit-logo">
            {logo ? <img src={logo} alt="" /> : <ImageSquare size={20} color="var(--sc-fg3)" />}
          </span>
          <div>
            <h1>
              <span dir="auto">The {name}</span> <em>kit</em>
            </h1>
            {json.meta?.tagline && <p dir="auto">{json.meta.tagline}</p>}
            <p>Everything generated in this brand starts from what is on this page.</p>
          </div>
        </div>

        {palette.length > 0 && (
          <div className="sc-kit-sec">
            <div className="sc-sec-head">
              <span className="sc-sec-title">Palette</span>
            </div>
            <div className="sc-palette">
              {palette.slice(0, 6).map((c) => (
                <div key={c.hex} className="sc-palcol">
                  <span className="sc-palfill" style={{ background: c.hex }} />
                  <div className="sc-palmeta">
                    <b>{c.name}</b>
                    <small>{c.hex}</small>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="sc-kit-sec">
          <div className="sc-sec-head">
            <span className="sc-sec-title">Products</span>
          </div>
          <ProductsPanel brand={brand} onChanged={refresh} />
        </div>

        <div className="sc-kit-sec">
          <div className="sc-sec-head">
            <span className="sc-sec-title">Cast</span>
            <span style={{ fontSize: 12, color: 'var(--sc-fg3)' }}>
              Name someone with @ and the same face comes back
            </span>
          </div>
          <ProductsPanel brand={brand} onChanged={refresh} kind="characters" />
        </div>

        {!looksLoaded && <div className="sc-lookgrid" aria-hidden />}

        {looksLoaded && sorted.length > 0 && (
          <div className="sc-kit-sec">
            <div className="sc-sec-head">
              <span className="sc-sec-title">Favorite looks</span>
              <span style={{ fontSize: 12, color: 'var(--sc-fg3)' }}>Starred looks lead the template shelf</span>
            </div>
            <div className="sc-lookgrid">
              {sorted.slice(0, 8).map((t) => {
                const fav = favs.includes(t.id);
                return (
                  <button
                    type="button"
                    key={t.id}
                    className="sc-look"
                    onClick={() => setFavs(toggleFavoriteLook(brand.id, t.id))}
                    title={fav ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    {(t as any).previewUrl ? (
                      <img src={(t as any).previewUrl} alt={t.name} />
                    ) : (
                      <span
                        style={{ display: 'grid', placeItems: 'center', aspectRatio: '16/10', color: 'var(--sc-fg3)' }}
                      >
                        <ImageSquare size={18} />
                      </span>
                    )}
                    {fav && (
                      <span className="sc-lookfav">
                        <Star size={13} weight="fill" />
                      </span>
                    )}
                    <span className="sc-lookname">{t.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="sc-kit-sec">
          <div className="sc-danger">
            <TrashSimple size={15} color="var(--sc-fg3)" />
            <span style={{ flex: 1 }}>
              <b>Delete this brand</b>
              <small>Removes the kit, projects and shots. Cannot be undone.</small>
            </span>
            <AlertDialog.Root>
              <AlertDialog.Trigger>
                <button type="button" className="sc-btn sc-btn-danger">
                  Delete brand
                </button>
              </AlertDialog.Trigger>
              <AlertDialog.Content maxWidth="380px">
                <AlertDialog.Title>Delete {name}?</AlertDialog.Title>
                <AlertDialog.Description size="2">
                  The kit, its projects and every shot go with it. Exports you already downloaded stay yours. This
                  cannot be undone.
                </AlertDialog.Description>
                <Flex gap="3" mt="4" justify="end">
                  <AlertDialog.Cancel>
                    <Button variant="soft" color="gray">
                      Keep it
                    </Button>
                  </AlertDialog.Cancel>
                  <AlertDialog.Action>
                    <Button
                      color="red"
                      onClick={() =>
                        void api
                          .deleteBrand(brand.id)
                          .then(refresh)
                          .then(() => navigate('/', { replace: true }))
                      }
                    >
                      Delete brand
                    </Button>
                  </AlertDialog.Action>
                </Flex>
              </AlertDialog.Content>
            </AlertDialog.Root>
          </div>
        </div>
      </main>
    </div>
  );
}
