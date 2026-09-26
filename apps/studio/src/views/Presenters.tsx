import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { presenterSearchText } from '../displayName.js';
import { Outlet, useMatch, useNavigate } from 'react-router';
import { Plus } from '@phosphor-icons/react';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { useTaskCenter } from '../app/TaskCenter.js';
import { useCreateAsset } from '../create/AssetCreateHost.js';
import { useApplyPresenter } from '../app/useApplyPresenter.js';
import { customPresentersOf } from '../brandAssets.js';
import { api, type Presenter, type PresenterDraftSummary } from '../api.js';
import { P, presenterEditPath, presenterPath, presenterStudioPath } from '../routes.js';
import { PresenterCard, PresenterCardSkeleton } from '../layout/PresenterCard.js';
import { PresenterDraftCard } from '../layout/PresenterDraftCard.js';
import { CatalogPickedBar } from '../layout/CatalogPickedBar.js';
import { catalogPickVerb, keepersLine, settlePicked } from '../layout/catalogPick.js';
import { useCatalogPick } from '../layout/useCatalogPick.js';
import { Confirm } from '../Confirm.js';
import { DuplicatePresenterDialog } from './DuplicatePresenterDialog.js';
import { RenameDialog } from '../layout/RenameDialog.js';
import { suggestedPresenterCopyName } from '../presenterCopyName.js';
import { failureToast } from '../failure.js';
import { useToasts } from '../toasts.js';
import { DensityControl, WallDensityCtx, densitySize, densityWallStyle } from '../layout/DensityControl.js';
import { DENSITY_DEFAULT, normalizeDensity, type DensityCols } from '../layout/masonry.js';
import { LibraryToolbar } from '../layout/library/LibraryToolbar.js';
import { LibrarySearch } from '../layout/library/LibrarySearch.js';
import { FacetFilter } from '../layout/library/FacetFilter.js';
import { LibraryEmpty, LibraryZero } from '../layout/library/LibraryEmpty.js';
import { StarterDivider } from '../layout/library/StarterDivider.js';
import { useLibraryQuery } from '../layout/library/useLibraryQuery.js';
import { useLibraryPage } from '../layout/library/useLibraryPage.js';
import { matchesQuery } from '../layout/library/libraryRules.js';
import { ScrollPane } from '../layout/ScrollPane.js';
import { PREF, useLocalPref } from '../prefs.js';
import { keptIds, setKept, toggleKept } from '../bookmarks.js';

/** Below this, a search box has nothing worth narrowing — the whole set is one screenful. */
const SEARCH_MIN = 8;

/** The rail's value for Keepers. The URL keeps `?bookmarked=1`, the scenes param. */
const KEEPERS = '__bookmarked';

/**
 * The presenter library, built on the shared Creative Library shell
 * (layout/library/). One casting board, not a
 * Scene-style set of collection sections — eight-odd people don't need
 * Studio/Social-style grouping, and splitting into gendered sections by
 * default would read as a checkbox diversity grid rather than a curated
 * roster. Category tabs, same `.sc-verticals` pattern as Scenes — a longer
 * value list scrolls horizontally rather than collapsing into a menu.
 *
 * The brand's own people sit above that board in their own section, the same
 * split Products makes between what you brought and what we cast. The roster
 * below is always there, so this page is never an empty room.
 */
