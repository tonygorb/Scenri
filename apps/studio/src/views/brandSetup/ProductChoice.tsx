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
/**
 * Details are asked for in small groups rather than one big one.
 *
 * Twenty-four real product pages take about eight seconds against a live
 * store, and asking for all of them at once means eight seconds of nothing
 * followed by everything. In eights the first cards land in about three, and
 * the rest fill in behind them.
 */
const CHUNK = 8;

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
  /** Read inside the fetch effect without making it a dependency. */
  const haveRef = useRef(details);
  const mounted = useRef(true);
  const [inFlight, setInFlight] = useState(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [endEl, setEndEl] = useState<HTMLDivElement | null>(null);

  const named = useMemo(() => all.map((url) => ({ url, name: nameFromUrl(url) })), [all]);
  const found = useMemo(() => named.filter((p) => matches(p.name, query)), [named, query]);
  const visible = useMemo(() => found.slice(0, shown), [found, shown]);
  // A stable identity for "which cards are on screen". Depending on the array
  // itself re-runs the effect below on every render, and its cleanup then
  // cancels the requests that same render just started.
  const visibleKey = visible.map((p) => p.url).join('|');

  useEffect(() => setShown(BATCH), [query]);

  // Pay for the cards that are actually on screen, once each, in small groups
  // so the grid fills in rather than arriving all at once.
  useEffect(() => {
    const wanted = visibleKey.split('|').filter((u) => u && !haveRef.current.has(u) && !asking.current.has(u));
    if (!wanted.length) return;
    for (const u of wanted) asking.current.add(u);
    const groups: string[][] = [];
    for (let i = 0; i < wanted.length; i += CHUNK) groups.push(wanted.slice(i, i + CHUNK));
    setInFlight((n) => n + groups.length);
    for (const group of groups) {
      void api
        .catalogDetails(brandId, group)
        .then(({ products }) => {
          if (!mounted.current) return;
          // Merged out here, not in a `setDetails(prev => ...)` updater.
          // React calls an updater twice in StrictMode, so a ref written
          // inside one is written from a call whose result may be discarded.
          // `haveRef` is the accumulator either way, so read it directly and
          // hand React a finished map.
          const next = new Map(haveRef.current);
          for (const p of products) if (p.url) next.set(p.url, p);
          // The page's canonical address is not always the one the sitemap
          // listed, and the card is keyed by the one we asked for.
          for (let i = 0; i < products.length && i < group.length; i++) {
            if (!next.has(group[i])) next.set(group[i], products[i]);
          }
          haveRef.current = next;
          setDetails(next);
        })
        .catch(() => {
          // A card that will not load keeps its name and stays selectable.
          for (const u of group) asking.current.delete(u);
        })
        .finally(() => {
          // Not guarded on a per-effect flag: this effect re-runs whenever the
          // visible set changes, and cancelling the count there is what left
          // "Loading products" on screen for good.
          if (mounted.current) setInFlight((n) => Math.max(0, n - 1));
        });
    }
  }, [visibleKey, brandId]);

  // One sentinel below the last card, the shape Canvas and AttachBody use.
  //
  // Paced on what has actually arrived rather than on how fast someone
  // scrolls: a flick to the bottom of a 2,200-product store queued 240 page
  // reads in one go, which is the runaway this whole screen exists to avoid.
  // Nothing more is asked for until the last lot lands.
  useEffect(() => {
    if (!endEl || shown >= found.length || inFlight > 0) return;
    const root = endEl.closest('.sc-wizpick-grid');
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setShown((n) => n + BATCH);
      },
      { root, rootMargin: '0px 0px 320px 0px' },
    );
    io.observe(endEl);
    return () => io.disconnect();
  }, [endEl, shown, found.length, inFlight]);

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
              pending={!got}
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
        {inFlight > 0 && <span className="sc-wizpick-loading">Loading products</span>}
        <button
          type="button"
          className="sc-wiz-cta"
          // Nothing has arrived yet, so there is nothing to have looked at.
          // Once the first cards land the rest can keep filling in behind a
          // decision that is already an informed one.
          disabled={!count || busy || (details.size === 0 && inFlight > 0)}
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
