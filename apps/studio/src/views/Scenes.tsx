import { useCallback, useEffect, useMemo, useState } from 'react';
import { sceneSearchText } from '../displayName.js';
import { Outlet, useMatch, useNavigate } from 'react-router';
import { Plus, SunHorizon } from '@phosphor-icons/react';
import { api } from '../api.js';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { useTaskCenter } from '../app/TaskCenter.js';
import { useCreateAsset } from '../create/AssetCreateHost.js';
import { customScenesOf, type CustomScene } from '../brandAssets.js';
import { P, scenePath, sceneStudioPath } from '../routes.js';
import { DraftCard } from '../layout/DraftCard.js';
import {
  forgetSceneDraft,
  keptSceneDrafts,
  type SceneDraft,
  sceneDraftState,
  sceneDrafts,
} from '../create/scene/sceneDrafts.js';
import { useApplyScene } from '../app/useApplyScene.js';
import { bookmarkedScenes, setKept, toggleKept } from '../bookmarks.js';
import { Confirm } from '../Confirm.js';
import { RenameDialog } from '../layout/RenameDialog.js';
import { failureToast } from '../failure.js';
import { useToasts } from '../toasts.js';
import { AssetBuildCard } from '../layout/AssetBuildCard.js';
import { SceneCard, SceneCardSkeleton } from '../layout/SceneCard.js';
import { CatalogPickedBar } from '../layout/CatalogPickedBar.js';
import { catalogPickVerb, keepersLine, settlePicked } from '../layout/catalogPick.js';
import { useCatalogPick } from '../layout/useCatalogPick.js';
import { DensityControl, WallDensityCtx, densitySize, densityWallStyle } from '../layout/DensityControl.js';
import { DENSITY_DEFAULT, normalizeDensity, type DensityCols } from '../layout/masonry.js';
import { LibraryToolbar } from '../layout/library/LibraryToolbar.js';
import { LibrarySearch } from '../layout/library/LibrarySearch.js';
import { FacetFilter } from '../layout/library/FacetFilter.js';
import { keepersMark, LibraryEmpty, LibraryZero } from '../layout/library/LibraryEmpty.js';
import { StarterDivider } from '../layout/library/StarterDivider.js';
import { useLibraryQuery } from '../layout/library/useLibraryQuery.js';
import { useLibraryPage } from '../layout/library/useLibraryPage.js';

/** Cards a collection shows before asking; the same page the flat wall turns. */
const COLLECTION_PAGE = 24;
import { matchesQuery, type FacetMode } from '../layout/library/libraryRules.js';
import { ScrollPane } from '../layout/ScrollPane.js';
import { PREF, useLocalPref } from '../prefs.js';

/** Below this, a search box has nothing worth narrowing — the whole set is one screenful. */
const SEARCH_MIN = 8;

/**
 * The rail's value for the Keepers tab. A shortlist is a different axis from
 * vertical, so it rides its own `?bookmarked=1` param and this string never
 * reaches the URL — which is why it can't collide with a real vertical name.
 */
const KEEPERS = '__bookmarked';

/**
 * The scenes library, built on the shared Creative Library shell
 * (layout/library/). A scene is a photographic
 * setup, so browsing is nothing but the pictures — sections are collections
 * (Studio, Social, Portrait…), real art-direction groupings, not decoration,
 * so they survive the shared shell rather than being flattened into one
 * undifferentiated grid. That sectioning only makes sense while browsing:
 * the moment a search term is active, three matches scattered across five
 * sections reads worse than one flat result list, so search collapses to a
 * single grid instead. Keepers collapses it the same way, for the same
 * reason.
 *
 * Adding a card to Keepers is what makes a catalog this size yours, and the
 * Keepers tab is where that lands — one more tab on the rail you already use.
 */
