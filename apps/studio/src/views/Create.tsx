import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useNavigate, useSearchParams } from 'react-router';
import { api, nodeLabel, type FeedNode, type FeedQuery, type ShotSet } from '../api.js';
import { useAppData, useFilterParam } from '../app/AppShell.js';
import { useAssetsPanel, useBrand } from '../app/BrandLayout.js';
import { useTaskCenter } from '../app/TaskCenter.js';
import { showcaseBrief } from '../app/useApplyShowcase.js';
import { hubPath, presenterPath, productPath, scenePath, setPath } from '../routes.js';
import { briefTokens } from '../composer/BriefInput.js';
import { useIngredientCatalog } from '../composer/useIngredientCatalog.js';
import { NO_ATTACHMENTS, type AttachedIds } from '../layout/railSections.js';
import { productLabel, sceneLabel } from '../displayName.js';
import { saveDraft } from '../draft.js';
import { generationMessages } from '../liveStatus.js';
import { isFeedSort, isLens, type FeedSort, type Lens, type TokenNames } from '../feedRules.js';
import { PREF, useLocalPref } from '../prefs.js';
import { PHONE, useMediaQuery } from '../useMediaQuery.js';
import { useToasts } from '../toasts.js';
import { Shortcuts } from '../layout/Shortcuts.js';
import { useLibraryQuery } from '../layout/library/useLibraryQuery.js';
import { FailureRow } from '../layout/Failure.js';
import { describeFailure, failureToast } from '../failure.js';
import { Canvas } from '../layout/Canvas.js';
import { CompareDialog } from '../layout/CompareDialog.js';
import { AssetsPanel } from '../layout/AssetsPanel.js';
import { Composer, type ComposerHandle } from '../layout/Composer.js';
import { ComposerDock } from '../layout/ComposerDock.js';
import { FeedToolbar } from '../layout/FeedToolbar.js';
import { TILE_DEFAULT, nearestTileStop } from '../layout/masonry.js';
import { useArchiveNode } from '../useArchiveNode.js';
import { useDeleteNode } from '../useDeleteNode.js';
import { FirstRun } from './create/FirstRun.js';
import { LensEmpty } from './create/LensEmpty.js';
import { PickedBar } from './create/PickedBar.js';
export type { ShotContext } from './create/shotContext.js';
import type { ShotContext } from './create/shotContext.js';
import { useFeedQuery } from './create/useFeedQuery.js';
import type { AdmitContext } from './create/feedQueryRules.js';
import { useNodeId } from './create/useNodeId.js';
import { useResolvedNode } from './create/useResolvedNode.js';

/**
 * The hub: everything this brand has made, and the brief that makes more.
 *
 * This is where the assets rail, the lens row and the selection live, because
 * this is the only screen that is a tool. Home is the way in and carries none
 * of it.
 *
 * The feed is the whole brand, as a paged query. It used to be every shot the
 * brand had ever made, held here and filtered, sorted and searched in render:
 * a workspace of twenty thousand shots was twenty thousand records to parse,
 * twenty thousand tiles to mount, and twenty thousand records to re-read for
 * every keeper toggle. The server answers one page for one place, lens,
 * search and sort; this screen holds the pages it has scrolled to and folds
 * every change in by id. A set is a place in that query, and `set` of null is
 * not an empty state but the ordinary one.
 */