export function PresentersView() {
  const {
    presenters,
    presenterCategories,
    presentersLoaded,
    presentersError,
    refetchPresenters,
    applyBrand,
    refreshBrands,
  } = useAppData();
  const { brand } = useBrand();
  const navigate = useNavigate();
  const applyPresenter = useApplyPresenter();
  const { push } = useToasts();
  const { q, setQ, facets, setFacets, clearSearch, clear } = useLibraryQuery(['category', 'bookmarked']);
  const category = facets.category;
  const onlyMarked = facets.bookmarked === '1';
  const [marks, setMarks] = useState<string[]>(() => keptIds('presenter', brand.id));
  const keepOne = (id: string) => setMarks(toggleKept('presenter', brand.id, id));
  const pick = useCatalogPick(`${brand.id}|${q}|${category ?? ''}|${onlyMarked ? '1' : ''}`);
  // One poll for the whole app, owned by TaskCenter: a build started from the
  // top bar on any screen has to stay visible after you leave the screen that
  // started it.
  const createAsset = useCreateAsset();
  const mine = useMemo(() => customPresentersOf(brand), [brand]);
  const [tile, setTile] = useLocalPref(PREF.wallDensity, DENSITY_DEFAULT);
  const density = normalizeDensity(tile);
  const setDensity = (cols: DensityCols) => setTile(cols);
  const wallStyle = densityWallStyle(density);
  const densityAttr = densitySize(density);

  const openPresenter = (id: string) => navigate(presenterPath(brand, id));
  const editPresenter = (id: string) => navigate(presenterEditPath(brand, id));

  const byFacet = useMemo(
    () => (category ? presenters.filter((p) => p.suitableCategories.includes(category)) : presenters),
    [presenters, category],
  );

  const filtered = useMemo(
    () =>
      byFacet.filter((p) =>
        // presenterSearchText carries the whole casting sheet — hair, skin,
        // build, age, wardrobe — none of which the card shows.
        matchesQuery(presenterSearchText(p), q),
      ),
    [byFacet, q],
  );

  /** The wall and the one way on, so a card thrown away can hand its place to a neighbour. */
  const wall = useRef<HTMLDivElement>(null);
  const cta = useRef<HTMLButtonElement>(null);

  const createCta = (
    <button ref={cta} type="button" className="sc-btn sc-btn-primary" onClick={() => createAsset('presenter')}>
      <Plus size={12} /> Create presenter
    </button>
  );

  /**
   * The people this brand started and did not finish.
   *
   * Their work is minutes of drawing and it lived behind a pointer held in one
   * tab: close the tab and a finished face and a full body were unreachable.
   * They are read here so the library is the door back to them, which is what
   * the creation page has always claimed happens.
   */
  const [drafts, setDrafts] = useState<PresenterDraftSummary[]>([]);
  /**
   * Only the newest read may land. Discarding two drafts in quick succession
   * starts two reads, and the first can answer while the second discard is
   * still on its way, carrying the draft that was just thrown away.
   */
  const draftsRead = useRef(0);
  const loadDrafts = useCallback(() => {
    const mine = ++draftsRead.current;
    void api
      .presenterDrafts(brand.id)
      // An edit of somebody already saved is not unfinished work: they are on
      // the wall already, and their own page offers the session back.
      .then((r) => {
        if (mine === draftsRead.current) setDrafts(r.drafts.filter((d) => !d.presenterId));
      })
      .catch(() => undefined);
    return () => {
      // a read for a brand or a moment this page has left is not an answer
      if (mine === draftsRead.current) draftsRead.current++;
    };
  }, [brand.id]);
  /**
   * Read again when the studio closes, never while it is open.
   *
   * The studio is this page's own child route, so the wall stays mounted
   * underneath it and its list is whatever it was fetched before. Minting a
   * draft and pressing Escape used to land on a wall that predated the draft,
   * which reads as the work having been thrown away. The studio is full-bleed
   * over the wall, so there is nothing to read while it is open.
   */
  const inStudio = !!useMatch({ path: P.presenterStudio });
  // A set goes on drawing after the studio closes (the server carries it), so
  // the wall reads its drafts again whenever a presenter run in the bell moves:
  // a draft card is never a picture behind the work it stands for.
  const { tasks } = useTaskCenter();
  const runs = tasks
    .filter((t) => t.id.startsWith('presenter:'))
    .map((t) => `${t.id}:${t.state}:${t.percent ?? ''}`)
    .join('|');
  useEffect(() => {
    if (inStudio) return;
    return loadDrafts();
  }, [inStudio, loadDrafts, runs]);
  /**
   * The wall, so a card thrown away can hand its place on to a neighbour.
   *
   * The control that discards a card is inside that card, so agreeing to the
   * discard destroys the element that had focus and the browser drops focus to
   * `body`: the next Tab starts again at Skip to content, which is the far end
   * of the page from where the person was working. Focus moves to the next
   * card's own discard, the way `ShotRail` and `LineageStrip` hand focus to the
   * neighbouring tile, and to New presenter when that was the last one,
   * because that is the only thing left to do here.
   */
  const drop = useCallback(
    (id: string) => {
      const at = Math.max(
        0,
        drafts.findIndex((d) => d.id === id),
      );
      handOn.current = at;
      pick.forget(id);
      setDrafts((cur) => cur.filter((d) => d.id !== id));
      void api.deletePresenterDraft(brand.id, id).finally(() => loadDrafts());
    },
    [brand.id, drafts, loadDrafts, pick.forget],
  );
  /**
   * Where focus goes next, taken in the render that took the card away.
   *
   * Not a `requestAnimationFrame` inside the handler: a frame can come before
   * React commits, and then this reads the wall as it was and focuses the card
   * that is about to be removed. An effect on `drafts` runs after the commit,
   * which is the only moment the neighbour is the neighbour.
   */
  const handOn = useRef<number | null>(null);
  useEffect(() => {
    const at = handOn.current;
    if (at === null) return;
    handOn.current = null;
    const pucks = wall.current?.querySelectorAll<HTMLButtonElement>('[data-build] .sc-cardpuck');
    const next = pucks?.length
      ? pucks[Math.min(at, pucks.length - 1)]
      : (cta.current ?? document.querySelector<HTMLElement>('.sc-new-go'));
    next?.focus();
  }, [drafts]);
  /**
   * Throwing away drawn work asks first.
   *
   * The puck on a card went straight to the delete, so a face somebody had
   * decided on went with one press and no word, and nothing offers it back.
   * A draft with nothing drawn on it costs only the answering, so that one
   * still goes at once.
   */
  const [discarding, setDiscarding] = useState<PresenterDraftSummary | null>(null);
  const [discardingBatch, setDiscardingBatch] = useState(false);
  const [deletingBatch, setDeletingBatch] = useState(false);
  const discardDraft = useCallback(
    (id: string) => {
      const d = drafts.find((x) => x.id === id);
      if (d?.drawn) setDiscarding(d);
      else drop(id);
    },
    [drafts, drop],
  );
  const [duplicating, setDuplicating] = useState<Presenter | null>(null);
  const [renaming, setRenaming] = useState<Presenter | null>(null);
  const [removing, setRemoving] = useState<Presenter | null>(null);
  const [acting, setActing] = useState(false);
  const [actError, setActError] = useState<string | null>(null);
  /**
   * The copy just made. Desktop captions hide until hover, so two identical
   * faces would otherwise land with no name and no mark. Cleared after a
   * short hold; the write itself stays instant.
   */
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const askDuplicate = useCallback(
    (id: string) => {
      const person = mine.find((p) => p.id === id);
      if (!person) return;
      setActError(null);
      setDuplicating(person);
    },
    [mine],
  );
  const askRename = useCallback(
    (id: string) => {
      const person = mine.find((p) => p.id === id);
      if (!person) return;
      setActError(null);
      setRenaming(person);
    },
    [mine],
  );
  const confirmRename = async (name: string) => {
    if (!renaming || acting) return;
    setActing(true);
    setActError(null);
    try {
      applyBrand((await api.updatePresenter(brand.id, renaming.id, { name })).brand);
      setRenaming(null);
    } catch (e: any) {
      const f = failureToast(e, 'Could not rename this presenter');
      setActError([f.title, f.detail].filter(Boolean).join(' '));
    } finally {
      setActing(false);
    }
  };
  const askDelete = useCallback(
    (id: string) => {
      const person = mine.find((p) => p.id === id);
      if (!person) return;
      setRemoving(person);
    },
    [mine],
  );
  /**
   * Where focus goes after a card is deleted, the way a discarded draft hands
   * focus on. The control that deletes is inside the card, so agreeing to it
   * destroys the element that had focus and the browser drops focus to `body`:
   * the next Tab starts again at Skip to content, the far end of the page from
   * where the person was working.
   */
  const handOnCard = useRef<number | null>(null);
  useEffect(() => {
    const at = handOnCard.current;
    if (at === null) return;
    handOnCard.current = null;
    const pucks = wall.current?.querySelectorAll<HTMLButtonElement>('.sc-lookcard:not([data-build]) .sc-lookcard-more');
    const next = pucks?.length
      ? pucks[Math.min(at, pucks.length - 1)]
      : (cta.current ?? document.querySelector<HTMLElement>('.sc-new-go'));
    next?.focus();
  }, [presenters, brand]);
  const confirmDuplicate = async (name: string) => {
    if (!duplicating || acting) return;
    setActing(true);
    setActError(null);
    try {
      const r = await api.duplicatePresenter(brand.id, duplicating.id, name);
      applyBrand(r.brand);
      setDuplicating(null);
      // The wall is the announcement: the new card scrolls into view wearing
      // the just-added mark. A toast on top said the same thing twice.
      setJustAdded(r.presenter.id);
    } catch (e: any) {
      // The dialog is still open and owns the failure; the toast would be the
      // same sentence in a second place. It gets the humanised reading, not
      // the raw engine text.
      const f = failureToast(e, 'Could not duplicate this presenter');
      setActError([f.title, f.detail].filter(Boolean).join(' '));
    } finally {
      setActing(false);
    }
  };
  const confirmDelete = async () => {
    if (!removing || acting) return;
    handOnCard.current = Math.max(
      0,
      minePlusBuilds.findIndex((p) => p.id === removing.id),
    );
    setActing(true);
    try {
      const r = await api.deletePresenter(brand.id, removing.id);
      applyBrand(r.brand);
      pick.forget(removing.id);
      setRemoving(null);
    } catch (e: any) {
      // already gone (another tab): the outcome asked for is true
      if (e?.status === 404) {
        await refreshBrands();
        pick.forget(removing.id);
        setRemoving(null);
      } else push(failureToast(e, 'Could not delete this presenter'));
    } finally {
      setActing(false);
    }
  };
  useEffect(() => {
    if (!justAdded) return;
    wall.current?.querySelector<HTMLElement>('.sc-lookcard[data-just-added]')?.scrollIntoView({ block: 'nearest' });
    const t = window.setTimeout(() => setJustAdded(null), 1800);
    return () => window.clearTimeout(t);
  }, [justAdded]);

  /** A person the brand owns, narrowed by whatever the wall is narrowed by. */
  const minePlusBuilds = useMemo(
    () =>
      mine
        // Untagged is unfiltered: a person nobody categorised would otherwise
        // vanish from every tab, which reads as losing them.
        .filter((p) => (category ? !p.suitableCategories.length || p.suitableCategories.includes(category) : true))
        .filter((p) => matchesQuery(presenterSearchText(p), q))
        .filter((p) => (onlyMarked ? marks.includes(p.id) : true)),
    [mine, category, q, onlyMarked, marks],
  );
  /**
   * Whether this brand has people of its own at all, before any filter.
   *
   * Deliberately not "does the filtered list have anything in it": that made
   * narrowing to a category your one presenter is not in read as losing the
   * page, chrome and all, and snapping back to the first-run offer.
   */
  const owned = mine.length > 0 || drafts.length > 0;
  const heroMode = !owned;
  const markedTotal = [...mine, ...presenters].reduce((n, p) => n + (marks.includes(p.id) ? 1 : 0), 0);
  const keepersZero = onlyMarked && markedTotal === 0;
  /** Cold brands: an empty shortlist has nothing to hide, so the catalog stays up. */
  const keepersBrowse = keepersZero && heroMode;
  const keepersMessage = keepersZero && !heroMode;
  const showDrafts = !onlyMarked || keepersBrowse;
  const mineShown = minePlusBuilds.filter((p) => !onlyMarked || keepersBrowse || marks.includes(p.id));
  const showMine = (showDrafts && drafts.length > 0) || mineShown.length > 0;
  /**
   * Your half pages the way Products pages it. It mounted every card, so a
   * thousand people of your own were all in the DOM, and opening the studio
   * over the wall re-rendered each one. Drafts stay whole: they are few, and
   * they are the way back to unfinished work. Your people are newest first,
   * so a copy just made lands on the first page.
   */
  const {
    visible: mineVisible,
    remaining: mineRemaining,
    showMore: showMoreMine,
  } = useLibraryPage(
    mineShown,
    `${brand.id}|${category ?? ''}|${onlyMarked ? 'keepers' : ''}|${keepersBrowse ? 'browse' : ''}|${q}`,
  );
  // Grown before the bottom arrives, against the page's own scroller, as Products does.
  const [mineEnd, setMineEnd] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!mineEnd || mineRemaining <= 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) showMoreMine();
      },
      { root: mineEnd.closest('.sc-home'), rootMargin: '200% 0px' },
    );
    io.observe(mineEnd);
    return () => io.disconnect();
  }, [mineEnd, mineRemaining, showMoreMine]);
  const librarySource = useMemo(() => {
    if (!onlyMarked || keepersBrowse) return filtered;
    return filtered.filter((p) => marks.includes(p.id));
  }, [filtered, onlyMarked, keepersBrowse, marks]);
  const { visible, remaining, showMore } = useLibraryPage(
    librarySource,
    `${category ?? ''}|${onlyMarked ? 'keepers' : ''}|${keepersBrowse ? 'browse' : ''}|${q}`,
  );
  const mode = presenters.length + mine.length > 0 ? 'tabs' : 'none';

  const discardIds = useCallback(
    async (ids: string[]) => {
      const { failed, error } = await settlePicked(ids, (id) => api.deletePresenterDraft(brand.id, id));
      setDrafts((cur) => cur.filter((d) => failed.includes(d.id) || !ids.includes(d.id)));
      pick.retain(failed);
      void loadDrafts();
      if (error) push(failureToast(error, 'Could not discard these drafts'));
    },
    [brand.id, loadDrafts, pick.retain, push],
  );
  const askDraftBatch = () => {
    const rows = drafts.filter((d) => pick.ids.has(d.id));
    if (rows.some((d) => d.drawn)) {
      if (rows.length === 1) setDiscarding(rows[0]);
      else setDiscardingBatch(true);
    } else void discardIds(rows.map((d) => d.id));
  };
  const askPresenterBatch = () => {
    const ids = [...pick.ids];
    if (ids.length === 1) askDelete(ids[0]);
    else setDeletingBatch(true);
  };
  const pickedPresenterIds = [...pick.ids];
  const allPresentersKept =
    pick.kind === 'presenter' && pickedPresenterIds.length > 0 && pickedPresenterIds.every((id) => marks.includes(id));
  const keepPresenters = () => setMarks(setKept('presenter', brand.id, pickedPresenterIds, !allPresentersKept));
  const presenterKeep = keepersLine(pick.ids.size, allPresentersKept, 'presenters');
  const confirmPresenterBatch = async () => {
    if (acting) return;
    const ids = [...pick.ids];
    setActing(true);
    try {
      const { failed, error } = await settlePicked(ids, (id) => api.deletePresenter(brand.id, id));
      await refreshBrands();
      pick.retain(failed);
      setDeletingBatch(false);
      if (error) push(failureToast(error, 'Could not delete these presenters'));
    } finally {
      setActing(false);
    }
  };
  /**
   * Nothing of your own yet: the page leads with its offer.
   *
   * Ownership is the only input. It used to fold away on a filter too, which
   * meant clicking a category tab made the whole offer vanish and read as the
   * page breaking. The cold state now carries no filter chrome at all, so
   * there is nothing to click, and a deep link carrying a facet narrows the
   * wall underneath without disturbing the offer above it.
   */

  // Counts cover both halves of the wall. A tab that said "6" while showing
  // seven, because one of them was yours, is a tab that cannot be trusted.
  const facetGroup = {
    key: 'category',
    label: 'Category',
    everyLabel: 'All presenters',
    everyCount: presenters.length + mine.length,
    selected: onlyMarked ? KEEPERS : category,
    onSelect: (v: string | null) =>
      v === KEEPERS ? setFacets({ bookmarked: '1', category: null }) : setFacets({ bookmarked: null, category: v }),
    options: [
      { value: KEEPERS, label: 'Keepers', count: markedTotal },
      ...presenterCategories.map((c) => ({
        value: c,
        label: c,
        count: [...mine, ...presenters].filter((p) => !p.suitableCategories.length || p.suitableCategories.includes(c))
          .length,
      })),
    ],
  };

  /**
   * The filter row belongs to the wall it filters, and is gated on that wall
   * having contents — never on whether you own any of them. Home has always
   * read it this way (`showcase.length > 0`).
   *
   * In the cold state that wall is the roster, a screenful below the offer, so
   * the row travels down and sits directly on top of it. Left at the top it
   * filtered something you could not see, across an empty band. It is a sibling
   * of the wall rather than wrapped in a box that ends above it, so it stays
   * sticky for the whole length of the scroll.
   */
  const toolbar = (
    <LibraryToolbar
      title="Presenters"
      filters={<FacetFilter mode={mode} group={facetGroup} />}
      density={<DensityControl value={density} onChange={setDensity} />}
      search={
        presenters.length >= SEARCH_MIN && (
          <LibrarySearch value={q} onChange={setQ} noun="presenters" total={presenters.length} />
        )
      }
    />
  );

  return (
    <WallDensityCtx.Provider value={densityAttr}>
      <ScrollPane>
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard path is Escape, bound on the document, so a key handler here would be a second route to the same clear */}
        <main className="sc-looks sc-presenters" id="main" data-hero={heroMode || undefined} onClick={pick.onBlank}>
          {!heroMode && toolbar}

          {showMine && (
            <section className="sc-owned">
              <div className="sc-sec-head">
                <h2 className="sc-sec-title">Your presenters</h2>
              </div>
              <div
                ref={wall}
                className="sc-masonry"
                data-wall
                data-density
                data-density-size={densityAttr}
                style={wallStyle}
              >
                {showDrafts &&
                  drafts.map((d) => (
                    <PresenterDraftCard
                      key={d.id}
                      draft={d}
                      href={presenterStudioPath(brand, d.id)}
                      onDiscard={discardDraft}
                      chosen={pick.ids.has(d.id)}
                      batching={pick.batching === 'draft'}
                      onPick={pick.picking('draft') ? (id) => pick.toggle('draft', id) : undefined}
                      batch={
                        pick.kind === 'draft' && pick.ids.has(d.id)
                          ? { count: pick.ids.size, onAct: askDraftBatch }
                          : null
                      }
                    />
                  ))}
                {discarding && (
                  <Confirm
                    label="Discard"
                    title={`Discard ${discarding.name.trim() || 'this unfinished presenter'}?`}
                    body="The views drawn so far are thrown away. Nothing was saved to the library."
                    open
                    busy={false}
                    onOpenChange={(o) => {
                      if (!o) setDiscarding(null);
                    }}
                    onConfirm={() => {
                      drop(discarding.id);
                      setDiscarding(null);
                    }}
                  />
                )}
                {mineVisible.map((p) => (
                  <PresenterCard
                    key={p.id}
                    presenter={p}
                    variant="use"
                    size="grid"
                    onOpen={openPresenter}
                    href={presenterPath(brand, p.id)}
                    onUse={applyPresenter}
                    onDuplicate={askDuplicate}
                    onEdit={editPresenter}
                    onDelete={askDelete}
                    onRename={askRename}
                    bookmarked={marks.includes(p.id)}
                    onBookmark={keepOne}
                    fresh={p.id === justAdded}
                    chosen={pick.ids.has(p.id)}
                    batching={pick.batching === 'presenter'}
                    onPick={pick.picking('presenter') ? (id) => pick.toggle('presenter', id) : undefined}
                    batch={
                      pick.kind === 'presenter' && pick.ids.has(p.id)
                        ? {
                            count: pick.ids.size,
                            onAct: askPresenterBatch,
                            onKeep: keepPresenters,
                            allKept: allPresentersKept,
                          }
                        : null
                    }
                  />
                ))}
                {renaming && (
                  <RenameDialog
                    title="Rename presenter"
                    name={renaming.name}
                    maxLength={60}
                    busy={acting}
                    error={actError}
                    onConfirm={(name) => void confirmRename(name)}
                    onDismiss={() => {
                      if (!acting) setRenaming(null);
                    }}
                  />
                )}
                {duplicating && (
                  <DuplicatePresenterDialog
                    suggested={suggestedPresenterCopyName(
                      duplicating.name,
                      mine.map((p) => p.name),
                    )}
                    busy={acting}
                    error={actError}
                    onConfirm={(name) => void confirmDuplicate(name)}
                    onDismiss={() => {
                      if (!acting) setDuplicating(null);
                    }}
                  />
                )}
                {removing && (
                  <Confirm
                    label="Delete presenter"
                    title={`Delete ${removing.name}?`}
                    body="Shots already made with them keep their images and their recipe. Only future shots lose them."
                    open
                    busy={acting}
                    onOpenChange={(o) => {
                      if (!o && !acting) setRemoving(null);
                    }}
                    onConfirm={() => void confirmDelete()}
                  />
                )}
                {deletingBatch && (
                  <Confirm
                    label={catalogPickVerb('presenter', pick.ids.size).menu}
                    title={`${catalogPickVerb('presenter', pick.ids.size).menu}?`}
                    body="Shots already made with them keep their images and their recipe. Only future shots lose them."
                    open
                    busy={acting}
                    onOpenChange={(o) => {
                      if (!o && !acting) setDeletingBatch(false);
                    }}
                    onConfirm={() => void confirmPresenterBatch()}
                  />
                )}
                {discardingBatch && (
                  <Confirm
                    label={catalogPickVerb('draft', pick.ids.size).menu}
                    title={`${catalogPickVerb('draft', pick.ids.size).menu}?`}
                    body="The views drawn so far are thrown away. Nothing was saved to the library."
                    open
                    busy={false}
                    onOpenChange={(o) => {
                      if (!o) setDiscardingBatch(false);
                    }}
                    onConfirm={() => {
                      const ids = [...pick.ids];
                      setDiscardingBatch(false);
                      void discardIds(ids);
                    }}
                  />
                )}
              </div>
              {mineRemaining > 0 && <div ref={setMineEnd} aria-hidden />}
              {mineRemaining > 0 && (
                <div className="sc-lib-more">
                  <button type="button" className="sc-btn sc-btn-ghost" onClick={showMoreMine}>
                    Show {Math.min(mineRemaining, 60)} more
                  </button>
                </div>
              )}
            </section>
          )}

          {/* The cold state, the same one Products shows: the offer, centred,
            with the roster underneath so the page is never an empty room. */}
          {heroMode && presentersLoaded && !presentersError && presenters.length > 0 && (
            <LibraryEmpty
              shape="cold"
              title={
                <>
                  Cast your own <em>presenter</em>
                </>
              }
              body="Describe someone new, or add photos of a real person. They stay the same person in every image you make."
              action={createCta}
            />
          )}

          {/* A heading only where it separates two things. Filter your own half
            away and the page is simply a wall of ours, which needs no label. */}
          {showMine && presentersLoaded && !presentersError && visible.length > 0 && (
            <div className="sc-sec-head sc-owned-divider">
              <h2 className="sc-sec-title">Scenri presenters</h2>
            </div>
          )}

          {!presentersLoaded && (
            <div className="sc-masonry" data-density data-density-size={densityAttr} style={wallStyle} aria-hidden>
              <PresenterCardSkeleton size="grid" count={8} />
            </div>
          )}

          {presentersLoaded && presentersError && (
            <LibraryEmpty
              shape="error"
              title="Couldn't load the presenter library"
              body="Something went wrong reaching the catalog."
              onRetry={() => refetchPresenters()}
            />
          )}

          {/* The seam, and the row that belongs to the roster under it. The only
            eyebrow on this page. */}
          {heroMode && presentersLoaded && !presentersError && presenters.length > 0 && (
            <>
              <StarterDivider label="Or cast someone from ours" />
              {toolbar}
            </>
          )}

          {presentersLoaded && !presentersError && visible.length > 0 && (
            <div className="sc-masonry" data-wall data-density data-density-size={densityAttr} style={wallStyle}>
              {visible.map((p) => (
                <PresenterCard
                  key={p.id}
                  presenter={p}
                  variant="use"
                  size="grid"
                  onOpen={openPresenter}
                  href={presenterPath(brand, p.id)}
                  onUse={applyPresenter}
                  bookmarked={marks.includes(p.id)}
                  onBookmark={keepOne}
                />
              ))}
            </div>
          )}

          {presentersLoaded && !presentersError && keepersMessage && (
            <LibraryEmpty
              shape="zero"
              body="Nothing in Keepers yet. Add a presenter to Keepers from its card and it stays here."
              action={
                <button type="button" className="sc-btn sc-btn-ghost" onClick={() => setFacets({ bookmarked: null })}>
                  Browse every presenter
                </button>
              }
            />
          )}

          {presentersLoaded &&
            !presentersError &&
            !keepersMessage &&
            !librarySource.length &&
            presenters.length > 0 && (
              <LibraryZero
                noun="presenters"
                q={q}
                facet={onlyMarked ? 'Keepers' : category}
                onClearSearch={clearSearch}
                onClearAll={clear}
              />
            )}

          {presentersLoaded && !presentersError && !presenters.length && (
            <LibraryEmpty shape="zero" body="The presenter library is still being cast. Check back soon." />
          )}

          {remaining > 0 && (
            <div className="sc-lib-more">
              <button type="button" className="sc-btn sc-btn-ghost" onClick={showMore}>
                Show {Math.min(remaining, 60)} more
              </button>
            </div>
          )}
        </main>
      </ScrollPane>
      {pick.ids.size > 0 && (pick.kind === 'draft' || pick.kind === 'presenter') && (
        <div className="sc-wall-dock">
          <CatalogPickedBar
            count={pick.ids.size}
            loaded={pick.kind === 'draft' ? drafts.length : mineVisible.length}
            tool={catalogPickVerb(pick.kind, pick.ids.size).tool}
            icon={catalogPickVerb(pick.kind, pick.ids.size).icon}
            danger={catalogPickVerb(pick.kind, pick.ids.size).danger}
            onAct={pick.kind === 'draft' ? askDraftBatch : askPresenterBatch}
            keep={
              pick.kind === 'presenter'
                ? { label: presenterKeep.tool, filled: allPresentersKept, onAct: keepPresenters }
                : null
            }
            onClear={pick.clear}
            onSelectAll={() =>
              pick.selectAll(
                pick.kind === 'draft' ? 'draft' : 'presenter',
                (pick.kind === 'draft' ? drafts : mineVisible).map((row) => row.id),
              )
            }
          />
        </div>
      )}
      {/* the presenter studio, when its route is open: full-bleed over this
          library, which stays mounted and scrolled where it was */}
      <Outlet />
    </WallDensityCtx.Provider>
  );
}
