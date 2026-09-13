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
 * Details are asked for in groups rather than one big request.
 *
 * A group is one round trip and the server reads its pages twelve at a time,
 * so a group of twelve lands in roughly one page's latency: measured against
 * gymshark.com, 124 ms a page at that concurrency. Smaller groups would
 * re-prioritise more often and waste round trips; larger ones would make the
 * screen you are looking at wait behind pages you have already passed.
 */
const CHUNK = 12;

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
  const gridRef = useRef<HTMLDivElement>(null);

  const named = useMemo(() => all.map((url) => ({ url, name: nameFromUrl(url) })), [all]);
  const found = useMemo(() => named.filter((p) => matches(p.name, query)), [named, query]);
  const visible = useMemo(() => found.slice(0, shown), [found, shown]);
  useEffect(() => setShown(BATCH), [query]);

  /**
   * Details are paid for by what a person actually looked at.
   *
   * Every card's name and address come from the sitemap, so a card costs
   * nothing to show. Only its picture costs a page read. This used to ask for
   * details for every card that had been rendered, and hold the next page of
   * cards back until all of them landed - so appearing, which is free, was
   * paced by fetching, which is not: 24 cards every 505 ms against a fixture
   * with 180 ms pages, and about four minutes to reach the end of a
   * 2,201-product store with one-second pages. Scrolling is instant now, and
   * the pictures follow the viewport.
   */
  const queue = useRef<string[]>([]);
  const inFlightRef = useRef(0);
  const pumpRef = useRef<() => void>(() => {});

  /**
   * Detail requests open at once.
   *
   * Two of twelve, and the server reads twelve pages per request, so a live
   * shop sees at most twenty-four reads from us at a time. That is the
   * politeness ceiling rather than a throughput one.
   */
  const MAX_PARALLEL = 2;
  /**
   * How many looked-at cards may be waiting for a picture.
   *
   * A flick through two thousand cards puts every one it passes on the queue,
   * and draining all of them is a page read each against somebody's live shop
   * for cards nobody stopped on. Requests are taken from the END of this, so
   * the oldest entries are exactly the ones flown past: dropping them is the
   * cheap thing to do, and a card that comes back into view asks again.
   */
  const MAX_QUEUED = 120;

  const pump = useCallback(() => {
    while (inFlightRef.current < MAX_PARALLEL && queue.current.length) {
      // From the end: what is on screen now wins over what was flicked past.
      const group = queue.current.splice(Math.max(0, queue.current.length - CHUNK));
      if (!group.length) return;
      inFlightRef.current++;
      setInFlight(inFlightRef.current);
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
          inFlightRef.current = Math.max(0, inFlightRef.current - 1);
          if (!mounted.current) return;
          setInFlight(inFlightRef.current);
          pumpRef.current();
        });
    }
  }, [brandId]);
  pumpRef.current = pump;

  // Which cards have been on screen. A card scrolled past at speed never
  // intersects, so it is never paid for.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const io = new IntersectionObserver(
      (entries) => {
        let added = false;
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const url = (e.target as HTMLElement).dataset.fbId;
          io.unobserve(e.target);
          if (!url || haveRef.current.has(url) || asking.current.has(url)) continue;
          asking.current.add(url);
          queue.current.push(url);
          // Forget the ones scrolled past long ago, so they can be asked for
          // again if they are ever looked at.
          while (queue.current.length > MAX_QUEUED) {
            const dropped = queue.current.shift();
            if (dropped) asking.current.delete(dropped);
          }
          added = true;
        }
        if (added) pumpRef.current();
      },
      // Two and a half screens of lookahead, because one page of a real store
      // takes about a second and a half to read: asking as the card arrives
      // means waiting that long looking at a shimmer. Asked two screens early,
      // the picture is usually there before the card is. Cards themselves are
      // free and the sentinel below runs further ahead still.
      { root: grid, rootMargin: '250% 0px' },
    );
    for (const el of grid.querySelectorAll('[data-fb-id]')) io.observe(el);
    return () => io.disconnect();
  }, [shown, query]);

  // One sentinel below the last card, the shape Canvas and AttachBody use.
  //
  // It used to stand down while any detail request was in flight, to stop a
  // flick to the bottom of a 2,200-product store queueing 240 page reads. That
  // bounded the reads by refusing to show cards, and cards are free: appearing
  // was paced by fetching, 24 cards every 505 ms. The runaway is bounded where
  // it actually lives now - the queue above only holds cards somebody looked
  // at - so this is free to keep up with a scroll.
  useEffect(() => {
    if (!endEl || shown >= found.length) return;
    const root = endEl.closest('.sc-wizpick-grid');
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setShown((n) => n + BATCH);
      },
      // Further ahead than the picture lookahead above, since a card has to
      // exist before it can be seen and asked for.
      { root, rootMargin: '0px 0px 400% 0px' },
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

      <div className="sc-wizpick-grid" ref={gridRef}>
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
