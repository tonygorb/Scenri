import { useEffect, useRef, useState } from 'react';
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
import { hasCatalog, kitLines, kitNeedsHand, productLine, scanRetryable } from './kitReport.js';
import { useCommerceScan } from './brandSetup/useCommerceScan.js';
import { ProductChoice } from './brandSetup/ProductChoice.js';

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
 * Products are a second question, asked after the kit is already on screen.
 * A website may or may not be a shop, and the answer changes nothing about
 * whether the brand import worked: a portfolio is a complete success with no
 * products line at all, and a store we cannot read says so without calling
 * itself empty.
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
  const [choosing, setChoosing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<ScrapeReport | null>(null);
  /** Why the kit is thin, when a site answered and would not be read. */
  const [note, setNote] = useState<string | null>(null);
  /** An import that would not start, said on the sheet that asked for it. */
  const [importError, setImportError] = useState<string | null>(null);
  /**
   * The brand this input would duplicate, when one exists. Creating it anyway
   * is allowed — the second click says so — but never by accident: this is
   * the guard on the path that minted the phantom "theia-2" workspace.
   */
  const [dupe, setDupe] = useState<Brand | null>(null);

  /**
   * A brand nobody kept is a brand nobody made.
   *
   * The kit has to exist server-side before it can be shown: the scrape saves
   * the logo as an asset and the shop is scanned against the brand it belongs
   * to. So the row is written the moment a website is read - and walking away
   * from the screen used to leave it there. Pasting three addresses to see
   * what they looked like left three workspaces, and this session alone made
   * fifty-six of them.
   *
   * So the screen owns it until someone keeps it. `land` is the only way to
   * keep it, and anything else that ends this screen - Back, the browser's
   * back button, a reload, closing the tab - takes it away again. Nothing else
   * is ever deleted: only the brand this component created, and only while it
   * is still unkept.
   */
  const kept = useRef(false);
  const abandon = useRef<string | null>(null);

  const land = async (b: Brand, settings?: 'brand') => {
    kept.current = true;
    abandon.current = null;
    setMade(b);
    await refresh();
    navigate(`${brandPath(b)}${settings ? `?settings=${settings}` : ''}`, { replace: true });
  };

  useEffect(() => {
    // `keepalive` is what makes this survive a reload or a closing tab; a
    // plain fetch is cancelled with the document and the row would stay.
    const drop = () => {
      const id = abandon.current;
      if (!id || kept.current) return;
      abandon.current = null;
      void fetch(`/api/brands/${id}`, { method: 'DELETE', keepalive: true }).catch(() => {});
    };
    window.addEventListener('pagehide', drop);
    return () => {
      window.removeEventListener('pagehide', drop);
      drop();
    };
  }, []);

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
      abandon.current = b.id;
      setReport(b.report);
      // A site that answered and refused still makes a brand, and the rows
      // already say what is missing. These are the sentences that say why,
      // written for a person by the scraper. Not an error: something was made.
      //
      // Both of them, because either alone is half an answer. The first is the
      // site's own refusal; the second says a brand was made anyway and where
      // the two missing fields live. "Try again in a minute" on its own reads
      // as a failure, which is exactly what this stopped being.
      setNote(b.report?.read === false ? b.warnings?.slice(0, 2).join(' ') || null : null);
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

  // Asked only once the brand exists, and never blocking it.
  const { scan, scanning, outcome, retry } = useCommerceScan(made?.id ?? null);
  const products = productLine(outcome);
  // A look that concluded nothing is not a look that found nothing. Offering
  // "Looks right" here is what let a readable store land as a brand with no
  // products and nothing said about it.
  const scanFailed = outcome.kind === 'timeout' || outcome.kind === 'error';

  const startImport = async (urls?: string[]) => {
    if (!made) return;
    setImportError(null);
    setImporting(true);
    try {
      await api.catalogImport(made.id, String(made.json?.meta?.website ?? url), urls);
    } catch {
      // An import that never started is not a background job, and this used to
      // swallow that difference whole: the sheet closed, the brand landed, and
      // the person waited for products that nobody had asked for. Stay on the
      // sheet and say so - the choice they made is still on screen, so trying
      // again is one click and costs them nothing.
      setImportError('That did not start. Check your connection and try again.');
      setImporting(false);
      return;
    }
    setImporting(false);
    setChoosing(false);
    await land(made);
  };

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
              {/*
                A shop on the site is not a side quest. When one is found the
                main button goes to the products, because the alternative is
                what happened the first time this shipped: the obvious button
                said "Looks right", it meant "and no products", and the step
                was walked straight past.
              */}
              {scanning ? (
                // Still looking. The obvious button said "Looks right" while a
                // shop was being found, so pressing it landed on the brand and
                // quietly threw the search away - the products were never
                // offered and nothing said they had been missed.
                <>
                  <button type="button" className="sc-wiz-cta" disabled>
                    <Spinner size="1" /> Looking for products
                  </button>
                  <div>
                    <button type="button" className="sc-wiz-skip" onClick={() => void land(made)}>
                      Skip and add the brand only
                    </button>
                  </div>
                </>
              ) : scanFailed ? (
                <>
                  <button type="button" className="sc-wiz-cta" onClick={retry}>
                    Look for products again <ArrowRight size={12} />
                  </button>
                  <div>
                    <button type="button" className="sc-wiz-skip" onClick={() => void land(made)}>
                      Continue without products
                    </button>
                  </div>
                </>
              ) : hasCatalog(scan) ? (
                <>
                  <button type="button" className="sc-wiz-cta" onClick={() => setChoosing(true)}>
                    Add brand and products <ArrowRight size={12} />
                  </button>
                  <div>
                    <button type="button" className="sc-wiz-skip" onClick={() => void land(made)}>
                      Just the brand
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <button type="button" className="sc-wiz-cta" onClick={() => void land(made)}>
                    Looks right <ArrowRight size={12} />
                  </button>
                  <div>
                    <button type="button" className="sc-wiz-skip" onClick={() => void land(made, 'brand')}>
                      {report && kitNeedsHand(report) ? 'Finish the kit first' : 'Edit the kit first'}
                    </button>
                  </div>
                </>
              )}
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
                  /*
                    One concise announcement, not a stream of them.
                    
                    The three brand rows land together and the products row
                    resolves once, so a reader hears "Name Summit, Logo found
                    on the site, Colours 4 taken from the site, Products 294
                    found" and nothing more. Per-product chatter during an
                    import belongs nowhere near a live region.
                  */
                  <ul className="sc-kit-lines" role="status">
                    {[...kitLines(report), ...(products ? [products] : [])].map((line) => (
                      <li key={line.key} data-found={line.found ? '' : undefined}>
                        {line.key === 'products' && scanning ? (
                          <Spinner size="1" />
                        ) : line.found ? (
                          <Check size={12} weight="bold" />
                        ) : (
                          <Minus size={12} />
                        )}
                        <span className="sc-kit-line-label">{line.label}</span>
                        <span className="sc-kit-line-value">{line.value}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {note && (
                  <p className="sc-kit-note" role="status">
                    {note}
                  </p>
                )}
                {!scanning && !scanFailed && scanRetryable(outcome) && (
                  <button type="button" className="sc-wizpick-open" onClick={retry}>
                    Try the catalogue again
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      {choosing && scan && made && (
        <ProductChoice
          brandId={made.id}
          scan={scan}
          busy={importing}
          error={importError}
          onImport={(urls) => void startImport(urls)}
          onImportAll={() => void startImport()}
          onDismiss={() => setChoosing(false)}
        />
      )}
    </div>
  );
}