export function CreateView({ set }: { set: ShotSet | null }) {
  const { engines, scenes: templates, presenters, demoProducts, showcase, showcaseLoaded } = useAppData();
  const {
    brand,
    workspace,
    root,
    recent,
    sets,
    membership,
    loaded: frameLoaded,
    refresh,
    applySet,
    dropSet,
    insertSet,
    applyMembership,
    applyNodes,
    subscribeActivity,
    products,
  } = useBrand();
  // The rail offers what a brief can resolve, so the brand's own assets lead
  // it exactly as they do in the composer's own attach panel.
  // One assembled catalog for this screen. The rail builds its own from the
  // same hook; this copy exists for `tokenNames` below, which has to be able
  // to name a token that points at a scene this brand built for itself.
  const catalog = useIngredientCatalog();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const nodeId = useNodeId();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { open: rawAssetsOpen, toggle: toggleAssets, setOpen: setAssetsOpen } = useAssetsPanel();
  const phone = useMediaQuery(PHONE);
  /**
   * The assets panel does not exist on a phone.
   *
   * There is no column for it there, so it could only cover the work as a
   * drawer, and every asset in it is already reachable from the composer's own
   * attach control. A stored preference from a desktop session must not be
   * able to open it on a phone either, which is why this gates the value
   * rather than the button.
   */
  const assetsOpen = rawAssetsOpen && !phone;
  const [err, setErr] = useState<string | null>(null);
  /** What the docked composer's brief holds, so the rail can tick it. */
  const [attached, setAttached] = useState<AttachedIds>(NO_ATTACHMENTS);
  /** The composer's identity ceiling, for the rail beside it: the same sentence, the same dimming. */
  const [ceiling, setCeiling] = useState<string | null>(null);
  const [remixBrief, setRemixBrief] = useState<any>(null);
  /** Which use case is sitting in the brief right now, so its card can say so. */
  const [stagedId, setStagedId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [lensParam, setLens] = useFilterParam('tab', 'all');
  /**
   * Which pile of the brand you are looking at, when it is not a set.
   *
   * A set is a route because it is somewhere you can be; "not in a set" is the
   * same kind of answer without an address of its own, so it rides here. It
   * used to be a fourth lens tab, which put a filing chore beside the two
   * lenses people look through all day and made the row read as one question
   * when it is two.
   */
  const [placeParam, setPlace] = useFilterParam('in', '');
  /**
   * The shot the brief will branch from.
   *
   * In the URL rather than in state, for the same reason the lens is: the set
   * route is keyed and remounts on every switch, and a branch you asked for is
   * not something a change of view should quietly forget. It also survives a
   * reload, which is what makes "Branch, go and look at something, come back"
   * work at all.
   */
  const [branchId, setBranchId] = useFilterParam('branch', '');
  /**
   * Looking at one shot and everything that came from it. A lens rather than a
   * place, so it rides in the query string next to the others: it is a way of
   * looking at the hub, not somewhere you can be.
   */
  const [lineageId, setLineageId] = useFilterParam('lineage', '');
  /** How big the feed tiles are (px). Create-only preference, snapped to one
   * of three sizes — the pref key predates them and can hold any slider value. */
  const [tilePref, setTile] = useLocalPref(PREF.tileSize, TILE_DEFAULT);
  const tile = nearestTileStop(tilePref);
  /**
   * Free-text search over the feed. URL-backed (`?q=`) for the same reason the
   * lens is: the set route remounts on every switch, and a query you typed is
   * not something a change of view should quietly forget.
   */
  const { q, setQ, clearSearch } = useLibraryQuery([]);
  /** Feed ordering. A machine preference, not a location, so it lives in prefs. */
  const [sortPref, setSortPref] = useLocalPref<FeedSort>(PREF.feedSort, 'newest');
  const sort: FeedSort = isFeedSort(sortPref) ? sortPref : 'newest';
  const [compareOpen, setCompareOpen] = useState(false);
  const composerRef = useRef<ComposerHandle>(null);
  const { push } = useToasts();
  const { poke } = useTaskCenter();
  /** The brief that has been sent and not yet come back as shots, and how
   * many shots it asked for — one stand-in tile per expected sibling. */
  const [sending, setSending] = useState<{ said: string; count: number } | null>(null);

  const projectId = workspace?.id ?? '';
  const base = set ? setPath(brand, set) : hubPath(brand);
  /**
   * Opening a shot used to navigate to a bare path, which threw away the whole
   * query string: the lens you were looking through, and now the shot you had
   * asked to branch from, both vanished the moment you opened anything.
   */
  const shotHref = useCallback(
    (id: string) => {
      const q = params.toString();
      return `${base}/shots/${id}${q ? `?${q}` : ''}`;
    },
    [base, params],
  );
  // Built on shotHref so the tile's real href and the programmatic open can
  // never disagree about what URL a shot lives at.
  const openShot = useCallback(
    (id: string, replace = false) => navigate(shotHref(id), { replace }),
    [navigate, shotHref],
  );
  const closeShot = useCallback(() => {
    const p = new URLSearchParams(params);
    // the inspector tab was about the shot that is closing; the rest is about
    // the view. Leaving ?panel= behind meant a reloaded or shared link carried
    // overlay state that no longer applied to anything.
    p.delete('panel');
    const q = p.toString();
    // replace, not push: every in-overlay navigation since the initial open
    // has itself replaced rather than pushed, so this is the one entry to
    // consume, making X and the browser's Back button interchangeable
    navigate(`${base}${q ? `?${q}` : ''}`, { replace: true });
  }, [base, navigate, params]);

  const lens: Lens = isLens(lensParam) ? lensParam : 'all';
  /** Only ever a hub answer: inside a set, the set is the place. */
  const ungrouped = !set && placeParam === 'ungrouped';

  // `?tab=ungrouped` was this same pile back when it was a lens; a bookmark or
  // a shared link from then still lands on the shots it meant.
  useEffect(() => {
    if (lensParam !== 'ungrouped') return;
    setLens(null);
    setPlace('ungrouped');
  }, [lensParam, setLens, setPlace]);

  /** Which sets each shot is in, so a cell can say so without another request. */
  const setsByNode = useMemo(() => {
    const m = new Map<string, ShotSet[]>();
    for (const s of sets) {
      for (const id of membership[s.id] ?? []) {
        if (!m.has(id)) m.set(id, []);
        m.get(id)!.push(s);
      }
    }
    return m;
  }, [sets, membership]);

  /**
   * The one question this screen asks the server. Everything that decides
   * which shots are on screen lives in it, so a lens, a place, a search or a
   * sort is a new first page and nothing else.
   */
  const query = useMemo<FeedQuery>(
    () => ({
      lens,
      set: set?.id,
      ungrouped: ungrouped || undefined,
      lineage: lineageId || undefined,
      q: q.trim() || undefined,
      sort,
    }),
    [lens, set?.id, ungrouped, lineageId, q, sort],
  );

  /**
   * What the page rules need to know about a place, kept on refs so a record
   * folded in right after a membership change sees the membership it changed.
   */
  const membershipRef = useRef(membership);
  membershipRef.current = membership;
  const setsByNodeRef = useRef(setsByNode);
  setsByNodeRef.current = setsByNode;
  const lineageIdsRef = useRef<Set<string>>(new Set());
  const admitCtx = useMemo<AdmitContext>(
    () => ({
      inSet: (id) => (set ? (membershipRef.current[set.id] ?? []).includes(id) : false),
      inAnySet: (id) => setsByNodeRef.current.has(id),
      inLineage: (n) => n.id === lineageId || (n.parentId !== null && lineageIdsRef.current.has(n.parentId)),
    }),
    [set?.id, lineageId],
  );

  const feed = useFeedQuery(brand.id, query, admitCtx);
  const { items, byId, counts } = feed;
  const feedRef = useRef(feed);
  feedRef.current = feed;
  lineageIdsRef.current = useMemo(() => new Set(items.map((n) => n.id)), [items]);
  /** Every shot this screen has ever held or heard of, so a poll's stranger is told from an old friend. */
  const seen = useRef(new Set<string>());
  useEffect(() => {
    for (const n of items) seen.current.add(n.id);
  }, [items]);

  /** What assistive technology hears about generation (see liveStatus.ts). */
  const statusMap = useRef<Map<string, string> | null>(null);
  const [genLive, setGenLive] = useState('');

  /**
   * The bell's poll, and every change applied anywhere, folded into the pages.
   *
   * A record the pages hold changes in place. A record they do not hold is
   * either on a page not yet loaded (then it is not news) or brand new, made
   * on another screen; the pages cannot tell which by looking, so a stranger
   * re-reads the first page and the counts, once, which is bounded whatever
   * the size of the brand. This used to re-read every shot in the brand.
   */
  useEffect(
    () =>
      subscribeActivity((fresh) => {
        const { messages, next } = generationMessages(statusMap.current ?? new Map(), fresh);
        const firstDiff = statusMap.current === null;
        statusMap.current = next;
        if (!firstDiff && messages.length) setGenLive(messages.join(' '));
        const f = feedRef.current;
        let stranger = false;
        for (const n of fresh) {
          if (f.byId.has(n.id)) f.patch(n);
          else if (!seen.current.has(n.id) && n.kind !== 'root') stranger = true;
          seen.current.add(n.id);
        }
        if (stranger && f.ready) void f.refresh().catch(() => {});
      }),
    [subscribeActivity],
  );

  // the feed cannot say what it holds until the first page is in
  const loaded = frameLoaded && feed.ready;

  /** The root of the lineage being looked at, for the crumb: on a page, or one row from the server. */
  const lineageRoot = useResolvedNode(lineageId || null, byId);

  // a lineage whose shot is gone is not a lineage; drop it rather than show an
  // empty feed under a breadcrumb naming something that is not there
  useEffect(() => {
    if (!lineageId || !lineageRoot.missing) return;
    setLineageId(null);
    push({ kind: 'error', title: 'That shot is no longer available', detail: 'Showing everything instead.' });
  }, [lineageId, lineageRoot.missing, setLineageId, push]);

  /**
   * Brief tokens carry ids; searching wants the names behind them. Every
   * catalog needed is already on the client — the same lookups BriefInput
   * makes to label its chips.
   */
  const tokenNames = useMemo<TokenNames>(() => {
    const library: any[] = products.length ? products : ((brand.json?.products ?? []) as any[]);
    const cast: any[] = (brand.json?.characters ?? []) as any[];
    // The brand's own scenes are not in the catalog, so a shot built in one
    // would be unsearchable by its name without this.
    const ownScenes = catalog.scenes;
    return {
      // 'chip', not 'tooltip': these names get SPOKEN — briefProse inlines
      // them into the sentence and briefChanges into the change line — and
      // the tooltip form put "Cracked Clay · Raking low-angle golden-hour
      // light" in the middle of a sentence a person reads.
      product: (id) => {
        const p = library.find((x) => x.id === id) ?? demoProducts.find((x) => x.id === id);
        return p ? productLabel(p, 'chip') : null;
      },
      person: (id) => cast.find((x) => x.id === id)?.name ?? presenters.find((x) => x.id === id)?.name ?? null,
      scene: (id) => {
        const t = ownScenes.find((x) => x.id === id);
        return t ? sceneLabel(t, 'chip') : null;
      },
    };
  }, [products, demoProducts, brand, presenters, catalog.scenes]);

  /** The shot the keyboard acts on: the one clicked, else the newest usable one on screen. */
  const selected = useMemo(() => {
    const chosen = selectedId ? byId.get(selectedId) : undefined;
    if (chosen) return chosen;
    // never land on a failure: prefer the newest usable shot
    return items.find((n) => n.status !== 'error') ?? items[0] ?? null;
  }, [byId, items, selectedId]);

  /**
   * The branch target, resolved against what actually exists. A URL can name a
   * shot that has since failed, or one from a brand you are no longer in, so
   * the chip is derived rather than stored and cannot outlive its shot.
   */
  const branch = useResolvedNode(branchId || null, byId);
  const target = useMemo(() => {
    const n = branch.node;
    if (!n || n.kind === 'root') return null;
    // A shot still rendering counts. Refining moves the chip onto the
    // version it just made, and that version does not exist as a picture
    // for a few seconds — dropping the chip in the meantime would read as
    // the app forgetting what you were working on.
    return n.status === 'running' || (n.status === 'done' && n.images.length > 0) ? n : null;
  }, [branch.node]);

  /** The frame the dock will refine: a node holds exactly one image now. */
  const targetImage = target?.images[0] ?? null;

  /** Let go of the refine thread. */
  const clearTarget = useCallback(() => setBranchId(null), [setBranchId]);

  /**
   * Drop params, gathering everything asked for in one tick into one write.
   *
   * A functional `setParams` updater is handed the params react-router already
   * holds, not a queued value, so two calls around the same commit can both
   * start from the same string and the second silently discards the first. That
   * is the hazard `clearTarget` and `branchFrom` each avoid by writing both of
   * their halves at once; this is the same rule for writes that come from
   * different places. A composer spending its seeds is a child effect and
   * `?compose=` clearing itself is this screen's own, so the two land together:
   * measured on the dev server, where StrictMode runs both effects twice, the
   * compose write put `?scene=` straight back after the composer had taken it
   * out. The production build happens to order them harmlessly, which is worth
   * neither relying on nor leaving as the only thing standing between a spent
   * seed and the URL it was supposed to leave.
   */
  const pendingDrops = useRef<Set<string> | null>(null);
  const dropParams = useCallback(
    (...keys: string[]) => {
      if (pendingDrops.current) {
        for (const k of keys) pendingDrops.current.add(k);
        return;
      }
      const drops = new Set(keys);
      pendingDrops.current = drops;
      // after the commit, so everything this tick wanted gone is in `drops`
      queueMicrotask(() => {
        pendingDrops.current = null;
        setParams(
          (cur) => {
            const p = new URLSearchParams(cur);
            for (const k of drops) p.delete(k);
            return p;
          },
          { replace: true },
        );
      });
    },
    [setParams],
  );

  /**
   * The seeds have landed in the sentence, so they leave the URL. A seed left
   * behind is re-applied by the next mount, which is why removing a scene chip
   * and reloading used to hand the same chip straight back. `attach` stays: it
   * opens a panel rather than putting anything in the brief, and `onQueued`
   * clears it along with the rest once something is actually sent.
   */
  const spendSeeds = useCallback(() => dropParams('scene', 'presenter', 'product'), [dropParams]);

  // a target that has stopped being one is dropped, and said so: a chip that
  // silently stops meaning anything is worse than no chip. The server is asked
  // before the verdict, so a target on a page not yet loaded is never "gone".
  useEffect(() => {
    if (!branchId || !loaded) return;
    if (branch.node && !target) {
      clearTarget();
      push({ kind: 'error', title: 'That shot is no longer available to refine', detail: 'Making a new shot.' });
    } else if (branch.missing) {
      clearTarget();
      push({ kind: 'error', title: 'That shot is no longer available to refine', detail: 'Making a new shot.' });
    }
  }, [branchId, branch.node, branch.missing, target, loaded, clearTarget, push]);

  const branchFrom = useCallback(
    (id: string) => {
      setBranchId(id);
      composerRef.current?.focus();
    },
    [setBranchId],
  );

  const select = (id: string) => setSelectedId(id);
  /**
   * The overlay-context equivalent of `openShot`: the lineage filmstrip,
   * Prev/Next, the parent chip and arrow keys all move to a different shot
   * while already looking at one, so the URL has to move with them (replace,
   * so ten steps through a run don't become ten Back presses to leave it).
   * Arrow keys also walk the closed canvas grid, where there is no overlay
   * route to update; `select`'s plain local-state move still owns that case.
   */
  const goToShot = (id: string) => (nodeId ? openShot(id, true) : select(id));

  /**
   * Shots that did not exist a moment ago: a send, a refine, a retry. Seated
   * in the pages by the query's own rules, put on the recent shelf, and the
   * one poller asked to look again so their pictures land on the idle cadence
   * no longer. The stand-in is cleared by the caller once the tiles are in.
   */
  const landed = useCallback(
    (nodes: FeedNode[]) => {
      for (const n of nodes) seen.current.add(n.id);
      feedRef.current.insert(nodes);
      applyNodes(nodes);
      poke();
    },
    [applyNodes, poke],
  );

  /** The fallback when a change cannot be folded in: the frame and the first page, re-read. */
  const reload = useCallback(async () => {
    try {
      await refresh();
      await feedRef.current.refresh();
      setErr(null);
    } catch (e: any) {
      setErr(String(e.message ?? e));
    }
  }, [refresh]);

  // one implementation for every surface that can put a shot away or bring it
  // back — the feed tile, its context menu, the overlay toolbar, the Info tab
  const applyOne = useCallback((n: FeedNode) => applyNodes([n]), [applyNodes]);
  const { archive, unarchive, unarchiveBatch } = useArchiveNode(applyOne);
  // permanent — only ever reachable once a shot is already archived
  const dropIds = useCallback((ids: string[]) => feedRef.current.drop(ids), []);
  const { remove, removeBatch } = useDeleteNode(dropIds);

  // a cold load of /n/:nodeId has to select the node the URL names, once the
  // shots it belongs to actually arrive
  useEffect(() => {
    if (nodeId) setSelectedId(nodeId);
  }, [nodeId]);

  /**
   * Run this shot's own recipe again, as one new sibling.
   *
   * One card, one retry, one new shot — a card is a single image now, so
   * trying it again asks for exactly one more, whatever size the batch that
   * made it was.
   *
   * A rejection here is a spend cap or an engine that has gone away — both
   * worth reading. This used to be fired as `void retry(n)` and rejected in
   * silence, so the button simply appeared to do nothing.
   */
  const retry = async (node: FeedNode): Promise<string | null> => {
    try {
      // the whole record: a shot made before briefs existed runs again from its prompt
      const full = await api.node(node.id);
      const made = await api.addNode({
        projectId,
        parentId: node.parentId,
        kind: node.kind === 'edit' ? 'edit' : 'generation',
        prompt: full.prompt,
        engineId: node.engineId,
        count: 1,
        brief: node.brief,
        // a refinement runs again from the frame it came from; without this the
        // retake silently switched to its parent's image
        ...(node.kind === 'edit' && node.brief?.sourceImage ? { sourceImage: node.brief.sourceImage } : {}),
      });
      landed(made.siblings?.length ? made.siblings : [made]);
      return made?.id ?? null;
    } catch (e: any) {
      push(failureToast(e, 'Could not run this again'));
      return null;
    }
  };

  const cancel = async (node: FeedNode) => {
    try {
      await api.cancelNode(node.id);
      // the record settles on the run's own catch; the poll corrects this
      applyNodes([{ ...node, status: 'cancelled' }]);
      poke();
    } catch (e: any) {
      push(failureToast(e, 'Could not cancel this shot'));
    }
  };

  /** Focus the brief. What the Create button and the two create cards do now. */
  const compose = useCallback((opts?: { scene?: string; scenesPanel?: boolean }) => {
    if (opts?.scene) composerRef.current?.applyScene(opts.scene);
    if (opts?.scenesPanel) composerRef.current?.openAttach('Scenes');
    composerRef.current?.focus();
  }, []);

  // Create from the nav arrives as a param rather than a call, because the nav
  // is mounted above this screen and may be on another one when you press it
  useEffect(() => {
    if (params.get('compose') === null) return;
    compose();
    dropParams('compose');
  }, [params, compose, dropParams]);

  // A homepage gallery tile carries `?showcase=<id>` instead of the lighter
  // `?scene=`/`?presenter=`/`?product=` seeds: it's a full recipe, so it
  // replaces the brief wholesale through the same remixBrief channel manual
  // "Remix this brief" already uses, rather than appending chip by chip.
  // Known synchronously (see suppressDraftRestoreForShowcase below) so the
  // composer never starts a draft-restore it's about to overwrite anyway.
  const showcaseIdParam = params.get('showcase');
  const appliedShowcase = useRef<string | null>(null);
  useEffect(() => {
    if (!showcaseIdParam || !showcaseLoaded || appliedShowcase.current === showcaseIdParam) return;
    appliedShowcase.current = showcaseIdParam;
    const entry = showcase.find((s) => s.id === showcaseIdParam);
    if (entry) {
      setRemixBrief(showcaseBrief(entry));
      push({ kind: 'success', title: `Starting from "${entry.title}"` });
    } else {
      push({ kind: 'error', title: 'That example is no longer available', detail: 'Starting from scratch instead.' });
    }
    setParams(
      (cur) => {
        const p = new URLSearchParams(cur);
        p.delete('showcase');
        return p;
      },
      { replace: true },
    );
  }, [showcaseIdParam, showcaseLoaded, showcase, setParams, push]);

  /**
   * Marking a shot a keeper, one or many.
   *
   * The star flips at once and the server's answer replaces it; a refusal puts
   * the record back and says so. Every one of these used to re-read the whole
   * brand to light one star.
   */
  const keep = async (node: FeedNode, next = !node.kept) => {
    applyNodes([{ ...node, kept: next }]);
    try {
      applyNodes([await api.keep(node.id, next)]);
    } catch (e: any) {
      applyNodes([node]);
      push(failureToast(e, 'Could not update keeper status'));
    }
  };

  // allNodes, not shots: shots excludes archived nodes, but a selection can be
  // made from the Archived lens too — sourcing from the pages, whatever the
  // lens, is what makes Keep/Compare/batch-delete work for that selection
  const pickedNodes = useMemo(
    () => [...picked].map((id) => byId.get(id)).filter((n): n is FeedNode => !!n),
    [byId, picked],
  );

  /** One press sets them all; pressing again on an all-kept selection clears them. */
  const keepPicked = async () => {
    const next = !(pickedNodes.length > 0 && pickedNodes.every((n) => n.kept));
    const changing = pickedNodes.filter((n) => n.kept !== next);
    applyNodes(changing.map((n) => ({ ...n, kept: next })));
    try {
      applyNodes(await Promise.all(changing.map((n) => api.keep(n.id, next))));
    } catch (e: any) {
      applyNodes(changing);
      push(failureToast(e, 'Could not update keeper status'));
    }
  };

  /** A set's membership as the server just answered it: the frame and the place both learn of it. */
  const fileInto = useCallback(
    (setId: string, ids: string[]) => {
      membershipRef.current = { ...membershipRef.current, [setId]: ids };
      applyMembership(setId, ids);
    },
    [applyMembership],
  );

  const addPickedTo = async (target: ShotSet) => {
    try {
      const r = await api.addToSet(target.id, [...picked]);
      fileInto(target.id, r.nodeIds);
      setPicked(new Set());
      // a place defined by membership has just moved under the pages
      if (set || ungrouped) void feedRef.current.refresh();
    } catch (e: any) {
      push(failureToast(e, 'Could not add to the set'));
    }
  };

  const pendingMembers = useRef<string[]>([]);
  const [askCreate, setAskCreate] = useState(false);
  useEffect(() => {
    if (!askCreate) return;
    setAskCreate(false);
  }, [askCreate]);

  const newSetWith = async (nodeIds: string[], name: string) => {
    const clean = name.trim();
    if (!clean) return;
    try {
      const made = await api.createSet(brand.id, clean);
      insertSet(made);
      if (nodeIds.length > 0) {
        const r = await api.addToSet(made.id, nodeIds);
        fileInto(made.id, r.nodeIds);
      }
      setPicked(new Set());
      navigate(setPath(brand, made));
    } catch (e: any) {
      push(failureToast(e, 'Could not create the set'));
    }
  };

  const takePendingMembers = () => {
    const ids = pendingMembers.current;
    pendingMembers.current = [];
    return ids;
  };

  const renameActive = async (name: string) => {
    if (!set) return;
    const clean = name.trim();
    if (!clean || clean === set.name) return;
    try {
      const saved = await api.renameSet(set.id, clean);
      applySet(saved);
      navigate(setPath(brand, saved), { replace: true });
      void refresh();
    } catch (e: any) {
      push(failureToast(e, 'Could not rename the set'));
    }
  };

  const deleteActive = async () => {
    if (!set) return;
    try {
      await api.deleteSet(set.id);
      dropSet(set.id);
      navigate(hubPath(brand), { replace: true });
      void refresh();
    } catch (e: any) {
      push(failureToast(e, 'Could not delete the set'));
    }
  };

  /**
   * Compare answers a question about exactly two things, so it is offered for
   * exactly two and only when both have an image to compare. Three selected is
   * not a comparison, and a failed shot has nothing to put on the wall.
   */
  const comparable = useMemo(() => {
    if (pickedNodes.length !== 2) return null;
    const [a, b] = pickedNodes;
    if (a.status !== 'done' || b.status !== 'done' || !a.images[0] || !b.images[0]) return null;
    return [a, b] as const;
  }, [pickedNodes]);

  /**
   * Arrow keys walk the tree around the selected shot. The tree comes from the
   * server's parent index, one small answer per shot, rather than from a map
   * over every shot in the brand.
   */
  const walk = async (dir: 'left' | 'right' | 'up' | 'down') => {
    const at = selected;
    if (!at) return;
    if (dir === 'up') {
      if (at.parentId && at.parentId !== root) goToShot(at.parentId);
      return;
    }
    const lin = await api.lineage(at.id).catch(() => null);
    if (!lin) return;
    const sibs = lin.siblings.filter((n) => n.kind !== 'root');
    const i = sibs.findIndex((n) => n.id === at.id);
    if (dir === 'left' && i > 0) goToShot(sibs[i - 1].id);
    else if (dir === 'right' && i >= 0 && i < sibs.length - 1) goToShot(sibs[i + 1].id);
    else if (dir === 'down' && lin.children[0]) goToShot(lin.children[0].id);
  };

  // keyboard: arrows walk the tree, [ ] step images, esc closes the overlay,
  // enter opens the selected shot, k keeps it, . toggles the assets panel,
  // ? lists the lot. Shortcuts.tsx documents exactly what is bound here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A popover or dialog that already took the key (Radix marks its Escape
      // handled) must not also close the shot or walk the tree under it.
      if (e.defaultPrevented) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = (el?.tagName ?? '').toUpperCase();
      // the brief line is contenteditable, not an input: it needs the same
      // guard, and so does a focused splitter, whose arrow keys size a panel
      // rather than walk the tree
      const typing =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        !!el?.closest('[contenteditable="true"]') ||
        !!el?.closest('[role="separator"]');

      // cmd+enter runs the brief from anywhere, including mid-sentence
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        composerRef.current?.submit();
        e.preventDefault();
        return;
      }
      if (typing) return;
      if (e.key === '?') {
        setShortcutsOpen(true);
        e.preventDefault();
        return;
      }
      /**
       * Straight to the brief.
       *
       * It is the primary input of the product and it sat at Tab stop 79 from a
       * cold load: sixteen stops of chrome, then four per tile, then the whole
       * assets rail. A keyboard user could reach every thumbnail in the rail
       * before reaching the field the page exists for.
       */
      if (e.key === '/' && !nodeId) {
        composerRef.current?.focus();
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape' && shortcutsOpen) {
        setShortcutsOpen(false);
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape' && nodeId) {
        closeShot();
        e.preventDefault();
        return;
      }
      // a selection is the other thing escape can mean here
      if (e.key === 'Escape' && picked.size > 0) {
        setPicked(new Set());
        e.preventDefault();
        return;
      }
      // and with nothing else open, escape means "stop branching", which is the
      // only other piece of state on this screen you can be stuck in
      if (e.key === 'Escape' && branchId) {
        clearTarget();
        e.preventDefault();
        return;
      }
      if (!selected) return;
      if (e.key === 'b' && selected.kind !== 'root' && selected.status === 'done' && selected.images.length > 0) {
        branchFrom(selected.id);
        e.preventDefault();
        return;
      }
      if (e.key === 'k' && selected.kind !== 'root' && selected.status === 'done') {
        void keep(selected);
        e.preventDefault();
        return;
      }
      if (e.key === 'ArrowLeft') {
        void walk('left');
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        void walk('right');
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        void walk('up');
        e.preventDefault();
      } else if (e.key === 'ArrowDown') {
        void walk('down');
        e.preventDefault();
      } else if (e.key === 'Enter' && !nodeId && selected.kind !== 'root') openShot(selected.id);
      else if (e.key === '.' && !nodeId) toggleAssets();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, nodeId, shortcutsOpen, picked.size, branchId, branchFrom, setBranchId, root]);

  const togglePick = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  /**
   * Nothing to show is three different facts: the brand has never made
   * anything, a lens is hiding work that exists, or a set has no members yet.
   * One sentence for all three is what made an untouched hub read as broken.
   *
   * The brand being empty outranks the lens: "star a shot to make it a keeper"
   * is useless advice when there is no shot to star.
   */
  /** Never made anything here. Drives both the empty state and the bare chrome. */
  const firstRun = loaded && counts !== null && counts.total === 0;
  /**
   * First run has no feed toolbar — there is no feed to describe — so it also
   * has no rail switch. The rail stays open there regardless: it is the
   * surface that teaches what a shot is made of, and a first-time screen
   * should not be able to land with it shut because of a preference set while
   * looking at another brand.
   */
  const railOpen = assetsOpen || (firstRun && !phone);

  const emptyState = firstRun ? (
    <FirstRun
      entries={showcase}
      catalogs={{ demoProducts, presenters, scenes: templates }}
      stagedId={stagedId}
      productHref={(id) => productPath(brand, id)}
      presenterHref={(id) => presenterPath(brand, id)}
      sceneHref={(id) => scenePath(brand, id)}
      onUse={(e) => {
        setStagedId(e.id);
        setRemixBrief(showcaseBrief(e));
      }}
    />
  ) : q.trim() ? (
    // outranks the lens branches: a search that filtered a lens to nothing
    // must not read as "No keepers yet" when the keepers are merely hidden
    <LensEmpty text={`No shots match “${q.trim()}”.`} onAll={clearSearch} actionLabel="Clear search" />
  ) : lens === 'keepers' ? (
    <LensEmpty text="No keepers yet. Star a shot and it lands here." onAll={() => setLens(null)} />
  ) : lens === 'archived' ? (
    <LensEmpty text="Nothing archived." onAll={() => setLens(null)} />
  ) : set ? (
    <LensEmpty text="Nothing in this set yet. Pick shots on All, then add them here." />
  ) : ungrouped ? (
    <LensEmpty text="Every shot is already in a set." onAll={() => setPlace(null)} />
  ) : null;

  /** What the search field says it searches: the lens before the search narrowed it. */
  const unsearched = useRef(0);
  if (!q.trim() && counts) unsearched.current = counts[lens];
  const lensCounts = useMemo(
    () => ({ all: counts?.all ?? 0, keepers: counts?.keepers ?? 0, archived: counts?.archived ?? 0 }),
    [counts],
  );

  const shotContext: ShotContext = {
    byId,
    rootId: root,
    recent,
    loaded,
    // The sets a shot is filed in. It used to be a count on the tile, which is
    // a fact about the picture stated where there is no room to say which
    // sets. The overlay has the room, so it says the names.
    setsFor: (id: string) => setsByNode.get(id) ?? [],
    brand,
    engines,
    projectId,
    close: closeShot,
    select: goToShot,
    // Try again from inside a shot used to file the new take behind the
    // overlay: something was spent, the picture in front of you did not
    // change, and the only way to learn it had worked was to close and hunt
    // the feed. It walks to the take it just started instead, the way a
    // refinement does. The previous one is one Back away and still in the feed.
    retry: (n) => {
      void retry(n).then((id) => {
        if (id) goToShot(id);
      });
    },
    cancel: (n) => void cancel(n),
    keep: (n) => void keep(n),
    reload,
    remix: (n) => {
      setRemixBrief({ ...n.brief, _at: Date.now() });
      // durable against a reload landing between this click and the hub
      // Composer actually consuming the live prop above: the same persisted
      // per-brand draft record loadDraft() already restores from on mount
      if (n.brief) saveDraft(brand.id, { tokens: briefTokens(n.brief), tplFields: n.brief.templateFields ?? {} });
      closeShot();
    },
    // branching closes the overlay on purpose: the next thing you do is judge
    // the shot you are changing against everything else, and you cannot do
    // that from inside a takeover of it
    branch: (n) => {
      branchFrom(n.id);
      closeShot();
    },
    // leaving the overlay makes sense here: the shot just left whatever feed
    // it was being viewed from
    archive: (n) => void archive(n).then(() => closeShot()),
    unarchive: (n) => void unarchive(n),
    delete: (n) => void remove(n).then(() => closeShot()),
    landed,
    // whichever surface a refine was pulled from, the workspace follows the
    // same thread, so stepping back out continues the conversation instead of
    // turning the next instruction into a brand new shot
    refined: (id, kind) => {
      if (kind === 'edit') setBranchId(id);
    },
    subscribeActivity,
    tokenNames,
  };

  return (
    <div className="sc-work" data-assets={railOpen}>
      {/* Blank ground empties the batch: the pointer's version of the Escape
          that already does it, and of the Clear in the picked bar. Only on
          genuinely blank ground — the canvas itself, the feed, or a column with
          no tile under the cursor. A click that lands on a tile, a control or
          the toolbar has its own meaning and keeps it, because `e.target` is
          the thing clicked rather than the thing listening. Guarded on there
          being a batch at all, so an ordinary click on an empty canvas does
          nothing and costs nothing. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard path is Escape, bound on the document above, so a key handler here would be a second route to the same clear rather than a missing one */}
      <main
        className="sc-canvas"
        id="main"
        data-firstrun={firstRun || undefined}
        onClick={(e) => {
          if (picked.size === 0 && !selectedId) return;
          const t = e.target as HTMLElement;
          // Asked the other way round: not "did this land on one of the three
          // elements I can name" but "did it land on anything that has a
          // meaning of its own". Naming the blank elements meant the rule only
          // held where the layout happened to put them, and missed the gaps in
          // the toolbar strip, which to anyone using this is also outside.
          if (t.closest('.sc-cell')) return;
          if (t.closest('button, a, input, select, textarea, label, [role], [contenteditable]')) return;
          setPicked(new Set());
          setSelectedId(null);
        }}
      >
        {/* Generation state for assistive technology. Completion is
            deliberately toast-silent for sighted users — the tile appearing
            IS the signal — so without this a shot could start, land or fail
            with no announcement at all. Transitions only, never the load. */}
        <span className="sc-vh" role="status" aria-live="polite">
          {genLive}
        </span>
        {/* Was a bare Radix callout printing whatever the server threw. Same
            reading as every other failure in the app now, so the page does not
            change vocabulary depending on where the error came from. */}
        {(err || feed.error) && (
          <div className="sc-canvas-alert">
            <FailureRow failure={describeFailure(err ?? feed.error ?? '')} />
          </div>
        )}

        {/* The app-wide rule: a page with nothing in it carries no chrome.
            Places, lenses, search and view all describe a feed, and there is
            no feed yet, so every one of them would be a control over nothing.
            A set is a place you can be, so its name stays up even when the
            brand has never made a shot. */}
        {(!firstRun || set) && (
          <FeedToolbar
            sets={sets}
            active={set}
            ungrouped={ungrouped}
            ungroupedCount={counts?.ungrouped ?? 0}
            onPlaceAll={() => (set ? navigate(hubPath(brand)) : setPlace(null))}
            onPlaceUngrouped={() => (set ? navigate(`${hubPath(brand)}?in=ungrouped`) : setPlace('ungrouped'))}
            onOpenSet={(s) => navigate(setPath(brand, s))}
            onNewSet={(name) => void newSetWith(takePendingMembers(), name)}
            onResetNewSet={() => {
              pendingMembers.current = [];
            }}
            onRenameSet={(name) => void renameActive(name)}
            onDeleteSet={() => void deleteActive()}
            askCreate={askCreate}
            lens={lens}
            lensCounts={lensCounts}
            onLens={(l) => setLens(l === 'all' ? null : l)}
            q={q}
            onQ={setQ}
            searchTotal={q.trim() ? unsearched.current : (counts?.[lens] ?? 0)}
            sort={sort}
            onSort={setSortPref}
            tile={tile}
            onTile={setTile}
            assets={assetsOpen}
            onAssets={toggleAssets}
            showAssets={!phone}
          />
        )}

        {lineageId && lineageRoot.node && (
          <div className="sc-lineage-bar">
            <button type="button" className="sc-crumb-back" onClick={() => setLineageId(null)}>
              All shots
            </button>
            <span className="sc-crumb-sep">›</span>
            <b dir="auto">{nodeLabel(lineageRoot.node)}</b>
            <span className="sc-crumb-sep">›</span>
            <span className="sc-crumb-here">versions</span>
          </div>
        )}

        {/* `selectedId` raw, never `selected`. That memo falls back to the
            newest usable shot so the keyboard shortcuts always have something
            to act on with nothing clicked, which is right for `b` and `k` and
            wrong for a ring: it drew a permanent border on whichever tile
            happened to be newest, on a feed nobody had touched, and nothing
            could clear it because there was nothing to clear. A ring is for a
            shot someone chose. */}
        <Canvas
          nodes={items}
          selectedId={selectedId}
          onOpen={openShot}
          shotHref={shotHref}
          onRetry={(n) => void retry(n)}
          onCancel={(n) => void cancel(n)}
          onToggleKeep={(n) => void keep(n)}
          // Canvas shows one button/menu item whose label already flips on
          // n.archived (Archive vs Restore) — this is the toggle its single
          // onClick needs to actually do the right one of the two
          onArchive={(n) => (n.archived ? unarchive(n) : archive(n))}
          onDeletePermanently={remove}
          // Only a failed tile reads this, so it can say which engine refused
          // rather than "the engine". The ids live here; the names do not.
          engineName={(id) => engines.find((e) => e.id === id)?.displayName}
          picked={picked}
          onPick={togglePick}
          sending={sending}
          onBranch={branchFrom}
          branchingFrom={target?.id ?? null}
          onVersions={setLineageId}
          tile={tile}
          empty={loaded ? emptyState : null}
          pending={!loaded}
          onNearEnd={feed.complete ? undefined : feed.loadMore}
        />
      </main>

      {comparable && (
        <CompareDialog
          open={compareOpen}
          onOpenChange={setCompareOpen}
          a={comparable[0]}
          b={comparable[1]}
          imageA={comparable[0].images[0]}
          imageB={comparable[1].images[0]}
        />
      )}

      {railOpen && <div className="sc-assets-backdrop" onClick={() => setAssetsOpen(false)} aria-hidden />}
      <Shortcuts open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      {/* Not mounted at all on a phone: an off-screen drawer that can never be
          opened is still a tab stop and still fetches its thumbnails. */}
      {!phone && (
        <AssetsPanel
          brand={brand}
          shots={recent}
          attached={attached}
          full={ceiling}
          onToken={(t) => composerRef.current?.insertToken(t)}
          offToken={(t) => composerRef.current?.removeToken(t)}
          onTemplate={(id) => composerRef.current?.applyScene(id)}
          offTemplate={() => composerRef.current?.removeTemplate()}
          onClose={() => setAssetsOpen(false)}
        />
      )}

      <ComposerDock full={!railOpen}>
        {/* Inside the dock, not floating above it at a guessed offset: the
            composer grows with a banner, a target chip or an open attach panel,
            and any fixed distance from the bottom was a bet that it would not.
            It sat under the composer and its buttons could not be clicked. */}
        {picked.size > 0 && (
          <PickedBar
            count={picked.size}
            sets={sets}
            onAdd={(s) => void addPickedTo(s)}
            onNew={() => {
              pendingMembers.current = [...picked];
              setAskCreate(true);
            }}
            onClear={() => setPicked(new Set())}
            onKeep={() => void keepPicked()}
            allKept={pickedNodes.length > 0 && pickedNodes.every((n) => n.kept)}
            comparable={comparable}
            onCompare={() => setCompareOpen(true)}
            // Keep/Compare/Add-to-set are curation actions for active work —
            // an archived selection only makes sense as "bring it back" or
            // "get rid of it for good," so the whole bar swaps to that pair.
            archivedLens={lens === 'archived'}
            pickedIds={[...picked]}
            onRestoreBatch={(ids) => void unarchiveBatch(ids).then(() => setPicked(new Set()))}
            onDeleteBatch={(ids) => void removeBatch(ids).then(() => setPicked(new Set()))}
          />
        )}
        <Composer
          ref={composerRef}
          projectId={projectId || null}
          brand={brand}
          engines={engines}
          parentId={root}
          shots={recent}
          initialBrief={remixBrief}
          suppressDraftRestore={showcaseIdParam !== null}
          startScene={params.get('scene') ?? undefined}
          startPresenter={params.get('presenter') ?? undefined}
          startProduct={params.get('product') ?? undefined}
          onSeedsSpent={spendSeeds}
          openAttachTab={
            params.get('attach') === 'scenes' ? 'Scenes' : params.get('attach') === 'products' ? 'Products' : undefined
          }
          target={target}
          onClearTarget={clearTarget}
          onRestoreBranchId={setBranchId}
          setSlug={set?.slug ?? null}
          onSending={setSending}
          onAttached={setAttached}
          onCeiling={setCeiling}
          sourceImage={targetImage ?? undefined}
          onQueued={(made, kind, siblings, records) => {
            setRemixBrief(null);
            /**
             * One write, because both halves live in the query string: a
             * separate setBranchId here was handed the same stale params this
             * updater starts from, and whichever ran second won.
             *
             * The seeds have been spent — a presenter or product left in the
             * URL was re-applied by the next remount, so going back and
             * forward quietly re-attached what had just been sent.
             *
             * And a refine moves onto what it just made: the chip used to stay
             * on the shot it started from, so "make it tighter" and then "now
             * warmer" both ran against the original and the second instruction
             * threw away the first. The X on the chip is still how you leave
             * the thread and start something new.
             */
            setParams(
              (cur) => {
                const p = new URLSearchParams(cur);
                p.delete('scene');
                p.delete('attach');
                p.delete('presenter');
                p.delete('product');
                return p;
              },
              { replace: true },
            );
            // The stand-in tile is cleared only once the real shots are in
            // hand. Clearing on response instead left a beat with neither,
            // which read as the brief having been swallowed.
            const standInGone = () => setSending(null);
            /**
             * Point at the new version only once it is actually in hand.
             *
             * Naming it any earlier hands the chip an id this screen has never
             * heard of: the target resolves against the nodes already loaded,
             * finds nothing, and the effect that guards against dead targets
             * drops it and says so. In a session that read as the refine thread
             * collapsing after one step — the next instruction quietly became a
             * brand new shot instead of continuing the one on screen.
             */
            const thenPointAtIt = () => {
              if (kind !== 'edit' || !made) return;
              setParams(
                (cur) => {
                  const p = new URLSearchParams(cur);
                  p.set('branch', made);
                  return p;
                },
                { replace: true },
              );
            };
            const seat = () => {
              landed(records ?? []);
              thenPointAtIt();
              standInGone();
            };
            // every sibling of a batch sent from a set page belongs to the set,
            // not only the first: the set used to show one of four. Filed
            // before seating, so the place admits them the moment they land.
            if (set && made)
              void api
                .addToSet(set.id, siblings?.length ? siblings : [made])
                .then((r) => fileInto(set.id, r.nodeIds))
                .catch((e: any) => push(failureToast(e, 'Could not add to the set')))
                .finally(seat);
            else seat();
          }}
        />
      </ComposerDock>

      <Outlet context={shotContext} />
    </div>
  );
}
