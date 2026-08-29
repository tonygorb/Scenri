import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useNavigate, useSearchParams } from 'react-router';
import { api, hasNoShots, nodeLabel, type ShotSet, type TreeNode } from '../api.js';
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
import {
  applyLens,
  byNewest,
  countLenses,
  filterFeed,
  isFeedSort,
  isLens,
  shotSearchText,
  sortFeed,
  type FeedSort,
  type Lens,
  type TokenNames,
} from '../feedRules.js';
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
import { useNodeId } from './create/useNodeId.js';

/** The lenses that are not places. A set is a place and lives in the path. */

/**
 * The hub: everything this brand has made, and the brief that makes more.
 *
 * This is where the assets rail, the lens row and the selection live, because
 * this is the only screen that is a tool. Home is the way in and carries none
 * of it.
 *
 * The feed is the whole brand. A project used to be the container work happened
 * inside, which meant one had to exist before anything could be shown — so five
 * buttons quietly made one each. A set is a filter over the feed instead, and
 * `set` of null is not an empty state but the ordinary one.
 */
export function CreateView({ set }: { set: ShotSet | null }) {
  const { engines, scenes: templates, presenters, demoProducts, showcase, showcaseLoaded } = useAppData();
  const {
    brand,
    workspace,
    nodes: allNodes,
    sets,
    membership,
    loaded,
    refresh,
    applySet,
    dropSet,
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
   * Which image of the target a refinement should work from. A run holds
   * several and they are the whole reason to shoot more than one, so aiming at
   * a take has to survive the same reload the target itself does.
   */
  const [branchImage, _setBranchImage] = useFilterParam('bi', '');
  /**
   * Looking at one shot and everything that came from it. A lens rather than a
   * place, so it rides in the query string next to the others: it is a way of
   * looking at the hub, not somewhere you can be.
   */
  const [lineageId, setLineageId] = useFilterParam('lineage', '');
  /** Runs opened out into their variants. Not in the URL: it is a glance. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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
  const [iParam, setIParam] = useFilterParam('i', '0');
  const imageIndex = Number.parseInt(iParam, 10) || 0;
  const _saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const { push } = useToasts();
  const { tasks, poke } = useTaskCenter();
  /** The brief that has been sent and not yet come back as a shot. */
  const [sending, setSending] = useState<string | null>(null);

  const projectId = workspace?.id ?? '';
  const base = set ? setPath(brand, set) : hubPath(brand);
  /**
   * Opening a shot used to navigate to a bare path, which threw away the whole
   * query string: the lens you were looking through, and now the shot you had
   * asked to branch from, both vanished the moment you opened anything. The
   * variant index is the one part of it this owns.
   */
  const shotHref = useCallback(
    (id: string, i = 0) => {
      const p = new URLSearchParams(params);
      if (i > 0) p.set('i', String(i));
      else p.delete('i');
      const q = p.toString();
      return `${base}/shots/${id}${q ? `?${q}` : ''}`;
    },
    [base, params],
  );
  // Built on shotHref so the tile's real href and the programmatic open can
  // never disagree about what URL a shot lives at.
  const openShot = useCallback(
    (id: string, i = 0, replace = false) => navigate(shotHref(id, i), { replace }),
    [navigate, shotHref],
  );
  const closeShot = useCallback(() => {
    const p = new URLSearchParams(params);
    // the variant and the inspector tab were about the shot that is closing;
    // the rest is about the view. Leaving ?panel= behind meant a reloaded or
    // shared link carried overlay state that no longer applied to anything.
    p.delete('i');
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

  // announcing a finish is TaskCenter's job: it is mounted above the router and
  // so can still speak once you have walked away
  const reload = useCallback(async () => {
    try {
      await refresh();
      setErr(null);
    } catch (e: any) {
      setErr(String(e.message ?? e));
    }
  }, [refresh]);

  // one implementation for every surface that can put a shot away or bring it
  // back — the feed tile, its context menu, the overlay toolbar, the Info tab
  const { archive, unarchive, unarchiveBatch } = useArchiveNode(reload);
  // permanent — only ever reachable once a shot is already archived
  const { remove, removeBatch } = useDeleteNode(reload);

  // a cold load of /n/:nodeId has to select the node the URL names, once the
  // shots it belongs to actually arrive
  useEffect(() => {
    if (nodeId) setSelectedId(nodeId);
  }, [nodeId]);

  /**
   * The bell is the only thing that polls.
   *
   * TaskCenter already asks the server what is running, every 1.5s while work
   * is in flight and every 5s when it is not, and it already stops for a hidden
   * tab. This screen used to run a second interval at the same cadence asking
   * an overlapping question, so a single generation was watched twice over.
   *
   * Instead it reads the answer the bell already has: whenever a shot changes
   * state, refetch the workspace once. Catalog imports are filtered out because
   * they never touch the feed.
   */
  const shotActivity = useMemo(
    () =>
      tasks
        .filter((t) => t.kind !== 'catalog')
        .map((t) => `${t.id}:${t.state}`)
        .sort()
        .join('|'),
    [tasks],
  );
  const lastActivity = useRef<string | null>(null);
  useEffect(() => {
    // the first reading is the baseline BrandLayout has already loaded against
    if (lastActivity.current === null) {
      lastActivity.current = shotActivity;
      return;
    }
    if (lastActivity.current === shotActivity) return;
    lastActivity.current = shotActivity;
    void reload();
  }, [shotActivity, reload]);

  /** Every non-archived shot in the brand, newest first — the feed before any
   * other lens. Archived shots are put away on purpose: they stay out of
   * lineage walks and version counts here, reachable only via the Archived
   * lens itself or a direct link (DetailOverlay reads from `allNodes`, not
   * this). */
  const shots = useMemo(() => [...allNodes].filter((n) => n.kind !== 'root' && !n.archived).sort(byNewest), [allNodes]);

  /** What assistive technology hears about generation (see liveStatus.ts). */
  const statusMap = useRef<Map<string, string> | null>(null);
  const [genLive, setGenLive] = useState('');
  useEffect(() => {
    const { messages, next } = generationMessages(statusMap.current ?? new Map(), allNodes);
    const firstDiff = statusMap.current === null;
    statusMap.current = next;
    if (!firstDiff && messages.length) setGenLive(messages.join(' '));
  }, [allNodes]);

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

  /** Children by parent, for the versions pip and for walking a lineage. */
  const childrenOf = useMemo(() => {
    const m = new Map<string, TreeNode[]>();
    for (const n of shots) {
      if (!n.parentId) continue;
      if (!m.has(n.parentId)) m.set(n.parentId, []);
      m.get(n.parentId)!.push(n);
    }
    return m;
  }, [shots]);

  /**
   * A shot and everything descended from it. Walked rather than filtered on
   * parentId alone, so an edit of an edit is still part of the lineage it
   * belongs to rather than disappearing one level down.
   */
  const lineage = useMemo(() => {
    if (!lineageId) return null;
    const root = shots.find((n) => n.id === lineageId);
    if (!root) return null;
    const ids = new Set<string>([root.id]);
    const queue = [root.id];
    while (queue.length) {
      for (const kid of childrenOf.get(queue.pop()!) ?? []) {
        if (ids.has(kid.id)) continue;
        ids.add(kid.id);
        queue.push(kid.id);
      }
    }
    return { root, ids };
  }, [lineageId, shots, childrenOf]);

  // a lineage whose shot is gone is not a lineage; drop it rather than show an
  // empty feed under a breadcrumb naming something that is not there
  useEffect(() => {
    if (!lineageId || !loaded || lineage) return;
    setLineageId(null);
    push({ kind: 'error', title: 'That shot is no longer available', detail: 'Showing everything instead.' });
  }, [lineageId, loaded, lineage, setLineageId, push]);

  /**
   * The place, in two halves.
   *
   * Archived shots are held out of `shots` everywhere else in the app, so
   * "archived, inside this set" cannot be a flag to filter on — it is a
   * second array scoped the same way. Both halves are scoped before any lens
   * touches them, which is what lets a lens compose with a set instead of
   * cancelling it.
   */
  const archivedShots = useMemo(
    () => [...allNodes].filter((n) => n.kind !== 'root' && n.archived).sort(byNewest),
    [allNodes],
  );
  const scope = useMemo(() => {
    const inScope = (list: TreeNode[]) => {
      if (lineage) return list.filter((n) => lineage.ids.has(n.id));
      if (set) {
        const inSet = new Set(membership[set.id] ?? []);
        return list.filter((n) => inSet.has(n.id));
      }
      if (ungrouped) return list.filter((n) => !setsByNode.has(n.id));
      return list;
    };
    return { live: inScope(shots), archived: inScope(archivedShots) };
  }, [shots, archivedShots, set, membership, setsByNode, lineage, ungrouped]);

  const shown = useMemo(() => applyLens(scope.live, scope.archived, lens), [scope, lens]);

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

  /** Haystack per shot, cached by id: prompt and brief never change once made. */
  const searchTextFor = useMemo(() => {
    const cache = new Map<string, string>();
    return (n: TreeNode) => {
      const hit = cache.get(n.id);
      if (hit !== undefined) return hit;
      const text = shotSearchText(n, tokenNames, engines.find((e) => e.id === n.engineId)?.displayName);
      cache.set(n.id, text);
      return text;
    };
  }, [tokenNames, engines]);

  /** What each tab would show from here — this place, this search. */
  const lensCounts = useMemo(
    () => countLenses(scope.live, scope.archived, q, searchTextFor),
    [scope, q, searchTextFor],
  );
  const ungroupedCount = useMemo(
    () => shots.reduce((n, s) => n + (setsByNode.has(s.id) ? 0 : 1), 0),
    [shots, setsByNode],
  );

  /** What the canvas actually renders: the lensed feed, searched, then ordered. */
  const feed = useMemo(() => sortFeed(filterFeed(shown, q, searchTextFor), sort), [shown, q, searchTextFor, sort]);

  const byParent = useMemo(() => {
    const m = new Map<string | null, TreeNode[]>();
    for (const n of allNodes) {
      if (!m.has(n.parentId)) m.set(n.parentId, []);
      m.get(n.parentId)!.push(n);
    }
    return m;
  }, [allNodes]);
  const root = allNodes.find((n) => n.kind === 'root') ?? null;

  const selected = useMemo(() => {
    const byId = allNodes.find((n) => n.id === selectedId);
    if (byId) return byId;
    // never land on a failure: prefer the newest usable shot
    const usable = feed.filter((n) => n.status !== 'error');
    return usable[0] ?? feed[0] ?? root;
  }, [allNodes, selectedId, feed, root]);

  /**
   * The branch target, resolved against what actually exists. A URL can name a
   * shot that has since failed, or one from a brand you are no longer in, so
   * the chip is derived rather than stored and cannot outlive its shot.
   */
  const target = useMemo(
    () =>
      allNodes.find(
        (n) =>
          n.id === branchId &&
          n.kind !== 'root' &&
          // A shot still rendering counts. Refining moves the chip onto the
          // version it just made, and that version does not exist as a picture
          // for a few seconds — dropping the chip in the meantime would read as
          // the app forgetting what you were working on.
          (n.status === 'running' || (n.status === 'done' && n.images.length > 0)),
      ) ?? null,
    [allNodes, branchId],
  );

  /** The frame of the target the dock will refine, named by ?bi=. */
  const targetImage = target?.images[Number.parseInt(branchImage, 10) || 0] ?? target?.images[0] ?? null;

  /**
   * Let go of the refine thread: the shot AND the take chosen within it, in one
   * write. Separately these were two param setters in a tick, which discard
   * each other's work — so dropping the thread could leave half of it behind.
   */
  const clearTarget = useCallback(() => {
    setParams(
      (cur) => {
        const p = new URLSearchParams(cur);
        p.delete('branch');
        p.delete('bi');
        return p;
      },
      { replace: true },
    );
  }, [setParams]);

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
  // silently stops meaning anything is worse than no chip
  useEffect(() => {
    if (!branchId || target || !loaded) return;
    clearTarget();
    push({ kind: 'error', title: 'That shot is no longer available to refine', detail: 'Making a new shot.' });
  }, [branchId, target, loaded, clearTarget, push]);

  const branchFrom = useCallback(
    (id: string, imageIndex = 0) => {
      // One write for both halves. Two useFilterParam setters in the same tick
      // are each handed the same params to start from, so the second silently
      // discards the first — here that wiped the target the moment a take was
      // aimed at, and the brief quietly went back to making a new shot.
      setParams(
        (cur) => {
          const p = new URLSearchParams(cur);
          p.set('branch', id);
          if (imageIndex > 0) p.set('bi', String(imageIndex));
          else p.delete('bi');
          return p;
        },
        { replace: true },
      );
      composerRef.current?.focus();
    },
    [setParams],
  );

  /** Picking a different shot starts it at its first image, not the last one's. */
  const select = (id: string) => {
    setSelectedId(id);
    setIParam(null);
  };
  /**
   * The overlay-context equivalent of `openShot`: the lineage filmstrip,
   * Prev/Next, the parent chip and arrow keys all move to a different shot
   * while already looking at one, so the URL has to move with them (replace,
   * so ten steps through a run don't become ten Back presses to leave it).
   * Arrow keys also walk the closed canvas grid, where there is no overlay
   * route to update; `select`'s plain local-state move still owns that case.
   */
  const goToShot = (id: string) => (nodeId ? openShot(id, 0, true) : select(id));
  const setImageIndex = (i: number) => setIParam(i === 0 ? null : String(i));

  /**
   * Run a shot's own recipe again, as a sibling of the one that failed.
   *
   * The count comes off the stored brief rather than off the images, because
   * the only shots this was ever offered on had none: every retry of a
   * four-variant run used to come back with a single frame. Shots made before
   * briefs existed keep the old guess, which is all there is to go on.
   *
   * A rejection here is a spend cap or an engine that has gone away — both
   * worth reading. This used to be fired as `void retry(n)` and rejected in
   * silence, so the button simply appeared to do nothing.
   */
  const retry = async (node: TreeNode): Promise<string | null> => {
    try {
      const made = await api.addNode({
        projectId,
        parentId: node.parentId,
        kind: node.kind === 'edit' ? 'edit' : 'generation',
        prompt: node.prompt,
        engineId: node.engineId,
        count: node.brief?.variants ?? Math.max(1, node.images.length || 1),
        brief: node.brief,
        // a refinement runs again from the frame it came from; without this the
        // retake silently switched to the run's first image
        ...(node.kind === 'edit' && node.brief?.sourceImage ? { sourceImage: node.brief.sourceImage } : {}),
      });
      await reload();
      return made?.id ?? null;
    } catch (e: any) {
      push(failureToast(e, 'Could not run this again'));
      return null;
    }
  };

  const cancel = async (node: TreeNode) => {
    try {
      await api.cancelNode(node.id);
      await reload();
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

  // keyboard: arrows walk the tree, [ ] step images, esc closes the overlay,
  // enter opens the selected shot, k keeps it, . toggles the assets panel,
  // ? lists the lot. Shortcuts.tsx documents exactly what is bound here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const tag = (el?.tagName ?? '').toUpperCase();
      // the brief line is contenteditable, not an input: it needs the same guard
      const typing =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el?.closest('[contenteditable="true"]');

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
      const sibs = (byParent.get(selected.parentId) ?? []).filter((n) => n.kind !== 'root');
      const i = sibs.findIndex((n) => n.id === selected.id);
      if (e.key === 'ArrowLeft' && i > 0) {
        goToShot(sibs[i - 1].id);
        e.preventDefault();
      } else if (e.key === 'ArrowRight' && i >= 0 && i < sibs.length - 1) {
        goToShot(sibs[i + 1].id);
        e.preventDefault();
      } else if (e.key === 'ArrowUp' && selected.parentId) {
        goToShot(selected.parentId);
        e.preventDefault();
      } else if (e.key === 'ArrowDown') {
        const kids = byParent.get(selected.id) ?? [];
        if (kids.length) {
          goToShot(kids[0].id);
          e.preventDefault();
        }
      } else if (e.key === '[' && imageIndex > 0) setImageIndex(imageIndex - 1);
      else if (e.key === ']' && selected.images.length - 1 > imageIndex) setImageIndex(imageIndex + 1);
      else if (e.key === 'Enter' && !nodeId && selected.kind !== 'root') openShot(selected.id);
      else if (e.key === '.' && !nodeId) toggleAssets();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, byParent, imageIndex, nodeId, shortcutsOpen, picked.size, branchId, branchFrom, setBranchId]);

  const togglePick = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  // allNodes, not shots: shots excludes archived nodes, but a selection can be
  // made from the Archived lens too — sourcing from the un-filtered tree is
  // what makes Keep/Compare/batch-delete work for that selection at all
  const pickedNodes = useMemo(() => allNodes.filter((n) => picked.has(n.id)), [allNodes, picked]);

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
   * Marking a shot a keeper, one or many.
   *
   * Every one of these used to be fired into the void, so a request that came
   * back a failure left the star simply not changing, with nothing said.
   */
  const keep = async (node: TreeNode, next = !node.kept) => {
    try {
      await api.keep(node.id, next);
      await reload();
    } catch (e: any) {
      push(failureToast(e, 'Could not update keeper status'));
    }
  };

  /** One press sets them all; pressing again on an all-kept selection clears them. */
  const keepPicked = async () => {
    const next = !(pickedNodes.length > 0 && pickedNodes.every((n) => n.kept));
    try {
      await Promise.all(pickedNodes.filter((n) => n.kept !== next).map((n) => api.keep(n.id, next)));
      await reload();
    } catch (e: any) {
      push(failureToast(e, 'Could not update keeper status'));
    }
  };

  const addPickedTo = async (target: ShotSet) => {
    try {
      await api.addToSet(target.id, [...picked]);
      setPicked(new Set());
      await reload();
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
      if (nodeIds.length > 0) await api.addToSet(made.id, nodeIds);
      setPicked(new Set());
      await reload();
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
   * Nothing to show is three different facts: the brand has never made
   * anything, a lens is hiding work that exists, or a set has no members yet.
   * One sentence for all three is what made an untouched hub read as broken.
   *
   * The brand being empty outranks the lens: "star a shot to make it a keeper"
   * is useless advice when there is no shot to star.
   */
  /** Never made anything here. Drives both the empty state and the bare chrome. */
  const firstRun = hasNoShots(allNodes);
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

  const shotContext: ShotContext = {
    nodes: allNodes,
    loaded,
    // The sets a shot is filed in. It used to be a count on the tile, which is
    // a fact about the picture stated where there is no room to say which
    // sets. The overlay has the room, so it says the names.
    setsFor: (id: string) => setsByNode.get(id) ?? [],
    brand,
    engines,
    projectId,
    imageIndex,
    setImageIndex,
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
    reload: () => reload(),
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
    // whichever surface a refine was pulled from, the workspace follows the
    // same thread, so stepping back out continues the conversation instead of
    // turning the next instruction into a brand new shot
    refined: (id, kind) => {
      if (kind === 'edit') setBranchId(id);
    },
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
        {err && (
          <div className="sc-canvas-alert">
            <FailureRow failure={describeFailure(err)} />
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
            ungroupedCount={ungroupedCount}
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
            searchTotal={shown.length}
            sort={sort}
            onSort={setSortPref}
            tile={tile}
            onTile={setTile}
            assets={assetsOpen}
            onAssets={toggleAssets}
            showAssets={!phone}
          />
        )}

        {lineage && (
          <div className="sc-lineage-bar">
            <button type="button" className="sc-crumb-back" onClick={() => setLineageId(null)}>
              All shots
            </button>
            <span className="sc-crumb-sep">›</span>
            <b dir="auto">{nodeLabel(lineage.root)}</b>
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
          nodes={feed}
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
          branchingFromImage={targetImage}
          expanded={expanded}
          onToggleExpand={(id) =>
            setExpanded((cur) => {
              const next = new Set(cur);
              if (!next.delete(id)) next.add(id);
              return next;
            })
          }
          versionsOf={(id) => childrenOf.get(id)?.length ?? 0}
          onVersions={setLineageId}
          tile={tile}
          empty={emptyState}
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
          shots={allNodes}
          attached={attached}
          onProduct={(id) => composerRef.current?.insertToken({ t: 'product', id })}
          onCharacter={(id) => composerRef.current?.insertToken({ t: 'character', id })}
          onColor={(hex, name) => composerRef.current?.insertToken({ t: 'color', hex, name })}
          onRef={(imageHash) => composerRef.current?.insertToken({ t: 'ref', imageHash })}
          onTemplate={(id) => composerRef.current?.applyScene(id)}
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
          parent={root}
          shots={allNodes}
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
          sourceImage={targetImage ?? undefined}
          onQueued={(made, kind) => {
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
            // the server is busy as of now, so ask the one poller to look again
            // rather than let a fresh shot wait out the idle cadence
            poke();
            // The stand-in tile is cleared only once the real shot is in hand.
            // Clearing on response instead left a beat with neither, which read
            // as the brief having been swallowed.
            const landed = () => setSending(null);
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
              // one write, for the same reason branchFrom uses one: two param
              // setters in a tick discard each other's work. A refinement comes
              // back as a single image, so any take chosen on the shot before
              // it no longer names anything.
              setParams(
                (cur) => {
                  const p = new URLSearchParams(cur);
                  p.set('branch', made);
                  p.delete('bi');
                  return p;
                },
                { replace: true },
              );
            };
            if (set && made) void api.addToSet(set.id, [made]).then(reload).then(thenPointAtIt).finally(landed);
            else void reload().then(thenPointAtIt).finally(landed);
          }}
        />
      </ComposerDock>

      <Outlet context={shotContext} />
    </div>
  );
}

/**
 * The brand has never made anything. The only empty state that has to teach,
 * so it is the only one that offers a way to start rather than a way back.
 *
 * A scene is the shortest route to a first shot worth keeping, which is why the
 * row is here and not a second sentence: the brief accepts prose, but prose is
 * the harder opening move for someone who has never used this.
 */
