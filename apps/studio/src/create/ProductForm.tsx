import { useState } from 'react';
import { TextField } from '@radix-ui/themes';
import { api } from '../api.js';
import { useBrand } from '../app/BrandLayout.js';
import { PRODUCT_CATEGORIES } from '../productCategories.js';
import { AssetCreateShell } from './AssetCreateShell.js';
import { RefStrip } from './RefStrip.js';
import { useAssetFields } from './useAssetFields.js';
import type { FlowProps } from './flow.js';

/**
 * Six is generous on purpose. A brief attaches the first three; the rest are
 * the angles a category asks for, filled in now rather than one at a time later.
 */
const MAX_REFS = 6;
/** Mirrors PRODUCT_REF_MAX in packages/cli/src/brief.ts. */
const USED_IN_SHOTS = 3;

/**
 * Adding the thing you sell.
 *
 * The one flow that costs nothing and finishes instantly: no analysis, no
 * engine, no waiting. It says so in the same place the other two say what they
 * are about to spend, which is what makes them read as one family rather than
 * one fast form and two slow ones.
 *
 * A store URL is the other way in, kept as a disclosure rather than a second
 * top-level choice — it was a menu item pretending to be its own flow, and it
 * opened this exact dialog.
 */
export function ProductForm({ onBack, onStarted }: FlowProps) {
  const { brand } = useBrand();
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const f = useAssetFields(brand.id, 'product', { max: MAX_REFS, pendingState: () => 'unknown' });

  const ready = f.fields.imageHashes.length > 0;
  const blocked = ready ? undefined : 'Add at least one image of it';

  const create = async () => {
    setBusy(true);
    f.setErr(null);
    try {
      const res = await api.createProduct(brand.id, {
        name: f.fields.name.trim(),
        imageHashes: f.fields.imageHashes,
        category: f.fields.facets[0],
      });
      const name = f.fields.name.trim() || 'Product';
      f.submitted(null);
      onStarted({ kind: 'product', id: res.productId, name });
    } catch (e: any) {
      f.setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const startImport = async () => {
    const url = f.fields.importUrl.trim() || (brand.json?.meta?.website ?? '');
    if (!url) return;
    setImporting(true);
    f.setErr(null);
    try {
      await api.catalogImport(brand.id, url);
      f.set({ importUrl: '' });
      // The import is a task like any other: it reports in the bell, with a real
      // progress bar, so there is nothing left for this dialog to watch.
      onStarted({ kind: 'product', id: '', name: url });
    } catch (e: any) {
      f.setErr(String(e.message ?? e));
    } finally {
      setImporting(false);
    }
  };

  return (
    <AssetCreateShell
      title="New product"
      sub="Photographs of the thing itself. These are what every shot of it is built from."
      error={f.err}
      footnote="Saved to this brand straight away. Nothing is generated."
      primaryLabel="Add product"
      ready={ready}
      blocked={blocked}
      busy={busy}
      onBack={onBack}
      onPrimary={() => void create()}
    >
      <div className="sc-assetform">
        <RefStrip
          hashes={f.fields.imageHashes}
          max={MAX_REFS}
          label="Add images"
          hint={`Straight, well-lit packshots. The first ${USED_IN_SHOTS} are the ones a shot attaches.`}
          busy={f.uploading}
          onAdd={(files) => void f.addFiles(files)}
          onRemove={f.removeHash}
          onReject={() => f.setErr('Drop an image file.')}
        />

        <TextField.Root
          placeholder="Product name (e.g. House Blend 250g)"
          value={f.fields.name}
          onChange={(e) => f.set({ name: e.target.value })}
        />

        {/* One category, not many: a product is one kind of object, and the
            choice decides which reference angles its page then asks for. */}
        <fieldset className="sc-assetform-facets">
          <legend>Filed under</legend>
          {PRODUCT_CATEGORIES.map((c) => (
            <button
              type="button"
              key={c.key}
              className="sc-chip"
              data-on={f.fields.facets[0] === c.key || undefined}
              aria-pressed={f.fields.facets[0] === c.key}
              onClick={() => f.set({ facets: f.fields.facets[0] === c.key ? [] : [c.key] })}
            >
              {c.label}
            </button>
          ))}
        </fieldset>
      </div>

      <div className="sc-newdlg-secondary">
        {showImport ? (
          <>
            <label className="sc-newdlg-seclabel" htmlFor="sc-import-url">
              Your store's address
            </label>
            <div className="sc-newdlg-secrow">
              <TextField.Root
                id="sc-import-url"
                placeholder={brand.json?.meta?.website ?? 'https://yourstore.com'}
                value={f.fields.importUrl}
                onChange={(e) => f.set({ importUrl: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void startImport();
                }}
              />
              <button
                type="button"
                className="sc-btn sc-btn-ghost"
                disabled={importing}
                onClick={() => void startImport()}
              >
                {importing ? 'Starting…' : 'Import'}
              </button>
            </div>
          </>
        ) : (
          <button type="button" className="sc-newdlg-secmore" onClick={() => setShowImport(true)}>
            Have a store? Import your whole catalog
          </button>
        )}
      </div>
    </AssetCreateShell>
  );
}
