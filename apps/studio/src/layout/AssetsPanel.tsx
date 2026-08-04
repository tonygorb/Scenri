import { useMemo, useState } from 'react';
import { Dialog } from '@radix-ui/themes';
import { ImageSquare, MagnifyingGlass, Plus, X } from '@phosphor-icons/react';
import { assetUrl, imgUrl, type Brand, type Look, type TreeNode } from '../api.js';
import { ProductsPanel } from '../AssetPanel.js';
import { useProductLibrary } from '../useProductLibrary.js';

const ROLE_NAMES = ['Primary', 'Secondary', 'Accent', 'Accent 2', 'Neutral', 'Neutral 2'];

/**
 * Browsable mirror of the attach menu: the same groups TokenMenu serves,
 * as thumbnails. Clicking inserts into the composer; the sigil menus stay
 * the keyboard path.
 */
export function AssetsPanel({
  brand,
  templates,
  shots,
  onProduct,
  onCharacter,
  onColor,
  onRef,
  onTemplate,
  onBrandChanged,
  onClose,
}: {
  brand: Brand;
  templates: Look[];
  shots: TreeNode[];
  onProduct: (id: string) => void;
  onCharacter: (id: string) => void;
  onColor: (hex: string, name?: string) => void;
  onRef: (imageHash: string) => void;
  onTemplate: (id: string) => void;
  onBrandChanged: () => void;
  /** Drawer mode close (shown under 1280px only). */
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const library = useProductLibrary(brand.id);
  const products: any[] = library.length ? library : ((brand.json?.products ?? []) as any[]);
  const palette = useMemo(() => {
    const p = brand.json?.palette;
    const raw: { hex: string; name?: string }[] = [];
    const add = (c: any) => {
      if (c?.hex) raw.push({ hex: String(c.hex).toUpperCase(), name: c.name });
    };
    add(p?.primary);
    add(p?.secondary);
    (p?.accent ?? []).forEach(add);
    (p?.neutrals ?? []).forEach(add);
    return raw.map((c, i) => ({ hex: c.hex, name: c.name ?? ROLE_NAMES[i] ?? `Color ${i + 1}` }));
  }, [brand]);
  const recent = shots
    .filter((s) => s.status === 'done' && s.images.length > 0)
    .slice(-8)
    .reverse();

  const match = (label: string) => !q.trim() || label.toLowerCase().includes(q.trim().toLowerCase());
  const fProducts = products.filter((p) => match(p.name ?? ''));
  const cast: any[] = (brand.json?.characters ?? []) as any[];
  const fCast = cast.filter((c) => match(c.name ?? ''));
  const fTemplates = templates.filter((t) => match(t.name));
  const fPalette = palette.filter((c) => match(c.name) || match(c.hex));

  return (
    <aside className="sc-assets" aria-label="Assets">
      <div className="sc-assets-head">
        <b>Assets</b>
        <button
          type="button"
          className="sc-icon-btn"
          onClick={onClose}
          aria-label="Close assets"
          style={{ width: 28, height: 28 }}
        >
          <X size={12} />
        </button>
      </div>
      <div className="sc-assets-search">
        <MagnifyingGlass size={12} />
        <input placeholder="Search assets" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="sc-agroup">
        <div className="sc-agroup-h">
          <b>Products</b>
          <Dialog.Root>
            <Dialog.Trigger>
              <button type="button" className="sc-aadd" title="Add product" aria-label="Add product">
                <Plus size={10} />
              </button>
            </Dialog.Trigger>
            <Dialog.Content maxWidth="560px">
              <Dialog.Title>Products: {brand.json?.meta?.name}</Dialog.Title>
              <ProductsPanel brand={brand} onChanged={onBrandChanged} />
            </Dialog.Content>
          </Dialog.Root>
        </div>
        {fProducts.length > 0 ? (
          <>
            <div className="sc-arow">
              {fProducts.map((p) => {
                const shot = assetUrl(p.shots?.[0]?.file);
                return (
                  <button type="button" key={p.id} title={p.name} onClick={() => onProduct(p.id)}>
                    {shot ? (
                      <img src={shot} alt={p.name} />
                    ) : (
                      <span className="sc-aswatch" style={{ display: 'grid', placeItems: 'center' }}>
                        <ImageSquare size={14} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="sc-anote">Click to attach. Locked shots keep the product exact.</p>
          </>
        ) : (
          <p className="sc-anote">{q ? 'No product matches.' : 'No products yet. Add one so shots stay exact.'}</p>
        )}
      </div>

      <div className="sc-agroup">
        <div className="sc-agroup-h">
          <b>Cast</b>
          <Dialog.Root>
            <Dialog.Trigger>
              <button type="button" className="sc-aadd" title="Add someone" aria-label="Add someone">
                <Plus size={10} />
              </button>
            </Dialog.Trigger>
            <Dialog.Content maxWidth="560px">
              <Dialog.Title>Cast: {brand.json?.meta?.name}</Dialog.Title>
              <ProductsPanel brand={brand} onChanged={onBrandChanged} kind="characters" />
            </Dialog.Content>
          </Dialog.Root>
        </div>
        {fCast.length > 0 ? (
          <>
            <div className="sc-arow">
              {fCast.map((c) => {
                const shot = assetUrl(c.shots?.[0]?.file);
                return (
                  <button type="button" key={c.id} title={c.name} onClick={() => onCharacter(c.id)}>
                    {shot ? (
                      <img src={shot} alt={c.name} />
                    ) : (
                      <span className="sc-aswatch" style={{ display: 'grid', placeItems: 'center' }}>
                        <ImageSquare size={14} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="sc-anote">Name someone once and they come back the same.</p>
          </>
        ) : (
          <p className="sc-anote">{q ? 'Nobody matches.' : 'No cast yet. Add someone to keep a face consistent.'}</p>
        )}
      </div>

      {fTemplates.length > 0 && (
        <div className="sc-agroup">
          <div className="sc-agroup-h">
            <b>Looks</b>
          </div>
          <div className="sc-arow">
            {fTemplates.slice(0, 8).map((t) => (
              <button type="button" key={t.id} title={t.name} onClick={() => onTemplate(t.id)}>
                {(t as any).previewUrl ? (
                  <img src={(t as any).previewUrl} alt={t.name} />
                ) : (
                  <span className="sc-aswatch" style={{ display: 'grid', placeItems: 'center' }}>
                    <ImageSquare size={14} />
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {fPalette.length > 0 && (
        <div className="sc-agroup">
          <div className="sc-agroup-h">
            <b>Brand colors</b>
          </div>
          <div className="sc-arow">
            {fPalette.map((c) => (
              <button type="button" key={c.hex} title={`${c.name} ${c.hex}`} onClick={() => onColor(c.hex, c.name)}>
                <span className="sc-aswatch" style={{ background: c.hex }} />
              </button>
            ))}
          </div>
        </div>
      )}

      {recent.length > 0 && !q && (
        <div className="sc-agroup">
          <div className="sc-agroup-h">
            <b>Recent shots</b>
          </div>
          <div className="sc-arow">
            {recent.map((s) => (
              <button type="button" key={s.id} title="Attach as a style reference" onClick={() => onRef(s.images[0])}>
                <img src={imgUrl(s.images[0])} alt="" />
              </button>
            ))}
          </div>
          <p className="sc-anote">Attach as a style reference.</p>
        </div>
      )}
    </aside>
  );
}
