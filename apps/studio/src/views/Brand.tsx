import { useEffect, useState } from 'react';
import { AlertDialog, Button, Flex } from '@radix-ui/themes';
import { CaretDown, ImageSquare, Star, TrashSimple } from '@phosphor-icons/react';
import { DropdownMenu } from '@radix-ui/themes';
import { api, assetUrl, type Brand, type EngineInfo, type Look } from '../api.js';
import { TopBar, Wordmark, type NavItem } from '../layout/TopBar.js';
import { ProductsPanel } from '../AssetPanel.js';
import { favoriteLooks, toggleFavoriteLook } from '../favorites.js';

const ROLE_NAMES = ['Primary', 'Secondary', 'Accent', 'Accent 2', 'Neutral', 'Neutral 2'];

/** The kit page: everything generation starts from, first class. */
export function BrandView({
  brand,
  brands,
  engines,
  nav,
  onSelectBrand,
  onSetup,
  onDeleted,
  onBrandChanged,
  settingsButton,
}: {
  brand: Brand;
  brands: Brand[];
  engines: EngineInfo[];
  nav: NavItem[];
  onSelectBrand: (id: string) => void;
  onSetup: () => void;
  onDeleted: () => void;
  onBrandChanged: () => void;
  settingsButton: React.ReactNode;
}) {
  const [templates, setTemplates] = useState<Look[]>([]);
  const [favs, setFavs] = useState<string[]>(() => favoriteLooks(brand.id));

  useEffect(() => {
    void api
      .looks()
      .then((r) => setTemplates(r.looks))
      .catch(() => {});
  }, []);
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
    <div className="bt-home">
      <TopBar
        engines={engines}
        nav={nav}
        left={
          <Flex align="center" gap="3">
            <Wordmark />
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                <button type="button" className="bt-brand-pill">
                  <span className="bt-brand-dot" style={{ background: palette[0]?.hex ?? 'var(--bt-fg3)' }} />
                  {name}
                  <CaretDown size={11} />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content>
                {brands.map((b) => (
                  <DropdownMenu.Item key={b.id} onSelect={() => onSelectBrand(b.id)}>
                    {b.json?.meta?.name ?? b.slug}
                  </DropdownMenu.Item>
                ))}
                <DropdownMenu.Separator />
                <DropdownMenu.Item onSelect={onSetup}>Set up a brand</DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </Flex>
        }
        right={settingsButton}
      />

      <main className="bt-brandpage">
        <div className="bt-kit-hero">
          <span className="bt-kit-logo">
            {logo ? <img src={logo} alt="" /> : <ImageSquare size={20} color="var(--bt-fg3)" />}
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
          <div className="bt-kit-sec">
            <div className="bt-sec-head">
              <span className="bt-sec-title">Palette</span>
            </div>
            <div className="bt-palette">
              {palette.slice(0, 6).map((c) => (
                <div key={c.hex} className="bt-palcol">
                  <span className="bt-palfill" style={{ background: c.hex }} />
                  <div className="bt-palmeta">
                    <b>{c.name}</b>
                    <small>{c.hex}</small>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bt-kit-sec">
          <div className="bt-sec-head">
            <span className="bt-sec-title">Products</span>
          </div>
          <ProductsPanel brand={brand} onChanged={onBrandChanged} />
        </div>

        <div className="bt-kit-sec">
          <div className="bt-sec-head">
            <span className="bt-sec-title">Cast</span>
            <span style={{ fontSize: 12, color: 'var(--bt-fg3)' }}>
              Name someone with @ and the same face comes back
            </span>
          </div>
          <ProductsPanel brand={brand} onChanged={onBrandChanged} kind="characters" />
        </div>

        {sorted.length > 0 && (
          <div className="bt-kit-sec">
            <div className="bt-sec-head">
              <span className="bt-sec-title">Favorite looks</span>
              <span style={{ fontSize: 12, color: 'var(--bt-fg3)' }}>Starred looks lead the template shelf</span>
            </div>
            <div className="bt-lookgrid">
              {sorted.slice(0, 8).map((t) => {
                const fav = favs.includes(t.id);
                return (
                  <button
                    type="button"
                    key={t.id}
                    className="bt-look"
                    onClick={() => setFavs(toggleFavoriteLook(brand.id, t.id))}
                    title={fav ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    {(t as any).previewUrl ? (
                      <img src={(t as any).previewUrl} alt={t.name} />
                    ) : (
                      <span
                        style={{ display: 'grid', placeItems: 'center', aspectRatio: '16/10', color: 'var(--bt-fg3)' }}
                      >
                        <ImageSquare size={18} />
                      </span>
                    )}
                    {fav && (
                      <span className="bt-lookfav">
                        <Star size={13} weight="fill" />
                      </span>
                    )}
                    <span className="bt-lookname">{t.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="bt-kit-sec">
          <div className="bt-danger">
            <TrashSimple size={15} color="var(--bt-fg3)" />
            <span style={{ flex: 1 }}>
              <b>Delete this brand</b>
              <small>Removes the kit, projects and shots. Cannot be undone.</small>
            </span>
            <AlertDialog.Root>
              <AlertDialog.Trigger>
                <button type="button" className="bt-btn bt-btn-danger">
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
                    <Button color="red" onClick={() => void api.deleteBrand(brand.id).then(onDeleted)}>
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
