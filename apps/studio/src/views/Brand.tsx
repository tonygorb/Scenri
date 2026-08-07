import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertDialog, Button, Flex, Spinner } from '@radix-ui/themes';
import { ImageSquare, Plus, TrashSimple } from '@phosphor-icons/react';
import { api, assetUrl } from '../api.js';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { favoriteScenes, toggleFavoriteScene } from '../favorites.js';
import { SceneCard, SceneCardSkeleton } from '../layout/SceneCard.js';
import { useToasts } from '../toasts.js';

const ROLE_NAMES = ['Primary', 'Secondary', 'Accent', 'Accent 2', 'Neutral', 'Neutral 2'];

/** The brand page: identity only — logo, palette, favorite scenes. Products and Presenters live in their own areas now. */
export function BrandView() {
  const { scenes: templates, loaded: scenesLoaded, refresh } = useAppData();
  const { brand } = useBrand();
  const navigate = useNavigate();
  const { push } = useToasts();
  const [favs, setFavs] = useState<string[]>(() => favoriteScenes(brand.id));
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setFavs(favoriteScenes(brand.id));
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

  // Every scratch-created brand (not scraped from a website) permanently and
  // silently omitted this whole section — read-only with no fallback at zero
  // colors. Local state, not the derived `palette` above, is what renders:
  // that keeps a name edit's cursor and an in-flight save from fighting each
  // other across a `brand` re-render that hasn't reflected it yet.
  const [colors, setColors] = useState<{ hex: string; name: string }[]>(() => palette);
  useEffect(() => {
    setColors(palette);
    // deliberately brand.id only: resync on a brand switch, not on every
    // write this same section just made
  }, [brand.id]);
  const nameSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rebuildPalette = (list: { hex: string; name: string }[]) => {
    const [p, s, ...rest] = list;
    const asColor = (c: { hex: string; name: string }) =>
      c.name.trim() ? { hex: c.hex, name: c.name.trim() } : { hex: c.hex };
    const out: any = {};
    if (p) out.primary = asColor(p);
    if (s) out.secondary = asColor(s);
    if (rest.length) out.accent = rest.map(asColor);
    if (json.palette?.usage) out.usage = json.palette.usage;
    return out;
  };

  const savePalette = (list: { hex: string; name: string }[]) => {
    void api
      .updateBrand(brand.id, { ...json, palette: rebuildPalette(list) })
      .then(() => refresh())
      .catch((e: any) =>
        push({ kind: 'error', title: 'Could not update the palette', detail: String(e.message ?? e) }),
      );
  };

  /** Every mutation cancels whatever save was pending, immediate or debounced
   * — otherwise an in-flight name edit could complete after a later remove/add
   * and silently resurrect what the user just deleted. */
  const commitPalette = (list: { hex: string; name: string }[], debounce: boolean) => {
    if (nameSaveTimer.current) {
      clearTimeout(nameSaveTimer.current);
      nameSaveTimer.current = null;
    }
    if (debounce) nameSaveTimer.current = setTimeout(() => savePalette(list), 500);
    else savePalette(list);
  };

  const updateColorHex = (i: number, hex: string) => {
    const next = colors.map((c, idx) => (idx === i ? { ...c, hex } : c));
    setColors(next);
    commitPalette(next, false);
  };
  const updateColorName = (i: number, name: string) => {
    const next = colors.map((c, idx) => (idx === i ? { ...c, name } : c));
    setColors(next);
    commitPalette(next, true);
  };
  const removeColor = (i: number) => {
    const next = colors.filter((_, idx) => idx !== i);
    setColors(next);
    commitPalette(next, false);
  };
  const addColor = () => {
    const next = [...colors, { hex: '#CCCCCC', name: '' }];
    setColors(next);
    commitPalette(next, false);
  };

  return (
    <div className="sc-home">
      <main className="sc-brandpage" id="main">
        <div className="sc-kit-hero">
          <span className="sc-kit-logo">
            {logo ? <img src={logo} alt="" /> : <ImageSquare size={20} color="var(--sc-fg3)" />}
          </span>
          <div>
            <h1>
              <span dir="auto">The {name}</span> <em>brand</em>
            </h1>
            {json.meta?.tagline && <p dir="auto">{json.meta.tagline}</p>}
            <p>The identity every generation stays true to — logo, palette and rules.</p>
          </div>
        </div>

        <div className="sc-kit-sec">
          <div className="sc-sec-head">
            <span className="sc-sec-title">Palette</span>
            <button type="button" className="sc-sec-more" onClick={addColor}>
              <Plus size={12} /> Add color
            </button>
          </div>
          {colors.length === 0 ? (
            <p className="sc-palette-empty">
              No colors yet. Add one so shots pull from your real brand palette instead of guessing.
            </p>
          ) : (
            <div className="sc-palette">
              {colors.map((c, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: positions, not records — a swatch has no id of its own, only append/remove-by-index
                <div key={i} className="sc-palcol">
                  <label className="sc-palfill" style={{ background: c.hex }}>
                    <input
                      type="color"
                      value={c.hex}
                      onChange={(e) => updateColorHex(i, e.target.value)}
                      aria-label={`${c.name || ROLE_NAMES[i] || `Color ${i + 1}`} value`}
                    />
                  </label>
                  <div className="sc-palmeta">
                    <input
                      className="sc-palname"
                      value={c.name}
                      placeholder={ROLE_NAMES[i] ?? `Color ${i + 1}`}
                      onChange={(e) => updateColorName(i, e.target.value)}
                      aria-label="Color name"
                    />
                    <small>{c.hex.toUpperCase()}</small>
                  </div>
                  <button
                    type="button"
                    className="sc-palremove"
                    onClick={() => removeColor(i)}
                    aria-label={`Remove ${c.name || ROLE_NAMES[i] || `color ${i + 1}`}`}
                  >
                    <TrashSimple size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {!scenesLoaded && (
          <div className="sc-lookgrid" aria-hidden>
            <SceneCardSkeleton size="grid" count={8} />
          </div>
        )}

        {scenesLoaded && sorted.length > 0 && (
          <div className="sc-kit-sec">
            <div className="sc-sec-head">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span className="sc-sec-title">Favorite scenes</span>
                <span style={{ fontSize: 12, color: 'var(--sc-fg3)' }}>Starred scenes lead the template shelf</span>
              </div>
            </div>
            <div className="sc-lookgrid">
              {sorted.slice(0, 8).map((t) => (
                <SceneCard
                  key={t.id}
                  scene={t}
                  variant="select"
                  size="grid"
                  selected={favs.includes(t.id)}
                  onToggle={(id) => setFavs(toggleFavoriteScene(brand.id, id))}
                />
              ))}
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
                      disabled={deleting}
                      onClick={() => {
                        setDeleting(true);
                        void api
                          .deleteBrand(brand.id)
                          .then(refresh)
                          .then(() => navigate('/', { replace: true }))
                          .catch((e) => {
                            setDeleting(false);
                            push({
                              kind: 'error',
                              title: 'Could not delete this brand',
                              detail: String(e.message ?? e),
                            });
                          });
                      }}
                    >
                      {deleting ? <Spinner size="1" /> : 'Delete brand'}
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
