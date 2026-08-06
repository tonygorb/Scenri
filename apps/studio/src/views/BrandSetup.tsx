import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { AlertDialog, Button, Callout, Flex, Spinner } from '@radix-ui/themes';
import { ArrowRight, CaretLeft, ImageSquare } from '@phosphor-icons/react';
import { api, assetUrl, type Brand, type Product } from '../api.js';
import { useAppData } from '../app/AppShell.js';
import { brandPath } from '../routes.js';
import { ProductsPanel } from '../AssetPanel.js';
import { saveFavoriteLooks } from '../favorites.js';
import { LookCard, LookCardSkeleton } from '../layout/LookCard.js';

type Step = 1 | 2 | 3 | 4;

/**
 * Full-screen brand setup: URL or scratch, review the scraped kit, add
 * products, pick favorite looks. Replaces the AddBrand and BrandReview
 * dialogs; also serves as the first-run screen.
 */
export function BrandSetup() {
  const { brands, looks: templates, loaded: looksLoaded, refresh } = useAppData();
  const navigate = useNavigate();
  /** Back from step 1 has nowhere to go on a true first run. */
  const canCancel = brands.length > 0;
  const [params, setParams] = useSearchParams();
  const [step, setStep] = useState<Step>(1);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [url, setUrl] = useState('');
  const [scratchName, setScratchName] = useState('');
  const [scratch, setScratch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [libraryProducts, setLibraryProducts] = useState<Product[]>([]);

  const refreshLibrary = async (brandId?: string) => {
    const id = brandId ?? brand?.id;
    if (!id) return;
    try {
      const r = await api.productsLibrary(id);
      setLibraryProducts(r.products);
    } catch {
      /* ignore */
    }
  };

  /**
   * A refresh mid-wizard used to strand the brand the server already saved:
   * step reset to 1, the id only ever lived in local state. The wizard would
   * quietly start a second brand while the first sat unreviewed, later
   * surfaced unannounced via RootRedirect once `brands.length > 0`. Rehydrate
   * once from `?step=&brand=`, using the brand list AppShell already loaded
   * before this route could mount — no extra fetch needed.
   */
  useEffect(() => {
    const brandId = params.get('brand');
    const stepParam = Math.trunc(Number(params.get('step')));
    if (brandId) {
      const found = brands.find((b) => b.id === brandId);
      if (found) {
        setBrand(found);
        setName(found.json?.meta?.name ?? '');
        setTagline(found.json?.meta?.tagline ?? '');
        setStep(stepParam >= 2 && stepParam <= 4 ? (stepParam as Step) : 2);
        void refreshLibrary(found.id);
      }
      // a stale/deleted id: fall through to a clean step 1 rather than error
    }
    setHydrated(true);
    // one-shot: runs once against the URL/brand list this route mounted with
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (!brand) {
      setParams({}, { replace: true });
      return;
    }
    setParams({ step: String(step), brand: brand.id }, { replace: true });
  }, [hydrated, step, brand, setParams]);

  const buildFromUrl = async () => {
    setBusy(true);
    setErr(null);
    try {
      const full = /^https?:\/\//.test(url) ? url : `https://${url}`;
      const b = await api.brandFromUrl(full);
      // Persist website on the kit so catalog import can re-use it.
      const withSite = {
        ...b.json,
        meta: { ...b.json?.meta, website: b.json?.meta?.website || full },
      };
      const saved = await api.updateBrand(b.id, withSite);
      setBrand(saved);
      setWarnings((b as any).warnings ?? []);
      setName(saved.json?.meta?.name ?? '');
      setTagline(saved.json?.meta?.tagline ?? '');
      setStep(2);
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const buildFromScratch = async () => {
    setBusy(true);
    setErr(null);
    try {
      const b = await api.createBrand({ specVersion: '0.1', meta: { name: scratchName.trim() || 'Untitled brand' } });
      setBrand(b);
      setName(b.json?.meta?.name ?? '');
      setStep(2);
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const saveReview = async () => {
    if (!brand) return;
    setBusy(true);
    setErr(null);
    try {
      const json = brand.json ?? {};
      const updated = {
        ...json,
        meta: {
          ...json.meta,
          name: name.trim() || json.meta?.name,
          ...(tagline.trim() ? { tagline: tagline.trim() } : {}),
        },
      };
      const b = await api.updateBrand(brand.id, updated);
      setBrand(b);
      setStep(3);
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    if (brand) {
      try {
        await api.deleteBrand(brand.id);
      } catch {
        /* already gone */
      }
    }
    await refresh();
    // "/" resolves to the brand you were last on, which is where cancelling
    // has always put you
    navigate('/', { replace: true });
  };

  const finish = () => {
    if (!brand) return;
    saveFavoriteLooks(brand.id, picked);
    void refresh().then(() => navigate(brandPath(brand), { replace: true }));
  };

  const refreshBrand = async () => {
    if (!brand) return;
    const all = await api.brands();
    const b = all.find((x) => x.id === brand.id);
    if (b) setBrand(b);
    await refreshLibrary(brand.id);
  };

  const palette: { hex: string }[] = brand
    ? [
        brand.json?.palette?.primary,
        brand.json?.palette?.secondary,
        ...(brand.json?.palette?.accent ?? []),
        ...(brand.json?.palette?.neutrals ?? []),
      ].filter((c: any) => c?.hex)
    : [];
  const logo = brand ? assetUrl(brand.json?.logos?.[0]?.file) : null;
  const products = libraryProducts.length ? libraryProducts : ((brand?.json?.products ?? []) as Product[]);
  const storeUrl =
    brand?.json?.meta?.website || (url.trim() ? (/^https?:\/\//.test(url) ? url : `https://${url}`) : '');

  const dots = (
    <span className="sc-dots">
      {([1, 2, 3, 4] as Step[]).map((s) => (
        <i key={s} data-on={s === step} />
      ))}
    </span>
  );
  const back = (onClick: () => void, show = true) => (
    <button type="button" className="sc-wiz-back" onClick={onClick} style={show ? undefined : { visibility: 'hidden' }}>
      <CaretLeft size={11} /> Back
    </button>
  );

  return (
    <div className="sc-wiz">
      <div className="sc-wiz-form">
        {step === 1 && (
          <>
            <div className="sc-wiz-head">
              {back(() => void discard(), canCancel)}
              {dots}
              <span />
            </div>
            <h1>
              Your <em>brand</em>
            </h1>
            <p className="sc-wiz-sub">
              Paste a website and the kit builds itself: name, logo, palette, tone. You can also start from nothing.
            </p>
            <div className="sc-wiz-fields">
              {!scratch ? (
                <>
                  <label>Website</label>
                  <input
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
                  <label>Brand name</label>
                  <input
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
          </>
        )}

        {step === 2 && brand && (
          <>
            <div className="sc-wiz-head">
              {back(() => {}, false)}
              {dots}
              <span />
            </div>
            <h1>
              Review the <em>kit</em>
            </h1>
            <p className="sc-wiz-sub">
              Everything came from the site. Fix anything that reads wrong; it all stays editable later.
            </p>
            <div className="sc-wiz-fields">
              {warnings.map((w) => (
                <Callout.Root key={w} color="gray" size="1" mb="2">
                  <Callout.Text>{w}</Callout.Text>
                </Callout.Root>
              ))}
              <label>Name</label>
              <input
                className="sc-in"
                dir="auto"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Brand name"
              />
              <label>Tagline</label>
              <input
                className="sc-in"
                dir="auto"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="Tagline or positioning"
              />
              <div style={{ textAlign: 'center' }}>
                <button type="button" className="sc-wiz-cta" disabled={busy} onClick={() => void saveReview()}>
                  {busy ? (
                    <Spinner size="1" />
                  ) : (
                    <>
                      Looks right <ArrowRight size={12} />
                    </>
                  )}
                </button>
                <div>
                  <AlertDialog.Root>
                    <AlertDialog.Trigger>
                      <button type="button" className="sc-wiz-skip">
                        Discard this brand
                      </button>
                    </AlertDialog.Trigger>
                    <AlertDialog.Content maxWidth="380px">
                      <AlertDialog.Title>Discard this brand?</AlertDialog.Title>
                      <AlertDialog.Description size="2">
                        The brand record and anything reviewed or added so far in this setup go with it. This cannot be
                        undone.
                      </AlertDialog.Description>
                      <Flex gap="3" mt="4" justify="end">
                        <AlertDialog.Cancel>
                          <Button variant="soft" color="gray">
                            Keep it
                          </Button>
                        </AlertDialog.Cancel>
                        <AlertDialog.Action>
                          <Button color="red" onClick={() => void discard()}>
                            Discard this brand
                          </Button>
                        </AlertDialog.Action>
                      </Flex>
                    </AlertDialog.Content>
                  </AlertDialog.Root>
                </div>
              </div>
              {err && (
                <Callout.Root color="red" mt="3" size="1">
                  <Callout.Text>{err}</Callout.Text>
                </Callout.Root>
              )}
            </div>
          </>
        )}

        {step === 3 && brand && (
          <>
            <div className="sc-wiz-head">
              {back(() => setStep(2))}
              {dots}
              <span />
            </div>
            <h1>
              Your <em>products</em>
            </h1>
            <p className="sc-wiz-sub">
              {!scratch && storeUrl
                ? "We're pulling the full store catalog now. You can also upload locked shots by hand."
                : storeUrl
                  ? 'We pull the full store catalog when we can. You can also upload locked shots by hand.'
                  : 'Upload clean shots of what you sell. A locked shot travels with every brief so the model never invents your product.'}
            </p>
            <div className="sc-wiz-fields">
              <ProductsPanel
                brand={brand}
                onChanged={() => void refreshBrand()}
                autoImportUrl={!scratch && storeUrl ? storeUrl : null}
              />
              <div style={{ textAlign: 'center', marginTop: 18 }}>
                <button type="button" className="sc-wiz-cta" onClick={() => setStep(4)}>
                  Continue <ArrowRight size={12} />
                </button>
                <div>
                  <button type="button" className="sc-wiz-skip" onClick={() => setStep(4)}>
                    Skip for now
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {step === 4 && brand && (
          <>
            <div className="sc-wiz-head">
              {back(() => setStep(3))}
              {dots}
              <span />
            </div>
            <h1>
              Which <em>looks</em> fit?
            </h1>
            <p className="sc-wiz-sub">
              Pick a few directions you like. They lead the template shelf whenever you start a shoot.
            </p>
            {!looksLoaded && (
              <div className="sc-wiz-looks" aria-hidden>
                <LookCardSkeleton size="wizard" count={9} />
              </div>
            )}
            {looksLoaded && (
              <div className="sc-wiz-looks">
                {templates.slice(0, 9).map((t) => {
                  const on = picked.includes(t.id);
                  return (
                    <LookCard
                      key={t.id}
                      look={t}
                      variant="select"
                      size="wizard"
                      selected={on}
                      onToggle={(id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))}
                    />
                  );
                })}
              </div>
            )}
            <div style={{ textAlign: 'center', marginTop: 24 }}>
              <button type="button" className="sc-wiz-cta" onClick={finish}>
                Open the studio <ArrowRight size={12} />
              </button>
              <div>
                <button type="button" className="sc-wiz-skip" onClick={finish}>
                  Skip for now
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="sc-wiz-preview">
        <div className="sc-wiz-card">
          <div className="sc-wiz-cap">
            {step === 1 && (busy ? `Reading ${url || 'the site'}` : 'Live kit preview')}
            {step === 2 && 'Live kit preview'}
            {step === 3 && `${products.length} product${products.length === 1 ? '' : 's'}`}
            {step === 4 && `${picked.length} look${picked.length === 1 ? '' : 's'} picked`}
          </div>
          <div className="sc-wiz-body">
            {step === 1 &&
              (busy ? (
                // one honest indeterminate spinner, not staged rows claiming
                // granular progress the backend's single fetch-and-parse call
                // never actually reports
                <div className="sc-scrape-row">
                  <Spinner size="1" /> Reading the site and building the kit
                </div>
              ) : (
                <p style={{ color: 'var(--sc-fg3)', fontSize: 12.5, margin: 0 }}>
                  The kit appears here as it is found.
                </p>
              ))}
            {step >= 2 && brand && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: palette.length ? 16 : 0 }}>
                  <span className="sc-kit-logo" style={{ width: 44, height: 44, padding: 7, borderRadius: 12 }}>
                    {logo ? <img src={logo} alt="" /> : <ImageSquare size={16} color="var(--sc-fg3)" />}
                  </span>
                  <span>
                    <b dir="auto" style={{ fontFamily: 'var(--sc-font-display)', fontSize: 16 }}>
                      {name || brand.json?.meta?.name}
                    </b>
                    {tagline && (
                      <small dir="auto" style={{ display: 'block', color: 'var(--sc-fg3)', fontSize: 11.5 }}>
                        {tagline.slice(0, 60)}
                      </small>
                    )}
                  </span>
                </div>
                {palette.length > 0 && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    {palette.slice(0, 5).map((c: any) => (
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
                {step === 3 && products.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
                    {products.slice(0, 4).map((p: any) => {
                      const shot = assetUrl(p.shots?.[0]?.file);
                      return shot ? (
                        <img
                          key={p.id}
                          src={shot}
                          alt={p.name}
                          style={{
                            width: '100%',
                            aspectRatio: '1',
                            objectFit: 'cover',
                            borderRadius: 12,
                            border: '1px solid var(--sc-line)',
                          }}
                        />
                      ) : null;
                    })}
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
