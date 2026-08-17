import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Callout, Spinner } from '@radix-ui/themes';
import { ArrowRight, CaretLeft, ImageSquare } from '@phosphor-icons/react';
import { api, assetUrl, type Brand } from '../api.js';
import { useAppData } from '../app/AppShell.js';
import { brandPath } from '../routes.js';
import { flattenPalette } from '../brand/palette.js';

/**
 * First run: name the brand, or hand over a website and let the scrape do it.
 *
 * One step on purpose. This used to be four — review the scraped name and
 * tagline, add products, pick scenes — and every one of those is something you
 * would rather do later, from inside the app, against a brand you can already
 * see. Editing now lives in Settings → Brand kit, products on the Products
 * page, bookmarks on the scene cards themselves.
 *
 * What the extra steps were genuinely for is kept: a scraped site with a
 * storefront still triggers a catalog import, headlessly, the moment the brand
 * exists.
 */
export function BrandSetup() {
  const { brands, refresh } = useAppData();
  const navigate = useNavigate();
  /** Back from here has nowhere to go on a true first run. */
  const canCancel = brands.length > 0;
  const [url, setUrl] = useState('');
  const [scratchName, setScratchName] = useState('');
  const [scratch, setScratch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** Only ever set for the moment between "created" and "navigated". */
  const [made, setMade] = useState<Brand | null>(null);

  const land = async (b: Brand) => {
    setMade(b);
    await refresh();
    navigate(brandPath(b), { replace: true });
  };

  const buildFromUrl = async () => {
    setBusy(true);
    setErr(null);
    try {
      const full = /^https?:\/\//.test(url) ? url : `https://${url}`;
      const b = await api.brandFromUrl(full);
      // Persist website on the kit so a refresh and a catalog import can re-use it.
      const saved = await api.updateBrand(b.id, {
        ...b.json,
        meta: { ...b.json?.meta, website: b.json?.meta?.website || full },
      });
      // Fire and forget, exactly as the products step did: a storefront fills
      // the product library in the background while the user gets on with it.
      void api.catalogImport(saved.id, full).catch(() => {});
      await land(saved);
    } catch (e: any) {
      setErr(String(e.message ?? e));
      setBusy(false);
    }
  };

  const buildFromScratch = async () => {
    setBusy(true);
    setErr(null);
    try {
      await land(await api.createBrand({ specVersion: '0.1', meta: { name: scratchName.trim() || 'Untitled brand' } }));
    } catch (e: any) {
      setErr(String(e.message ?? e));
      setBusy(false);
    }
  };

  const cancel = () => navigate('/', { replace: true });

  const palette = made ? flattenPalette(made.json?.palette) : [];
  const logo = made ? assetUrl(made.json?.logos?.[0]?.file) : null;

  return (
    <div className="sc-wiz">
      <div className="sc-wiz-form">
        <div className="sc-wiz-head">
          <button
            type="button"
            className="sc-wiz-back"
            onClick={cancel}
            style={canCancel ? undefined : { visibility: 'hidden' }}
          >
            <CaretLeft size={11} /> Back
          </button>
          <span />
          <span />
        </div>
        <h1>
          Your <em>brand</em>
        </h1>
        <p className="sc-wiz-sub">
          Paste a website and the kit builds itself: name, logo, palette. You can also start from nothing and fill it in
          later from Settings.
        </p>
        <div className="sc-wiz-fields">
          {!scratch ? (
            <>
              <label htmlFor="sc-wiz-url">Website</label>
              <input
                id="sc-wiz-url"
                className="sc-in"
                placeholder="acme.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && url.trim() && !busy && void buildFromUrl()}
              />
              <p className="sc-wiz-hint">We only read public pages. Nothing leaves this machine.</p>
              <div style={{ textAlign: 'center' }}>
                <button
                  type="button"
                  className="sc-wiz-cta"
                  disabled={!url.trim() || busy}
                  onClick={() => void buildFromUrl()}
                >
                  {busy ? (
                    <Spinner size="1" />
                  ) : (
                    <>
                      Build the kit <ArrowRight size={12} />
                    </>
                  )}
                </button>
                <div>
                  <button type="button" className="sc-wiz-skip" onClick={() => setScratch(true)}>
                    Start from scratch instead
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <label htmlFor="sc-wiz-name">Brand name</label>
              <input
                id="sc-wiz-name"
                className="sc-in"
                placeholder="Brand name"
                value={scratchName}
                onChange={(e) => setScratchName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && scratchName.trim() && !busy && void buildFromScratch()}
              />
              <div style={{ textAlign: 'center' }}>
                <button
                  type="button"
                  className="sc-wiz-cta"
                  disabled={!scratchName.trim() || busy}
                  onClick={() => void buildFromScratch()}
                >
                  {busy ? (
                    <Spinner size="1" />
                  ) : (
                    <>
                      Create it <ArrowRight size={12} />
                    </>
                  )}
                </button>
                <div>
                  <button type="button" className="sc-wiz-skip" onClick={() => setScratch(false)}>
                    Build from a website instead
                  </button>
                </div>
              </div>
            </>
          )}
          {err && (
            <Callout.Root color="red" mt="3" size="1">
              <Callout.Text>{err}</Callout.Text>
            </Callout.Root>
          )}
        </div>
      </div>

      <div className="sc-wiz-preview">
        <div className="sc-wiz-card">
          <div className="sc-wiz-cap">{busy ? `Reading ${url || 'the site'}` : 'Live kit preview'}</div>
          <div className="sc-wiz-body">
            {busy && !made && (
              // one honest indeterminate spinner, not staged rows claiming
              // granular progress the backend's single fetch-and-parse call
              // never actually reports
              <div className="sc-scrape-row">
                <Spinner size="1" /> Reading the site and building the kit
              </div>
            )}
            {!busy && !made && (
              <p style={{ color: 'var(--sc-fg3)', fontSize: 12.5, margin: 0 }}>The kit appears here as it is found.</p>
            )}
            {made && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: palette.length ? 16 : 0 }}>
                  <span className="sc-kit-logo" style={{ width: 44, height: 44, padding: 7, borderRadius: 12 }}>
                    {logo ? <img src={logo} alt="" /> : <ImageSquare size={16} color="var(--sc-fg3)" />}
                  </span>
                  <span>
                    <b dir="auto" style={{ fontFamily: 'var(--sc-font-display)', fontSize: 16 }}>
                      {made.json?.meta?.name}
                    </b>
                    {made.json?.meta?.tagline && (
                      <small dir="auto" style={{ display: 'block', color: 'var(--sc-fg3)', fontSize: 11.5 }}>
                        {String(made.json.meta.tagline).slice(0, 60)}
                      </small>
                    )}
                  </span>
                </div>
                {palette.length > 0 && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    {palette.slice(0, 5).map((c) => (
                      <span
                        key={c.hex}
                        style={{
                          flex: 1,
                          height: 44,
                          borderRadius: 9,
                          border: '1px solid var(--sc-line)',
                          background: c.hex,
                        }}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
