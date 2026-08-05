import { useMemo, useState, type ReactNode } from 'react';
import { Dialog } from '@radix-ui/themes';
import { CaretRight, ImageSquare, MagnifyingGlass, Plus, X } from '@phosphor-icons/react';
import { assetUrl, imgUrl, type Brand, type Look, type TreeNode } from '../api.js';
import { ProductsPanel } from '../AssetPanel.js';
import { PREF, useLocalPref } from '../prefs.js';
import { useProductLibrary } from '../useProductLibrary.js';

const ROLE_NAMES = ['Primary', 'Secondary', 'Accent', 'Accent 2', 'Neutral', 'Neutral 2'];

/**
 * How much of a group the rail shows before it starts hiding the ones below it.
 *
 * A catalog import can land five hundred products, and this column used to
 * render every one of them: Cast, Looks and Brand colours were then a very long
 * scroll below the fold, which read as though the brand had none.
 */
const PREVIEW = 12;

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

  const searching = !!q.trim();
  const match = (label: string) => !searching || label.toLowerCase().includes(q.trim().toLowerCase());
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

      <Group
        name="Products"
        count={fProducts.length}
        searching={searching}
        action={
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
        }
        empty={q ? 'No product matches.' : 'No products yet. Add one so shots stay exact.'}
        note="Click to attach. Locked shots keep the product exact."
        render={(shown) =>
          shown.map((p: any) => {
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
          })
        }
        items={fProducts}
      />

      <Group
        name="Cast"
        count={fCast.length}
        searching={searching}
        action={
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
        }
        empty={q ? 'Nobody matches.' : 'No cast yet. Add someone to keep a face consistent.'}
        note="Name someone once and they come back the same."
        items={fCast}
        render={(shown) =>
          shown.map((c: any) => {
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
          })
        }
      />

      {fTemplates.length > 0 && (
        <Group
          name="Looks"
          count={fTemplates.length}
          searching={searching}
          items={fTemplates}
          render={(shown) =>
            shown.map((t: Look) => (
              <button type="button" key={t.id} title={t.name} onClick={() => onTemplate(t.id)}>
                {t.previewUrl ? (
                  <img src={t.previewUrl} alt={t.name} />
                ) : (
                  <span className="sc-aswatch" style={{ display: 'grid', placeItems: 'center' }}>
                    <ImageSquare size={14} />
                  </span>
                )}
              </button>
            ))
          }
        />
      )}

      {fPalette.length > 0 && (
        <Group
          name="Brand colors"
          count={fPalette.length}
          searching={searching}
          items={fPalette}
          render={(shown) =>
            shown.map((c: { hex: string; name: string }) => (
              <button type="button" key={c.hex} title={`${c.name} ${c.hex}`} onClick={() => onColor(c.hex, c.name)}>
                <span className="sc-aswatch" style={{ background: c.hex }} />
              </button>
            ))
          }
        />
      )}

      {recent.length > 0 && !searching && (
        <Group
          name="Recent shots"
          count={recent.length}
          searching={searching}
          items={recent}
          note="Attach as a style reference."
          render={(shown) =>
            shown.map((s: TreeNode) => (
              <button type="button" key={s.id} title="Attach as a style reference" onClick={() => onRef(s.images[0])}>
                <img src={imgUrl(s.images[0])} alt="" />
              </button>
            ))
          }
        />
      )}
    </aside>
  );
}

/**
 * One foldable group of the rail.
 *
 * Two separate limits, because they answer two different complaints. Folding
 * is about the groups *below* this one: with a large catalog, Cast and Brand
 * colours were an endless scroll away, and a fold is how you get past a group
 * you are not using today. The preview cap is about this group itself, so that
 * five hundred products do not have to be drawn to see the first twelve.
 *
 * A search overrules the fold. Typing into the box and getting nothing back
 * because the matches were behind a collapsed header would read as the search
 * being broken.
 */
function Group<T>({
  name,
  count,
  items,
  render,
  action,
  note,
  empty,
  searching,
}: {
  name: string;
  count: number;
  items: T[];
  render: (shown: T[]) => ReactNode;
  action?: ReactNode;
  note?: string;
  empty?: string;
  searching: boolean;
}) {
  const [closed, setClosed] = useLocalPref<Record<string, boolean>>(PREF.assetsClosed, {});
  const [showAll, setShowAll] = useState(false);
  const folded = !searching && !!closed[name];
  const shown = showAll || searching ? items : items.slice(0, PREVIEW);
  const hidden = items.length - shown.length;

  return (
    <div className="sc-agroup" data-closed={folded || undefined}>
      <div className="sc-agroup-h">
        <button
          type="button"
          className="sc-agroup-t"
          aria-expanded={!folded}
          onClick={() => setClosed((c) => ({ ...c, [name]: !c[name] }))}
        >
          <CaretRight size={11} className="sc-agroup-caret" />
          <b>{name}</b>
          {count > 0 && <span className="sc-agroup-n">{count}</span>}
        </button>
        {action}
      </div>

      {!folded &&
        (items.length === 0 && empty ? (
          <p className="sc-anote">{empty}</p>
        ) : (
          <>
            <div className="sc-arow">{render(shown)}</div>
            {hidden > 0 && (
              <button type="button" className="sc-amore" onClick={() => setShowAll(true)}>
                Show {hidden} more
              </button>
            )}
            {showAll && items.length > PREVIEW && (
              <button type="button" className="sc-amore" onClick={() => setShowAll(false)}>
                Show fewer
              </button>
            )}
            {note && <p className="sc-anote">{note}</p>}
          </>
        ))}
    </div>
  );
}
