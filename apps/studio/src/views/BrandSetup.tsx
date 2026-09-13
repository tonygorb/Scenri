import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Callout, Spinner } from '@radix-ui/themes';
import { ArrowRight, CaretLeft, Check, ImageSquare, Minus } from '@phosphor-icons/react';
import { api, assetUrl, type Brand, type ScrapeReport } from '../api.js';
import { useAppData } from '../app/AppShell.js';
import { brandPath } from '../routes.js';
import { flattenPalette } from '../brand/palette.js';
import { primaryMark } from '../brand/marks.js';
import { brandName } from '../layout/nav.js';
import { duplicateOf } from './brandDupes.js';
import { kitLines, kitNeedsHand } from './kitReport.js';

/** Cut on a word, never through one: "you could possibly think of, a" is not a tagline. */
function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}...`;
}

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
  /**
   * The kit that was just built, held until the person says go.
   *
   * This used to be set and navigated past in the same tick, so the panel
   * filled in for one frame and vanished: you watched a kit get built and then
   * the app moved without showing you what it found. A partial result - a logo
   * and no colours, say - was indistinguishable from a complete one.
   */
  const [made, setMade] = useState<Brand | null>(null);
  const [report, setReport] = useState<ScrapeReport | null>(null);
  /**
   * The brand this input would duplicate, when one exists. Creating it anyway
   * is allowed — the second click says so — but never by accident: this is
   * the guard on the path that minted the phantom "theia-2" workspace.
   */
  const [dupe, setDupe] = useState<Brand | null>(null);

  const land = async (b: Brand, settings?: 'brand') => {
    setMade(b);
    await refresh();
    navigate(`${brandPath(b)}${settings ? `?settings=${settings}` : ''}`, { replace: true });
  };

  const buildFromUrl = async (force = false) => {
    if (!force) {
      const existing = duplicateOf(brands, { url: url.trim() });
      if (existing) {
        setDupe(existing);
        return;
      }
    }
    setBusy(true);
    setErr(null);
    try {
      // The raw field, verbatim. Building the URL here is what broke: this
      // line tested the untrimmed value, so a pasted leading space produced
      // `https://  https://...` and the server's parser error reached the
      // screen as "Invalid URL". One normaliser now owns the rule, server-side.
      const b = await api.brandFromUrl(url);
      // No catalog crawl here, on purpose. This screen was asked for a brand
      // kit, and it used to answer by crawling the whole site for products
      // too: oatly.com got 588 pages read and 201 invented products, and
      // gymshark.com got 4406 requests sent to a live store for nothing, ending
      // in a red bell on someone's first run. Nobody asked for any of it.
      //
      // Importing a catalog is still one click, on the Products page, where a
      // person chooses it and the website is already filled in from the kit
      // (create/ProductForm.tsx reads meta.website). A failure there is an
      // answer to a question that was actually asked.
      //
      // Show it, and wait. The brand exists either way - this is a reveal, not
      // a confirmation that could still be refused.
      setMade(b);
      setReport(b.report);
      setBusy(false);
    } catch (e: any) {
      setErr(String(e.message ?? e));
      setBusy(false);
    }
  };

  const buildFromScratch = async (force = false) => {
    if (!force) {
      const existing = duplicateOf(brands, { name: scratchName });
      if (existing) {
        setDupe(existing);
        return;
      }
    }
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
  const logo = made ? assetUrl(primaryMark(made.json)?.file) : null;

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
          {made && report ? (
            <>Built from {report.host}. Everything here can be changed later, from Settings.</>
          ) : (
            <>
              Paste a website and the kit builds itself: name, logo, palette. You can also start from nothing and fill
              it in later from Settings.
            </>
          )}
        </p>
        <div className="sc-wiz-fields">
          {made ? (
            <div style={{ textAlign: 'center' }}>
              <button type="button" className="sc-wiz-cta" onClick={() => void land(made)}>
                Looks right <ArrowRight size={12} />
              </button>
              <div>
                <button type="button" className="sc-wiz-skip" onClick={() => void land(made, 'brand')}>
                  {report && kitNeedsHand(report) ? 'Finish the kit first' : 'Edit the kit first'}
                </button>
              </div>
            </div>
          ) : !scratch ? (
            <>
              <label htmlFor="sc-wiz-url">Website</label>
              <input
                id="sc-wiz-url"
                className="sc-in"
                placeholder="acme.com"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setDupe(null);
                }}
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
                  <button
                    type="button"
                    className="sc-wiz-skip"
                    onClick={() => {
                      setScratch(true);
                      setDupe(null);
                    }}
                  >
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
                onChange={(e) => {
                  setScratchName(e.target.value);
                  setDupe(null);
                }}
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
                  <button
                    type="button"
                    className="sc-wiz-skip"
                    onClick={() => {
                      setScratch(false);
                      setDupe(null);
                    }}
                  >
                    Build from a website instead
                  </button>
                </div>
              </div>
            </>
          )}
          {dupe && (
            <Callout.Root color="amber" mt="3" size="1">
              <Callout.Text>
                You already have {brandName(dupe)}. Creating another makes a second workspace with its own address.
              </Callout.Text>
              <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
                <button type="button" className="sc-wiz-cta" onClick={() => navigate(brandPath(dupe))}>
                  Open {brandName(dupe)} instead
                </button>
                <button
                  type="button"
                  className="sc-wiz-skip"
                  onClick={() => {
                    setDupe(null);
                    void (scratch ? buildFromScratch(true) : buildFromUrl(true));
                  }}
                >
                  Create anyway
                </button>
              </div>
            </Callout.Root>
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
          <div className="sc-wiz-cap">
            {made ? 'Your kit' : busy ? `Reading ${url || 'the site'}` : 'Live kit preview'}
          </div>
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
                        {clip(String(made.json.meta.tagline), 72)}
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
                {report && (
                  <ul className="sc-kit-lines">
                    {kitLines(report).map((line) => (
                      <li key={line.key} data-found={line.found ? '' : undefined}>
                        {line.found ? <Check size={12} weight="bold" /> : <Minus size={12} />}
                        <span className="sc-kit-line-label">{line.label}</span>
                        <span className="sc-kit-line-value">{line.value}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
