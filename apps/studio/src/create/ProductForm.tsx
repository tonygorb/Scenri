import { type KeyboardEvent, useEffect, useState } from 'react';
import { ProductChoice } from '../views/brandSetup/ProductChoice.js';
import { useCommerceScan } from '../views/brandSetup/useCommerceScan.js';
import { api } from '../api.js';
import { useAppData } from '../app/AppShell.js';
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
 */
export function ProductForm({ onBack, onStarted, restore, onDiscarded }: FlowProps) {
  const { brand } = useBrand();
  const { applyBrand } = useAppData();
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const f = useAssetFields(brand.id, 'product', { max: MAX_REFS, pendingState: () => 'unknown', restore, onDiscarded });

  const ready = f.fields.imageHashes.length > 0;
  const blocked = ready ? undefined : 'Add at least one photo';

  const create = async () => {
    setBusy(true);
    f.setErr(null);
    try {
      const { productId, ...row } = await api.createProduct(brand.id, {
        name: f.fields.name.trim(),
        imageHashes: f.fields.imageHashes,
        category: f.fields.facets[0],
      });
      // The answer is the brand with the product in it: applied here, before
      // anything announces it, so the wall, the picker and the chip the picker
      // is about to insert all find it in the same commit.
      applyBrand(row);
      const name = f.fields.name.trim() || 'Product';
      f.submitted(null);
      onStarted({ kind: 'product', id: productId, name });
    } catch (e: any) {
      f.setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Look first, then choose - the same two steps `/setup` takes.
   *
   * This used to start a whole-catalog crawl the moment someone pressed
   * Import, so a large store gave no idea what was coming, no way to take part
   * of it, and nothing on screen until it finished.
   */
  const [scanUrl, setScanUrl] = useState<string | null>(null);
  const { scan, scanning, settled } = useCommerceScan(scanUrl ? brand.id : null, scanUrl ?? undefined);

  const runImport = async (urls?: string[]) => {
    const url = scanUrl ?? f.fields.importUrl.trim() ?? '';
    setImporting(true);
    f.setErr(null);
    try {
      await api.catalogImport(brand.id, url, urls);
      f.set({ importUrl: '' });
      setScanUrl(null);
      onStarted({ kind: 'product', id: '', name: url });
    } catch (e: any) {
      f.setErr(String(e.message ?? e));
    } finally {
      setImporting(false);
    }
  };

  const startImport = () => {
    const url = f.fields.importUrl.trim() || (brand.json?.meta?.website ?? '');
    if (!url) return;
    f.setErr(null);
    setScanUrl(url);
  };

  // A store we could look at offers its products; one we could not is imported
  // the way it always was, because the person asked for it by name.
  useEffect(() => {
    if (!scanUrl || !settled) return;
    if (scan && scan.verdict === 'found' && scan.candidates.length) return;
    void runImport();
  }, [scan, settled, scanUrl]);

  const submitOnEnter = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (ready && !busy) void create();
  };

  return (
    <AssetCreateShell
      title="New product"
      error={f.err}
      footnote="Added to this brand. No preview."
      primaryLabel="Add product"
      ready={ready}
      blocked={blocked}
      busy={busy}
      onBack={onBack}
      onPrimary={() => void create()}
      onPasteFiles={(files) => void f.addFiles(files)}
    >
      <div className="sc-assetform">
        <RefStrip
          hashes={f.fields.imageHashes}
          max={MAX_REFS}
          label="Add packshots"
          hint={`Straight, well-lit packshots. The first ${USED_IN_SHOTS} are the ones a shot attaches.`}
          busy={f.uploading}
          onAdd={(files) => void f.addFiles(files)}
          onRemove={f.removeHash}
          onReject={() => f.setErr('Drop an image file.')}
        />

        <div className="sc-assetform-fields">
          <div className="sc-assetform-field">
            <label className="sc-newdlg-seclabel" htmlFor="sc-product-name">
              Name
            </label>
            <input
              id="sc-product-name"
              className="sc-in"
              type="text"
              placeholder="Name this product"
              value={f.fields.name}
              onChange={(e) => f.set({ name: e.target.value })}
              onKeyDown={submitOnEnter}
            />
          </div>
        </div>

        <fieldset className="sc-assetform-facets">
          <legend>Category</legend>
          <div className="sc-assetform-facets-chips">
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
          </div>
        </fieldset>
      </div>

      <div className="sc-newdlg-secondary">
        {showImport ? (
          <>
            <label className="sc-newdlg-seclabel" htmlFor="sc-import-url">
              Your store's address
            </label>
            <div className="sc-newdlg-secrow">
              <input
                id="sc-import-url"
                className="sc-in"
                type="url"
                placeholder={brand.json?.meta?.website ?? 'https://yourstore.com'}
                value={f.fields.importUrl}
                onChange={(e) => f.set({ importUrl: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') startImport();
                }}
              />
              <button
                type="button"
                className="sc-btn sc-btn-ghost"
                disabled={importing || scanning}
                onClick={startImport}
              >
                {scanning ? 'Looking…' : importing ? 'Starting…' : 'Import'}
              </button>
            </div>
          </>
        ) : (
          <button type="button" className="sc-newdlg-secmore" onClick={() => setShowImport(true)}>
            Import a catalog from a store URL
          </button>
        )}
      </div>
      {scan && scan.verdict === 'found' && scan.candidates.length > 0 && (
        <ProductChoice
          brandId={brand.id}
          scan={scan}
          busy={importing}
          onImport={(urls: string[]) => void runImport(urls)}
          onImportAll={() => void runImport()}
          onDismiss={() => setScanUrl(null)}
        />
      )}
    </AssetCreateShell>
  );
}