export function ScenesView() {
  const { scenes: catalog, collections, verticals, loaded, error, refetch, applyBrand, refreshBrands } = useAppData();
  const { brand } = useBrand();
  // the catalog as this brand shows it: a cover it chose is on the card
  const scenes = catalog;
  const { push } = useToasts();
  const navigate = useNavigate();
  // The shortlist, per brand, in localStorage — deliberately not in the .brand
  // document. Read once here so every card on the wall shares one answer.
  const [marks, setMarks] = useState<string[]>(() => bookmarkedScenes(brand.id));
  const bookmark = (id: string) => setMarks(toggleKept('scene', brand.id, id));
  const applyScene = useApplyScene();
  // One poll for the whole app, owned by TaskCenter: a build started from the
  // top bar on any screen has to stay visible after you leave the screen that
  // started it.
  const { builds, poke: refreshBuilds, studio } = useTaskCenter();
  const createAsset = useCreateAsset();
  const mine = useMemo(() => customScenesOf(brand), [brand]);
  const buildingScenes = builds.filter((b) => b.kind === 'scene' && (!b.finished || b.stage === 'failed'));
  /**
   * Scenes still being made, first on the wall: one closed while it drew, or
   * drawn and left without Use. The studio is this page's own child, so what
   * it kept is read again each time it closes, and whenever its work moves on
   * the server (a draw that lands while you are here turns its card into the
   * picture). See `sceneDrafts`.
   */
  const inStudio = !!useMatch({ path: P.sceneStudio });
  const [keptDrafts, setKeptDrafts] = useState(() => keptSceneDrafts(brand.id));
  const moved = studio
    .filter((w) => w.kind === 'scene')
    .map((w) => `${w.id}:${w.status}`)
    .join('|');
  useEffect(() => {
    if (!inStudio) setKeptDrafts(keptSceneDrafts(brand.id));
  }, [inStudio, brand.id, moved]);
  const drafts = useMemo(() => sceneDrafts(keptDrafts, studio), [keptDrafts, studio]);
  const [discarding, setDiscarding] = useState<SceneDraft | null>(null);
  const dropDraft = (d: SceneDraft) => {
    if (d.drawing && d.jobId) void api.cancelSceneStudioJob(brand.id, d.jobId).catch(() => undefined);
    forgetSceneDraft(brand.id, d.convo);
    setKeptDrafts(keptSceneDrafts(brand.id));
  };
  // Throwing away a drawn picture asks first, the way a presenter draft does.
  const discardDraft = (convo: string) => {
    const d = drafts.find((x) => x.convo === convo);
    if (!d) return;
    if (d.hash || d.drawing) setDiscarding(d);
    else dropDraft(d);
  };
  const { q, setQ, facets, setFacets, clearSearch, clear } = useLibraryQuery(['vertical', 'bookmarked']);
  const vertical = facets.vertical;
  const onlyMarked = facets.bookmarked === '1';
  const pick = useCatalogPick(`${brand.id}|${q}|${vertical ?? ''}|${onlyMarked ? '1' : ''}`);
  const searching = q.trim().length > 0;
  const [tile, setTile] = useLocalPref(PREF.wallDensity, DENSITY_DEFAULT);
  const density = normalizeDensity(tile);
  const setDensity = (cols: DensityCols) => setTile(cols);
  const wallStyle = densityWallStyle(density);
  const densityAttr = densitySize(density);

  const openScene = (id: string) => navigate(scenePath(brand, id));
  const [removing, setRemoving] = useState<CustomScene | null>(null);
  const [removingBusy, setRemovingBusy] = useState(false);
  const [renaming, setRenaming] = useState<CustomScene | null>(null);
  const [renamingBusy, setRenamingBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deletingBatch, setDeletingBatch] = useState(false);
  const askDelete = useCallback(
    (id: string) => {
      const scene = mine.find((s) => s.id === id);
      if (scene) setRemoving(scene);
    },
    [mine],
  );
  const askRename = useCallback(
    (id: string) => {
      const scene = mine.find((s) => s.id === id);
      if (!scene) return;
      setRenameError(null);
      setRenaming(scene);
    },
    [mine],
  );
  const confirmRename = async (name: string) => {
    if (!renaming || renamingBusy) return;
    setRenamingBusy(true);
    setRenameError(null);
    try {
      applyBrand((await api.updateScene(brand.id, renaming.id, { name })).brand);
      setRenaming(null);
    } catch (e: any) {
      const f = failureToast(e, 'Could not rename this scene');
      setRenameError([f.title, f.detail].filter(Boolean).join(' '));
    } finally {
      setRenamingBusy(false);
    }
  };
  const confirmDelete = async () => {
    if (!removing || removingBusy) return;
    setRemovingBusy(true);
    try {
      applyBrand((await api.deleteScene(brand.id, removing.id)).brand);
      pick.forget(removing.id);
      setRemoving(null);
    } catch (e: any) {
      if (e?.status === 404) {
        await refreshBrands();
        pick.forget(removing.id);
        setRemoving(null);
      } else push(failureToast(e, 'Could not delete this scene'));
    } finally {
      setRemovingBusy(false);
    }
  };

  const byFacet = useMemo(() => {
    if (onlyMarked) return scenes.filter((s) => marks.includes(s.id));
    return vertical ? scenes.filter((s) => s.verticals.includes(vertical)) : scenes;
  }, [scenes, vertical, onlyMarked, marks]);

  const owned = mine.length > 0 || buildingScenes.length > 0 || drafts.length > 0;
  const heroMode = !owned;
  const markedTotal = [...scenes, ...mine].reduce((n, s) => n + (marks.includes(s.id) ? 1 : 0), 0);
  /** The one empty wall that is not a failure: a tab you have not filled yet. */
  const bookmarksZero = onlyMarked && markedTotal === 0;
  /** Cold brands: an empty shortlist has nothing to show — keep the catalog up. */
  const bookmarksBrowse = bookmarksZero && heroMode;
  /**
   * The tab has its own thing to say, so nothing else should also speak.
   *
   * Gate the zero-result state on *this*, not on `bookmarksZero`: in
   * `bookmarksBrowse` the wall is the whole catalog, a search can still empty
   * it, and suppressing both messages left a blank page under a filled-in
   * search box — the same silence this file already fixed once.
   */
  const bookmarksMessage = bookmarksZero && !heroMode;

  /** Sections are for browsing. Narrow the wall by anything and one flat list reads better. */
  const flat = searching || (onlyMarked && !bookmarksBrowse);

  const wallSource = useMemo(() => (bookmarksBrowse ? scenes : byFacet), [bookmarksBrowse, scenes, byFacet]);

  const filtered = useMemo(
    () =>
      wallSource.filter((s) =>
        // sceneSearchText folds in keywords and pre-rename names, so a short
        // display name never costs a scene its findability.
        matchesQuery(sceneSearchText(s), q),
      ),
    [wallSource, q],
  );

  /** Collections the reader has opened out past their first page. */
  const [openCollections, setOpenCollections] = useState<ReadonlySet<string>>(() => new Set());
  const { visible, remaining, showMore } = useLibraryPage(
    filtered,
    `${vertical ?? ''}|${onlyMarked ? 'bookmarked' : ''}|${bookmarksBrowse ? 'browse' : ''}|${q}`,
  );

  // Both halves of the wall, counted by the same rule the tab filters by
  // (untagged included), so the number always equals what the tab shows.
  const countFor = (v: string) =>
    [...mine, ...scenes].filter((s) => !s.verticals.length || s.verticals.includes(v)).length;

  // Bookmarks always leads the rail, including at zero. A tab that appears
  // with the first bookmark would shift every vertical along under the cursor
  // at the exact moment of clicking one, and a rail whose shape depends on your
  // history is a rail you can't build muscle memory for. Empty, it teaches
  // itself. The count is what the tab can actually show: a bookmark outlives
  // its scene leaving the catalog, so the stored list is not the same as the tab.
  const facetOptions = [
    { value: KEEPERS, label: 'Keepers', count: markedTotal },
    ...verticals.map((v) => ({ value: v, label: v, count: countFor(v) })),
  ];
  // Not facetMode's call any more: "All scenes" plus "Keepers" is already
  // two real choices, so the rail earns itself the moment there is a catalog,
  // however few verticals that catalog happens to carry.
  const mode: FacetMode = scenes.length > 0 ? 'tabs' : 'none';

  const facetGroup = {
    key: 'vertical',
    label: 'Vertical',
    everyLabel: 'All scenes',
    everyCount: scenes.length + mine.length,
    selected: onlyMarked ? KEEPERS : vertical,
    // One write, both axes: `bookmarked` and `vertical` are mutually exclusive,
    // and two separate setFacet calls would have the second undo the first.
    onSelect: (v: string | null) =>
      v === KEEPERS ? setFacets({ bookmarked: '1', vertical: null }) : setFacets({ bookmarked: null, vertical: v }),
    options: facetOptions,
  };

  /**
   * The brand's own places, narrowed by whatever the wall is narrowed by.
   *
   * A custom scene answers to search, to a vertical, and to Keepers. A scene
   * you kept has to be on the tab, including one you wrote yourself.
   */
  const mineShown = useMemo(
    () =>
      mine
        // Untagged is unfiltered: a scene nobody categorised would otherwise
        // vanish from every tab, which reads as losing it.
        .filter((s) => (vertical ? !s.verticals.length || s.verticals.includes(vertical) : true))
        .filter((s) => matchesQuery(sceneSearchText(s), q))
        .filter((s) => (onlyMarked ? marks.includes(s.id) : true)),
    [mine, vertical, q, onlyMarked, marks],
  );
  /**
   * Whether this brand has scenes of its own at all, before any filter.
   *
   * Not "does the filtered list have anything": narrowing to a vertical your
   * one scene is not in used to drop the whole page back to the first-run
   * offer, chrome included.
   */
  const showMine = onlyMarked
    ? mineShown.length > 0
    : drafts.length > 0 || buildingScenes.length > 0 || mineShown.length > 0;
  /**
   * Your half pages the way Products pages it. It mounted every card, so a
   * thousand scenes of your own were all in the DOM, and opening the studio
   * over the wall re-rendered each one. Drafts and builds stay whole: they are
   * few, and they are work still moving. Your scenes are newest first, so one
   * just made lands on the first page.
   */
  const {
    visible: mineVisible,
    remaining: mineRemaining,
    showMore: showMoreMine,
  } = useLibraryPage(mineShown, `${brand.id}|${vertical ?? ''}|${onlyMarked ? 'bookmarked' : ''}|${q}`);
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

  const askSceneBatch = () => {
    if (pick.ids.size === 1) askDelete([...pick.ids][0]);
    else setDeletingBatch(true);
  };
  const pickedSceneIds = [...pick.ids];
  const allScenesKept = pickedSceneIds.length > 0 && pickedSceneIds.every((id) => marks.includes(id));
  const keepScenes = () => setMarks(setKept('scene', brand.id, pickedSceneIds, !allScenesKept));
  const sceneKeep = keepersLine(pick.ids.size, allScenesKept, 'scenes');
  const confirmSceneBatch = async () => {
    if (removingBusy) return;
    const ids = [...pick.ids];
    setRemovingBusy(true);
    try {
      const { failed, error } = await settlePicked(ids, (id) => api.deleteScene(brand.id, id));
      await refreshBrands();
      pick.retain(failed);
      setDeletingBatch(false);
      if (error) push(failureToast(error, 'Could not delete these scenes'));
    } finally {
      setRemovingBusy(false);
    }
  };
  /**
   * Nothing of your own yet: the page leads with its offer.
   *
   * Ownership is the only input. A filter can never make the offer appear or
   * vanish — this used to also read `&& !onlyMarked`, which meant selecting
   * the Keepers tab tore the offer out from under the row and moved the row
   * itself to the top of the page, at the moment of the click.
   */

  const createCta = (
    <button type="button" className="sc-btn sc-btn-primary" onClick={() => createAsset('scene')}>
      <Plus size={12} /> Create scene
    </button>
  );

  const grid = (items: typeof scenes, wall = false) => (
    <div
      className="sc-masonry"
      data-wall={wall || undefined}
      data-density
      data-density-size={densityAttr}
      style={wallStyle}
    >
      {items.map((s) => (
        <SceneCard
          key={s.id}
          scene={s}
          variant="use"
          size="grid"
          onOpen={openScene}
          href={scenePath(brand, s.id)}
          onUse={applyScene}
          bookmarked={marks.includes(s.id)}
          onBookmark={bookmark}
        />
      ))}
    </div>
  );

  /**
   * The filter row belongs to the wall it filters, and is gated on that wall
   * having contents — never on whether you own any of them. Home has always
   * read it this way (`showcase.length > 0`); the library pages rode ownership
   * instead, which hid search and every vertical from a brand that had not
   * authored a scene of its own. That is nearly every brand: leaving the cold
   * state takes a whole build flow, so it is the state this page lives in.
   *
   * In the cold state the wall is a screenful below the offer, so the row goes
   * down with it and sits directly on top of it. It stays sticky there — it is
   * a sibling of the wall, not wrapped in a box that ends above it, so it docks
   * under the nav for the whole length of the scroll.
   *
   * What it must never do is arrive. A row that appears when you bookmark your
   * first scene shoves the wall — and the card you just clicked — down by its
   * own height, which is the same objection the Bookmarks tab itself answers by
   * rendering at zero.
   */
  const toolbar = (
    <LibraryToolbar
      title="Scenes"
      filters={<FacetFilter mode={mode} group={facetGroup} />}
      density={<DensityControl value={density} onChange={setDensity} />}
      search={
        scenes.length >= SEARCH_MIN && <LibrarySearch value={q} onChange={setQ} noun="scenes" total={scenes.length} />
      }
    />
  );

  return (
    <WallDensityCtx.Provider value={densityAttr}>
      <ScrollPane>
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard path is Escape, bound on the document, so a key handler here would be a second route to the same clear */}
        <main className="sc-looks sc-scenes" id="main" data-hero={heroMode || undefined} onClick={pick.onBlank}>
          {!heroMode && toolbar}

          {showMine && (
            <section className="sc-owned">
              <div className="sc-sec-head">
                <h2 className="sc-sec-title">Your scenes</h2>
              </div>
              <div className="sc-masonry" data-wall data-density data-density-size={densityAttr} style={wallStyle}>
                {!onlyMarked &&
                  drafts.map((d) => (
                    <DraftCard
                      key={d.convo}
                      id={d.convo}
                      name={d.name || 'Untitled scene'}
                      hash={d.hash}
                      drawing={d.drawing}
                      state={sceneDraftState(d)}
                      href={sceneStudioPath(brand, d.convo)}
                      blank={<SunHorizon size={44} weight="thin" />}
                      onDiscard={discardDraft}
                    />
                  ))}
                {discarding && (
                  <Confirm
                    label="Discard"
                    title={`Discard ${discarding.name || 'this unfinished scene'}?`}
                    body={
                      discarding.drawing
                        ? 'The picture being drawn is stopped, and what was drawn here is thrown away. Nothing was saved to the library.'
                        : 'What was drawn here is thrown away. Nothing was saved to the library.'
                    }
                    open
                    busy={false}
                    onOpenChange={(o) => {
                      if (!o) setDiscarding(null);
                    }}
                    onConfirm={() => {
                      dropDraft(discarding);
                      setDiscarding(null);
                    }}
                  />
                )}
                {!onlyMarked &&
                  buildingScenes.map((b) => (
                    <AssetBuildCard
                      key={b.id}
                      build={b}
                      onCancel={(id) => void api.cancelAssetBuild(brand.id, id).then(refreshBuilds)}
                      onDismiss={(id) => void api.deleteAssetBuild(brand.id, id).then(refreshBuilds)}
                      onRetry={() => createAsset('scene')}
                    />
                  ))}
                {mineVisible.map((s) => (
                  <SceneCard
                    key={s.id}
                    scene={s}
                    variant="use"
                    size="grid"
                    onOpen={openScene}
                    href={scenePath(brand, s.id)}
                    onUse={applyScene}
                    bookmarked={marks.includes(s.id)}
                    onBookmark={bookmark}
                    onDelete={askDelete}
                    onRename={askRename}
                    chosen={pick.ids.has(s.id)}
                    batching={pick.batching === 'owned-scene'}
                    onPick={pick.picking('owned-scene') ? (id) => pick.toggle('owned-scene', id) : undefined}
                    batch={
                      pick.kind === 'owned-scene' && pick.ids.has(s.id)
                        ? { count: pick.ids.size, onAct: askSceneBatch, onKeep: keepScenes, allKept: allScenesKept }
                        : null
                    }
                  />
                ))}
              </div>
              {mineRemaining > 0 && <div ref={setMineEnd} aria-hidden />}
              {mineRemaining > 0 && (
                <div className="sc-lib-more">
                  <button type="button" className="sc-btn sc-btn-ghost" onClick={showMoreMine}>
                    Show {Math.min(mineRemaining, 60)} more
                  </button>
                </div>
              )}
              {renaming && (
                <RenameDialog
                  title="Rename scene"
                  name={renaming.name}
                  maxLength={60}
                  busy={renamingBusy}
                  error={renameError}
                  onConfirm={(name) => void confirmRename(name)}
                  onDismiss={() => {
                    if (!renamingBusy) setRenaming(null);
                  }}
                />
              )}
              {removing && (
                <Confirm
                  label="Delete scene"
                  title={`Delete ${removing.name}?`}
                  body="Shots already made here keep their images and their recipe. Only future shots lose it."
                  open
                  busy={removingBusy}
                  onOpenChange={(o) => {
                    if (!o && !removingBusy) setRemoving(null);
                  }}
                  onConfirm={() => void confirmDelete()}
                />
              )}
              {deletingBatch && (
                <Confirm
                  label={catalogPickVerb('owned-scene', pick.ids.size).menu}
                  title={`${catalogPickVerb('owned-scene', pick.ids.size).menu}?`}
                  body="Shots already made here keep their images and their recipe. Only future shots lose it."
                  open
                  busy={removingBusy}
                  onOpenChange={(o) => {
                    if (!o && !removingBusy) setDeletingBatch(false);
                  }}
                  onConfirm={() => void confirmSceneBatch()}
                />
              )}
            </section>
          )}

          {/* The cold state, the same one Products shows. */}
          {heroMode && loaded && !error && scenes.length > 0 && (
            <LibraryEmpty
              shape="cold"
              title={
                <>
                  Build your own <em>scene</em>
                </>
              }
              body="Upload a few references of a place, or describe it, and its light and materials carry into every image you make."
              action={createCta}
            />
          )}

          {/* A heading only where it separates two things. */}
          {showMine && loaded && !error && byFacet.length > 0 && (
            <div className="sc-sec-head sc-owned-divider">
              <h2 className="sc-sec-title">Scenri scenes</h2>
            </div>
          )}

          {/* The seam, and the row that belongs to the wall under it. Both sit
            outside the sectioned branch below on purpose: searching or picking
            Bookmarks flips `flat`, and a row that unmounts as you type in it is
            worse than one that never appeared. */}
          {heroMode && loaded && !error && scenes.length > 0 && (
            <>
              <StarterDivider label="Or start from one of ours" />
              {toolbar}
            </>
          )}

          {!loaded && (
            <div className="sc-masonry" data-density data-density-size={densityAttr} style={wallStyle} aria-hidden>
              <SceneCardSkeleton size="grid" count={8} />
            </div>
          )}

          {loaded && error && (
            <LibraryEmpty
              shape="error"
              title="Couldn't load this library"
              body="Something went wrong reaching the catalog."
              onRetry={() => refetch()}
            />
          )}

          {loaded &&
            !error &&
            !flat &&
            collections.map((c) => {
              const inCollection = wallSource.filter((s) => s.collections.includes(c));
              if (!inCollection.length) return null;
              // A collection shows one page and says how many more there are:
              // this view was the one wall in the app that mounted every card
              // it could name, and a brand's own scenes land in one collection.
              const opened = openCollections.has(c);
              const shown = opened ? inCollection : inCollection.slice(0, COLLECTION_PAGE);
              return (
                // Just the heading and the wall. The row of scene names that
                // used to sit here repeated, in text, every card directly
                // below it: two ways to open the same thing, stacked.
                <section className="sc-coll" key={c}>
                  <h2>{c}</h2>
                  {grid(shown)}
                  {shown.length < inCollection.length && (
                    <div className="sc-lib-more">
                      <button
                        type="button"
                        className="sc-btn sc-btn-ghost"
                        onClick={() => setOpenCollections((cur) => new Set(cur).add(c))}
                      >
                        Show all {inCollection.length}
                      </button>
                    </div>
                  )}
                </section>
              );
            })}

          {loaded && !error && flat && visible.length > 0 && grid(visible, true)}

          {/* An empty Bookmarks tab is not a failed search — nothing went wrong,
            there is just nothing here yet. Say what puts something here. In the
            cold state the catalog stays up instead: there is nothing to hide
            behind an empty wall, and the instruction only works if cards are
            on screen. */}
          {loaded && !error && bookmarksMessage && (
            <LibraryEmpty
              shape="zero"
              title="Nothing in Keepers yet"
              body="Keep a scene from its card and it stays here."
              mark={keepersMark}
              action={
                <button type="button" className="sc-btn sc-btn-primary" onClick={() => setFacets({ bookmarked: null })}>
                  Browse every scene
                </button>
              }
            />
          )}

          {/* Everything else that empties the wall: a search, a vertical, or both.
            Gated on the message above actually rendering, never on a proxy for
            it. It used to read `markedTotal > 0`, then `!bookmarksZero`; both
            were shorthand for "not the case above" and both left a state where
            neither spoke and the page went blank under a filled-in search box.
            The facet it names is the one the wall was actually narrowed by —
            in `bookmarksBrowse` that is nothing, because the wall is the whole
            catalog. */}
          {loaded &&
            !error &&
            scenes.length > 0 &&
            !bookmarksMessage &&
            filtered.length === 0 &&
            mineShown.length === 0 && (
              <LibraryZero
                noun="scenes"
                q={q}
                facet={bookmarksBrowse ? null : onlyMarked ? 'Keepers' : vertical}
                onClearSearch={clearSearch}
                onClearAll={clear}
              />
            )}

          {flat && remaining > 0 && (
            <div className="sc-lib-more">
              <button type="button" className="sc-btn sc-btn-ghost" onClick={showMore}>
                Show {Math.min(remaining, 60)} more
              </button>
            </div>
          )}
        </main>
      </ScrollPane>
      {/* the scene studio, when its route is open: full-bleed over this
          library, which stays mounted and scrolled where it was */}
      <Outlet />
      {pick.kind === 'owned-scene' && pick.ids.size > 0 && (
        <div className="sc-wall-dock">
          <CatalogPickedBar
            count={pick.ids.size}
            loaded={mineVisible.length}
            tool={catalogPickVerb('owned-scene', pick.ids.size).tool}
            icon={catalogPickVerb('owned-scene', pick.ids.size).icon}
            danger
            onAct={askSceneBatch}
            keep={{ label: sceneKeep.tool, filled: allScenesKept, onAct: keepScenes }}
            onClear={pick.clear}
            onSelectAll={() =>
              pick.selectAll(
                'owned-scene',
                mineVisible.map((s) => s.id),
              )
            }
          />
        </div>
      )}
    </WallDensityCtx.Provider>
  );
}
