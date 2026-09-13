import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { DialogSheet, SheetClose, SheetDescription, SheetTitle } from '../../layout/DialogSheet.js';
import { CatalogCard } from '../../layout/CatalogCard.js';
import { api, type CatalogCandidate, type CommerceScan } from '../../api.js';
import { matches, nameFromUrl } from './productNames.js';

/**
 * Which of the products on a website to import.
 *
 * Built around one fact: discovery hands back every product address for free,
 * because a sitemap is a list of addresses, and those addresses carry the
 * product names. Only the pictures cost a page read. So the whole catalogue is
 * searchable and selectable from the first frame, and details are paid for as
 * someone scrolls to them.
 *
 * That is also what makes selecting honest at this size. Selection is held as
 * a set of addresses, never as a set of loaded cards, so "select all 2,203"
 * means all 2,203 rather than the forty-eight on screen - which is the trap
 * the first version of this walked into and wrote a sentence to apologise for.
 */
const BATCH = 24;

export function ProductChoice({
  brandId,
  scan,
  busy,
  onImport,
  onImportAll,
  onDismiss,
}: {
  brandId: string;
  scan: CommerceScan;
  busy?: boolean;
  onImport: (urls: string[]) => void;
  onImportAll: () => void;
  onDismiss: () => void;
}) {
  const all = scan.candidateUrls;
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(() => new Set(all));
  const [shown, setShown] = useState(BATCH);
  const [details, setDetails] = useState<Map<string, CatalogCandidate>>(
    () => new Map(scan.candidates.filter((c) => c.url).map((c) => [c.url as string, c])),
  );
  const asking = useRef<Set<string>>(new Set());
  const [endEl, setEndEl] = useState<HTMLDivElement | null>(null);

  const named = useMemo(() => all.map((url) => ({ url, name: nameFromUrl(url) })), [all]);
  const found = useMemo(() => named.filter((p) => matches(p.name, query)), [named, query]);
  const visible = found.slice(0, shown);

  useEffect(() => setShown(BATCH), [query]);

  // Pay for the cards that are actually on screen, once each.
  useEffect(() => {
    const wanted = visible.map((p) => p.url).filter((u) => !details.has(u) && !asking.current.has(u));
    if (!wanted.length) return;
    for (const u of wanted) asking.current.add(u);
    let live = true;
    void api
      .catalogDetails(brandId, wanted)
      .then(({ products }) => {
        if (!live) return;
        setDetails((prev) => {
          const next = new Map(prev);
          for (const p of products) if (p.url) next.set(p.url, p);
          return next;
        });
      })
      .catch(() => {
        // A card that will not load keeps its name and stays selectable.
        for (const u of wanted) asking.current.delete(u);
      });
    return () => {
      live = false;
    };
  }, [visible, details, brandId]);

  // One sentinel below the last card, the shape Canvas and AttachBody use.
  useEffect(() => {
    if (!endEl || shown >= found.length) return;
    const root = endEl.closest('.sc-wizpick-grid');
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setShown((n) => n + BATCH);
      },
      { root, rootMargin: '0px 0px 320px 0px' },
    );
    io.observe(endEl);
    return () => io.disconnect();
  }, [endEl, shown, found.length]);

  const toggle = useCallback((url: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(url)) next.add(url);
      return next;
    });
  }, []);

  const everyFoundPicked = found.length > 0 && found.every((p) => picked.has(p.url));
  const wholeCatalogue = picked.size === all.length;

  const toggleAll = () => {
    setPicked((prev) => {
      const next = new Set(prev);
      for (const p of found) {
        if (everyFoundPicked) next.delete(p.url);
        else next.add(p.url);
      }
      return next;
    });
  };

  const count = picked.size;
  const label = count === 1 ? '1 product' : `${count.toLocaleString()} products`;

  return (
    <DialogSheet open className="sc-wizpick" maxWidth="760px" described onDismiss={onDismiss}>
      <div className="sc-newdlg-head">
        <SheetTitle className="sc-newdlg-title">Products on your site</SheetTitle>
        <SheetClose>
          <button type="button" className="sc-set-close sc-newdlg-close" aria-label="Close">
            <X size={16} />
          </button>
        </SheetClose>
      </div>

      <SheetDescription className="sc-wizpick-sub">
        {`${all.length.toLocaleString()} found. Everything is selected; untick what you do not want, or search for what you do.`}
      </SheetDescription>

      <div className="sc-wizpick-tools">
        <span className="sc-wizpick-search">
          <MagnifyingGlass size={13} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${all.length.toLocaleString()} products`}
            aria-label="Search products"
          />
        </span>
        <button type="button" className="sc-wiz-skip" onClick={toggleAll} disabled={!found.length}>
          {everyFoundPicked ? 'Select none' : query ? `Select these ${found.length.toLocaleString()}` : 'Select all'}
        </button>
        <span className="sc-wizpick-count">{count.toLocaleString()} selected</span>
      </div>

      <div className="sc-wizpick-grid">
        {visible.map((p) => {
          const got = details.get(p.url);
          return (
            <CatalogCard
              key={p.url}
              id={p.url}
              previewUrl={got?.images?.[0]?.url ?? null}
              title={got?.title ?? p.name}
              primary={got?.title ?? p.name}
              secondary={got?.price != null ? `${got.currency ?? ''} ${got.price}`.trim() : (got?.category ?? '')}
              useLabel="Import"
              variant="select"
              selected={picked.has(p.url)}
              onToggle={toggle}
              size="grid"
            />
          );
        })}
        {shown < found.length && <div className="sc-wizpick-end" ref={setEndEl} aria-hidden />}
        {!found.length && <p className="sc-wizpick-empty">Nothing here matches “{query}”.</p>}
      </div>

      <div className="sc-wizpick-foot">
        <button type="button" className="sc-wiz-skip" onClick={onDismiss}>
          Not now
        </button>
        <button
          type="button"
          className="sc-wiz-cta"
          disabled={!count || busy}
          // Everything means everything: the server reads the catalogue itself
          // rather than being handed two thousand addresses to check.
          onClick={() => (wholeCatalogue ? onImportAll() : onImport([...picked]))}
        >
          {busy ? 'Importing' : `Import ${label}`}
        </button>
      </div>
    </DialogSheet>
  );
}
