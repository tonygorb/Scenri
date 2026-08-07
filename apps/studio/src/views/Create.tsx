import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useMatch, useNavigate, useSearchParams } from 'react-router';
import { Callout, DropdownMenu } from '@radix-ui/themes';
import { ArrowUpRight, CaretDown, FolderSimple, Plus, SquaresFour } from '@phosphor-icons/react';
import {
  api,
  hasNoShots,
  nodeLabel,
  saveOverlaysOnUnload,
  type Brand,
  type EngineInfo,
  type Look,
  type ShotSet,
  type TextLayer,
  type TreeNode,
} from '../api.js';
import { useAppData, useFilterParam } from '../app/AppShell.js';
import { useAssetsPanel, useBrand } from '../app/BrandLayout.js';
import { useTaskCenter } from '../app/TaskCenter.js';
import { P, hubPath, setPath } from '../routes.js';
import { briefTokens } from '../composer/BriefInput.js';
import { Confirm } from '../Confirm.js';
import { saveDraft } from '../draft.js';
import { favoriteLooks } from '../favorites.js';
import { PREF, useLocalPref } from '../prefs.js';
import { useToasts } from '../toasts.js';
import { Shortcuts } from '../layout/Shortcuts.js';
import { Canvas } from '../layout/Canvas.js';
import { CompareDialog } from '../layout/CompareDialog.js';
import { AssetsPanel } from '../layout/AssetsPanel.js';
import { Composer, type ComposerHandle } from '../layout/Composer.js';
import type { InspectorTab } from '../layout/Inspector.js';
import { LookCard } from '../layout/LookCard.js';
import { useArchiveNode } from '../useArchiveNode.js';
import { useDeleteNode } from '../useDeleteNode.js';

/**
 * What the shot overlay needs from the canvas behind it. The overlay is a child
 * route, so this travels through the Outlet rather than through props.
 */
export interface ShotContext {
  nodes: TreeNode[];
  loaded: boolean;
  brand: Brand;
  engines: EngineInfo[];
  projectId: string;
  imageIndex: number;
  setImageIndex: (i: number) => void;
  close: () => void;
  select: (id: string) => void;
  retry: (node: TreeNode) => void;
  cancel: (node: TreeNode) => void;
  reload: () => Promise<void>;
  remix: (node: TreeNode) => void;
  branch: (node: TreeNode) => void;
  archive: (node: TreeNode) => void;
  unarchive: (node: TreeNode) => void;
  delete: (node: TreeNode) => void;
  layers: TextLayer[];
  selectedLayerId: string | null;
  setSelectedLayerId: (id: string | null) => void;
  changeLayers: (node: TreeNode, layers: TextLayer[]) => void;
  addLayer: (node: TreeNode) => void;
  lift: (node: TreeNode) => void;
  lifting: boolean;
  tab: InspectorTab;
  setTab: (tab: InspectorTab) => void;
}

/** The lenses that are not places. A set is a place and lives in the path. */
type Lens = 'all' | 'keepers' | 'ungrouped' | 'archived';

/**
 * Grid size, as a target column width. The feed fits as many of these as it can
 * and shares out the remainder, so this is a floor rather than an exact size.
 * The default lands four columns on a 1440 screen; the old fixed value managed
 * two and left a third of the width empty.
 */
const TILE_MIN = 160;
const TILE_MAX = 420;
const TILE_DEFAULT = 240;

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
  const { engines, looks: templates } = useAppData();
  const { brand, workspace, nodes: allNodes, sets, membership, loaded, refresh } = useBrand();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const nodeId = useNodeId();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { open: assetsOpen, toggle: toggleAssets, setOpen: setAssetsOpen } = useAssetsPanel();
  const [err, setErr] = useState<string | null>(null);
  const [draftLayers, setDraftLayers] = useState<TextLayer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [lifting, setLifting] = useState(false);
  const [remixBrief, setRemixBrief] = useState<any>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [lensParam, setLens] = useFilterParam('tab', 'all');
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
  /** Runs opened out into their variants. Not in the URL: it is a glance. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** How big the tiles are. A preference, not a location, so it lives on the machine. */
  const [tile, setTile] = useLocalPref(PREF.tileSize, TILE_DEFAULT);
  const [compareOpen, setCompareOpen] = useState(false);
  const [iParam, setIParam] = useFilterParam('i', '0');
  const [panel, setPanel] = useFilterParam('panel', 'text');
  const imageIndex = Number.parseInt(iParam, 10) || 0;
  const inspectorTab = (panel === 'info' ? 'info' : 'text') as InspectorTab;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const openShot = useCallback(
    (id: string, i = 0, replace = false) => {
      const p = new URLSearchParams(params);
      if (i > 0) p.set('i', String(i));
      else p.delete('i');
      const q = p.toString();
      navigate(`${base}/shots/${id}${q ? `?${q}` : ''}`, { replace });
    },
    [base, navigate, params],
  );
  const closeShot = useCallback(() => {
    const p = new URLSearchParams(params);
    // the variant was about the shot that is closing, the rest is about the view
    p.delete('i');
    const q = p.toString();
    // replace, not push: every in-overlay navigation since the initial open
    // has itself replaced rather than pushed, so this is the one entry to
    // consume, making X and the browser's Back button interchangeable
    navigate(`${base}${q ? `?${q}` : ''}`, { replace: true });
  }, [base, navigate, params]);

  const lens: Lens =
    lensParam === 'keepers' || lensParam === 'ungrouped' || lensParam === 'archived' ? lensParam : 'all';

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
  const shots = useMemo(
    () =>
      [...allNodes]
        .filter((n) => n.kind !== 'root' && !n.archived)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [allNodes],
  );

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

  const shown = useMemo(() => {
    // archived shots are excluded from `shots` itself, so this lens reads
    // straight from allNodes rather than layering on top of the others
    if (lens === 'archived') {
      return [...allNodes]
        .filter((n) => n.kind !== 'root' && n.archived)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    if (lineage) return shots.filter((n) => lineage.ids.has(n.id));
    if (set) {
      const inSet = new Set(membership[set.id] ?? []);
      return shots.filter((n) => inSet.has(n.id));
    }
    if (lens === 'keepers') return shots.filter((n) => n.kept);
    if (lens === 'ungrouped') return shots.filter((n) => !setsByNode.has(n.id));
    return shots;
  }, [shots, set, membership, lens, setsByNode, lineage, allNodes]);

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
    const usable = shown.filter((n) => n.status !== 'error');
    return usable[0] ?? shown[0] ?? root;
  }, [allNodes, selectedId, shown, root]);

  /**
   * The branch target, resolved against what actually exists. A URL can name a
   * shot that has since failed, or one from a brand you are no longer in, so
   * the chip is derived rather than stored and cannot outlive its shot.
   */
  const target = useMemo(
    () =>
      allNodes.find((n) => n.id === branchId && n.kind !== 'root' && n.status === 'done' && n.images.length > 0) ??
      null,
    [allNodes, branchId],
  );

  // a target that has stopped being one is dropped, and said so: a chip that
  // silently stops meaning anything is worse than no chip
  useEffect(() => {
    if (!branchId || target || !loaded) return;
    setBranchId(null);
    push({ kind: 'error', title: 'That shot is no longer available to branch from', detail: 'Making a new shot.' });
  }, [branchId, target, loaded, setBranchId, push]);

  const branchFrom = useCallback(
    (id: string) => {
      setBranchId(id);
      composerRef.current?.focus();
    },
    [setBranchId],
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

  // hydrate editable layers when the edited surface changes
  const surfaceKey = `${selected?.id ?? 'none'}:${imageIndex}`;
  useEffect(() => {
    setDraftLayers((selected?.overlays?.[String(imageIndex)] ?? []) as TextLayer[]);
    setSelectedLayerId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaceKey]);

  /**
   * Text edits are debounced, so at any moment there can be a write that has
   * been promised to the user and not yet sent. It is held here rather than
   * captured in the timer alone, so it can be flushed deliberately instead of
   * relying on a stray timer firing out of an unmounted closure.
   */
  const pendingSave = useRef<{ nodeId: string; overlays: Record<string, TextLayer[]> } | null>(null);

  const flushLayers = useCallback(async () => {
    const write = pendingSave.current;
    if (!write) return;
    pendingSave.current = null;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    try {
      await api.saveOverlays(write.nodeId, write.overlays);
      await reload();
    } catch (e: any) {
      // the draft stays on screen: silently reverting to the server copy is
      // how an edit disappears without anyone knowing it was ever at risk
      push({
        kind: 'error',
        title: 'Text not saved',
        detail: String(e?.message ?? e),
        action: {
          label: 'Try again',
          onClick: () => {
            pendingSave.current = write;
            void flushLayers();
          },
        },
      });
    }
  }, [reload, push]);

  const changeLayers = (node: TreeNode, layers: TextLayer[]) => {
    setDraftLayers(layers);
    // the index is captured now, not when the timer fires: moving to another
    // variant mid-debounce must not write these layers onto the one you moved to
    pendingSave.current = { nodeId: node.id, overlays: { ...node.overlays, [String(imageIndex)]: layers } };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flushLayers(), 700);
  };

  /**
   * Leaving the edited surface, or the screen, sends what is owed first. The
   * flush goes through a ref so this fires on a genuine surface change and not
   * every time `reload` happens to get a new identity.
   */
  const flushRef = useRef(flushLayers);
  flushRef.current = flushLayers;
  useEffect(() => {
    return () => {
      void flushRef.current();
    };
  }, [surfaceKey]);

  // A reload or a closed tab cannot await anything, so that one case goes out
  // with keepalive instead.
  useEffect(() => {
    const onLeave = () => {
      const write = pendingSave.current;
      if (write) saveOverlaysOnUnload(write.nodeId, write.overlays);
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, []);

  const addTextLayer = (node: TreeNode) => {
    const layer: TextLayer = {
      id: `l-${Math.random().toString(36).slice(2, 8)}`,
      text: 'Your headline',
      x: 8,
      y: 8,
      width: 60,
      fontId: 'inter-tight',
      size: 72,
      weight: 700,
      color: '#FFFFFF',
      align: 'left',
      lineHeight: 1.12,
      opacity: 1,
      shadow: { x: 0, y: 2, blur: 10, color: 'rgba(0,0,0,0.45)' },
    };
    changeLayers(node, [...draftLayers, layer]);
    setSelectedLayerId(layer.id);
  };

  const retry = async (node: TreeNode) => {
    await api.addNode({
      projectId,
      parentId: node.parentId,
      kind: node.kind === 'edit' ? 'edit' : 'generation',
      prompt: node.prompt,
      engineId: node.engineId,
      count: Math.max(1, node.images.length || 1),
      brief: node.brief,
    });
    await reload();
  };

  const cancel = async (node: TreeNode) => {
    try {
      await api.cancelNode(node.id);
      await reload();
    } catch (e: any) {
      push({ kind: 'error', title: 'Could not cancel this shot', detail: String(e.message ?? e) });
    }
  };

  const liftText = async (node: TreeNode) => {
    if (lifting) return;
    const engine =
      ['codex-cli', 'openrouter', 'demo']
        .map((id) => engines.find((e) => e.id === id && e.available && e.supportsEdit))
        .find(Boolean) ?? engines.find((e) => e.available && e.supportsEdit);
    if (!engine) return;
    setLifting(true);
    try {
      const productId = (brand.json?.products ?? [])[0]?.id as string | undefined;
      const child = await api.addNode({
        projectId,
        parentId: node.id,
        kind: 'edit',
        ...(productId ? { productId } : {}),
        prompt:
          'Remove all overlaid marketing text, headlines, captions and slogans from this image and reconstruct the background seamlessly where they were. IMPORTANT: keep text that is part of a product’s own label or packaging exactly as it is. Keep every other element pixel-identical.',
        engineId: engine.id,
      });
      const quoted = [...node.prompt.matchAll(/"([^"]{2,80})"/g)].map((m) => m[1]);
      const words = quoted.length ? quoted : ['Your headline'];
      const layers: TextLayer[] = words.map((w, i) => ({
        id: `l-${Math.random().toString(36).slice(2, 8)}${i}`,
        text: w,
        x: 8,
        y: 7 + i * 14,
        width: 84,
        size: 88,
        fontId: 'inter-tight',
        weight: 700,
        color: '#FFFFFF',
        align: 'center',
        lineHeight: 1.08,
        opacity: 1,
        shadow: { x: 0, y: 2, blur: 10, color: 'rgba(0,0,0,0.45)' },
      }));
      await api.saveOverlays(child.id, { '0': layers });
      await reload();
      goToShot(child.id);
    } finally {
      setLifting(false);
    }
  };

  /** Focus the brief. What the Create button and the two create cards do now. */
  const compose = useCallback((opts?: { look?: string; looksPanel?: boolean }) => {
    if (opts?.look) composerRef.current?.applyTemplate(opts.look);
    if (opts?.looksPanel) composerRef.current?.openAttach('Looks');
    composerRef.current?.focus();
  }, []);

  // Create from the nav arrives as a param rather than a call, because the nav
  // is mounted above this screen and may be on another one when you press it
  useEffect(() => {
    if (params.get('compose') === null) return;
    compose();
    setParams(
      (cur) => {
        const p = new URLSearchParams(cur);
        p.delete('compose');
        return p;
      },
      { replace: true },
    );
  }, [params, compose, setParams]);

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
        setBranchId(null);
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
        void api.keep(selected.id, !selected.kept).then(() => void reload());
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

  /** One press sets them all; pressing again on an all-kept selection clears them. */
  const keepPicked = async () => {
    const next = !(pickedNodes.length > 0 && pickedNodes.every((n) => n.kept));
    await Promise.all(pickedNodes.filter((n) => n.kept !== next).map((n) => api.keep(n.id, next)));
    await reload();
  };

  const addPickedTo = async (target: ShotSet) => {
    await api.addToSet(target.id, [...picked]);
    setPicked(new Set());
    await reload();
  };

  const newSetWith = async (nodeIds: string[]) => {
    try {
      const made = await api.createSet(brand.id, 'Untitled set');
      if (nodeIds.length > 0) await api.addToSet(made.id, nodeIds);
      setPicked(new Set());
      await reload();
      navigate(`${setPath(brand, made)}?rename=1`);
    } catch (e: any) {
      push({ kind: 'error', title: 'Could not create the set', detail: String(e?.message ?? e) });
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
  const emptyState = hasNoShots(allNodes) ? (
    <FirstRun looks={templates} brandId={brand.id} onLook={(id) => compose({ look: id })} />
  ) : set ? (
    <LensEmpty text="Nothing in this set yet. Pick shots on All, then add them here." />
  ) : lens === 'keepers' ? (
    <LensEmpty text="No keepers yet. Star a shot and it lands here." onAll={() => setLens(null)} />
  ) : lens === 'ungrouped' ? (
    <LensEmpty text="Every shot is already in a set." onAll={() => setLens(null)} />
  ) : lens === 'archived' ? (
    <LensEmpty text="Nothing archived." onAll={() => setLens(null)} />
  ) : null;

  const shotContext: ShotContext = {
    nodes: allNodes,
    loaded,
    brand,
    engines,
    projectId,
    imageIndex,
    setImageIndex,
    close: closeShot,
    select: goToShot,
    retry: (n) => void retry(n),
    cancel: (n) => void cancel(n),
    reload: () => reload(),
    remix: (n) => {
      setRemixBrief({ ...n.brief, _at: Date.now() });
      // durable against a reload landing between this click and the hub
      // Composer actually consuming the live prop above: the same persisted
      // per-brand draft record loadDraft() already restores from on mount
      if (n.brief)
        saveDraft(brand.id, { tokens: briefTokens(n.brief), tplFields: n.brief.templateFields ?? {}, branchId: null });
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
    layers: draftLayers,
    selectedLayerId,
    setSelectedLayerId,
    changeLayers,
    addLayer: addTextLayer,
    lift: (n) => void liftText(n),
    lifting,
    tab: inspectorTab,
    setTab: (t) => setPanel(t),
  };

  return (
    <div className="sc-work" data-assets={assetsOpen}>
      <main className="sc-canvas" id="main">
        {err && (
          <Callout.Root className="sc-canvas-alert" color="red" mb="3">
            <Callout.Text>{err}</Callout.Text>
          </Callout.Root>
        )}

        <FeedToolbar
          brand={brand}
          sets={sets}
          active={set}
          lens={lens}
          onLens={(l) => setLens(l === 'all' ? null : l)}
          onNewSet={() => void newSetWith([])}
          count={shown.length}
          tile={tile}
          onTile={setTile}
        />

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

        <Canvas
          nodes={shown}
          selectedId={selected?.id ?? null}
          onOpen={openShot}
          onRetry={(n) => void retry(n)}
          onCancel={(n) => void cancel(n)}
          onToggleKeep={(n) => void api.keep(n.id, !n.kept).then(() => void reload())}
          // Canvas shows one button/menu item whose label already flips on
          // n.archived (Archive vs Restore) — this is the toggle its single
          // onClick needs to actually do the right one of the two
          onArchive={(n) => (n.archived ? unarchive(n) : archive(n))}
          onDeletePermanently={remove}
          setsFor={(id) => setsByNode.get(id) ?? []}
          picked={picked}
          onPick={togglePick}
          sending={sending}
          onBranch={branchFrom}
          branchingFrom={target?.id ?? null}
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

      {assetsOpen && <div className="sc-assets-backdrop" onClick={() => setAssetsOpen(false)} aria-hidden />}
      <Shortcuts open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      <AssetsPanel
        brand={brand}
        templates={templates}
        shots={allNodes}
        onProduct={(id) => composerRef.current?.insertToken({ t: 'product', id })}
        onCharacter={(id) => composerRef.current?.insertToken({ t: 'character', id })}
        onColor={(hex, name) => composerRef.current?.insertToken({ t: 'color', hex, name })}
        onRef={(imageHash) => composerRef.current?.insertToken({ t: 'ref', imageHash })}
        onTemplate={(id) => composerRef.current?.applyTemplate(id)}
        onBrandChanged={() => void reload()}
        onClose={() => setAssetsOpen(false)}
      />

      <div className="sc-dock-fade" data-full={!assetsOpen} aria-hidden />
      <div className="sc-canvas-dock" data-full={!assetsOpen}>
        {/* Inside the dock, not floating above it at a guessed offset: the
            composer grows with a banner, a target chip or an open attach panel,
            and any fixed distance from the bottom was a bet that it would not.
            It sat under the composer and its buttons could not be clicked. */}
        {picked.size > 0 && (
          <PickedBar
            count={picked.size}
            sets={sets}
            onAdd={(s) => void addPickedTo(s)}
            onNew={() => void newSetWith([...picked])}
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
          startTemplate={params.get('look') ?? undefined}
          openAttachTab={
            params.get('attach') === 'looks' ? 'Looks' : params.get('attach') === 'products' ? 'Products' : undefined
          }
          target={target}
          onClearTarget={() => setBranchId(null)}
          onRestoreBranchId={setBranchId}
          setSlug={set?.slug ?? null}
          onSending={setSending}
          onQueued={(made) => {
            setRemixBrief(null);
            // the seed has been spent: keep it out of the next refresh
            setParams(
              (cur) => {
                const p = new URLSearchParams(cur);
                p.delete('look');
                p.delete('attach');
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
            // standing in a set is a visible filter, so a shot made here joins
            // it — otherwise the thing you just asked for vanishes on arrival
            if (set && made) void api.addToSet(set.id, [made]).then(reload).finally(landed);
            else void reload().finally(landed);
          }}
        />
      </div>

      <Outlet context={shotContext} />
    </div>
  );
}

/**
 * The brand has never made anything. The only empty state that has to teach,
 * so it is the only one that offers a way to start rather than a way back.
 *
 * A look is the shortest route to a first shot worth keeping, which is why the
 * row is here and not a second sentence: the brief accepts prose, but prose is
 * the harder opening move for someone who has never used this.
 */
function FirstRun({ looks, brandId, onLook }: { looks: Look[]; brandId: string; onLook: (id: string) => void }) {
  // favourites first, the same ordering Home uses, so the two agree
  const ordered = useMemo(() => {
    const favs = favoriteLooks(brandId);
    return [...looks].sort((a, b) => Number(favs.includes(b.id)) - Number(favs.includes(a.id))).slice(0, 8);
  }, [looks, brandId]);

  return (
    <div className="sc-canvas-empty">
      <h3>
        Your first <em>shot</em>
      </h3>
      {/* No "start writing" button: the caret is already in the brief below.
          A button whose only job is to focus something already focused is one
          more thing to read on the emptiest screen in the app. */}
      <p>Describe what you want in the brief below, or start from a look.</p>
      {ordered.length > 0 && (
        <div className="sc-tplrow sc-empty-looks">
          {ordered.map((t) => (
            <LookCard key={t.id} look={t} variant="use" size="shelf" onUse={onLook} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A lens is hiding work that exists. Never a bare blank: say which lens, and
 * offer the way out of it, because the alternative reads as the shots having
 * been thrown away.
 */
function LensEmpty({ text, onAll }: { text: string; onAll?: () => void }) {
  return (
    <div className="sc-feed-empty">
      <p>{text}</p>
      {onAll && (
        <button type="button" className="sc-btn" onClick={onAll}>
          Show all shots
        </button>
      )}
    </div>
  );
}

/**
 * All, Keepers, Ungrouped, then the sets.
 *
 * A lens is a way of looking at the hub and rides in the query string; a set is
 * somewhere you can be and has a path of its own. Leaving a set therefore means
 * a navigation, and it must land on the hub — never on Home, which holds none
 * of this and would read as the filter having thrown the work away.
 */
const LENSES: { id: Lens; label: string; query: string }[] = [
  { id: 'all', label: 'All', query: '' },
  { id: 'keepers', label: 'Keepers', query: '?tab=keepers' },
  { id: 'ungrouped', label: 'Ungrouped', query: '?tab=ungrouped' },
  { id: 'archived', label: 'Archived', query: '?tab=archived' },
];

/**
 * One row above the feed, with each kind of thing in its own shape.
 *
 * This used to be a single strip of identical tabs holding three unrelated
 * things: lenses, which filter where you already are; sets, which are places
 * with their own address; and an action. Nothing on screen said which was
 * which, so "Keepers" and a set name looked like the same kind of click and
 * behaved completely differently. Ten sets also squashed the row, because it
 * was a nowrap flex line with nothing to stop it.
 *
 * Now: a segmented control for the lenses, a menu for the sets (which holds
 * fifty as happily as two), an icon for the action, and the view controls
 * pushed to the far end.
 */
function FeedToolbar({
  brand,
  sets,
  active,
  lens,
  onLens,
  onNewSet,
  count,
  tile,
  onTile,
}: {
  brand: Brand;
  sets: ShotSet[];
  active: ShotSet | null;
  lens: Lens;
  onLens: (l: Lens) => void;
  onNewSet: () => void;
  count: number;
  tile: number;
  onTile: (px: number) => void;
}) {
  const navigate = useNavigate();
  const toHub = (q = '') => navigate(hubPath(brand) + q);

  return (
    <div className="sc-toolbar">
      <div className="sc-seg sc-toolbar-lenses" data-leaves-set={!!active || undefined}>
        {LENSES.map((l) => (
          <button
            key={l.id}
            type="button"
            className="sc-seg-o"
            // standing in a set means no lens is active: a set is somewhere you
            // are, and leaving it is a navigation rather than a filter change —
            // the icon is what says so, since the click itself looks identical
            data-on={(!active && lens === l.id) || undefined}
            aria-pressed={!active && lens === l.id}
            // title alone is a mouse-hover-only signal — the same fact belongs
            // in the accessible name too, or a keyboard/screen-reader user gets
            // none of what the icon and color are telling everyone else
            title={active ? `Leaves ${active.name}, back to the whole brand` : undefined}
            aria-label={active ? `${l.label}, leaves ${active.name}` : undefined}
            onClick={() => (active ? toHub(l.query) : onLens(l.id))}
          >
            {active && <ArrowUpRight size={11} />}
            {l.label}
          </button>
        ))}
      </div>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <button type="button" className="sc-setsbtn" data-on={!!active || undefined}>
            <FolderSimple size={13} />
            <span className="sc-setsbtn-t">{active ? active.name : 'Sets'}</span>
            {!active && sets.length > 0 && <span className="sc-setsbtn-n">{sets.length}</span>}
            <CaretDown size={10} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start">
          {sets.length === 0 && <DropdownMenu.Item disabled>No sets yet</DropdownMenu.Item>}
          {sets.map((s) => (
            <DropdownMenu.Item key={s.id} onSelect={() => navigate(setPath(brand, s))}>
              {s.name}
            </DropdownMenu.Item>
          ))}
          {active && (
            <>
              <DropdownMenu.Separator />
              <DropdownMenu.Item onSelect={() => toHub()}>Leave this set</DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Root>

      <button type="button" className="sc-icon-btn sc-newset" onClick={onNewSet} title="New set" aria-label="New set">
        <Plus size={14} />
      </button>

      <span className="sc-toolbar-gap" />

      <span className="sc-toolbar-count">
        {count} shot{count === 1 ? '' : 's'}
      </span>

      {/* A real range input: keyboard operable for free, and the only control
          here that a phone has no room to drag, so CSS hides it there. */}
      <label className="sc-density">
        <SquaresFour size={13} />
        <input
          type="range"
          min={TILE_MIN}
          max={TILE_MAX}
          step={20}
          value={tile}
          aria-label="Grid size"
          // right is bigger, which is the way every zoom control works. No
          // inversion: the value on the input is the tile width, full stop.
          onChange={(e) => onTile(Number(e.target.value))}
        />
      </label>
    </div>
  );
}

/** What you can do with a handful of shots. Only ever about membership. */
function PickedBar({
  count,
  sets,
  onAdd,
  onNew,
  onClear,
  onKeep,
  allKept,
  comparable,
  onCompare,
  archivedLens,
  pickedIds,
  onRestoreBatch,
  onDeleteBatch,
}: {
  count: number;
  sets: ShotSet[];
  onAdd: (s: ShotSet) => void;
  onNew: () => void;
  onClear: () => void;
  onKeep: () => void;
  allKept: boolean;
  comparable: readonly [TreeNode, TreeNode] | null;
  onCompare: () => void;
  /** Keep/Compare/Add-to-set are curation for active work — an archived
   * selection only has two sensible actions, so the bar swaps entirely. */
  archivedLens: boolean;
  pickedIds: string[];
  onRestoreBatch: (ids: string[]) => void;
  onDeleteBatch: (ids: string[]) => void;
}) {
  return (
    <div className="sc-picked" role="status">
      <span className="sc-picked-n">{count} selected</span>
      {archivedLens ? (
        <button type="button" className="sc-btn" onClick={() => onRestoreBatch(pickedIds)}>
          Restore
        </button>
      ) : (
        <>
          <button type="button" className="sc-btn" onClick={onKeep}>
            {allKept ? 'Remove from keepers' : 'Keep'}
          </button>
          {/* shown at two, so the bar does not carry a control that spends most of
              its life disabled and unexplained */}
          {count === 2 && (
            <button
              type="button"
              className="sc-btn"
              // aria-disabled: keeps the button tab-reachable so its title —
              // the only explanation for why Compare is inert — stays
              // discoverable to keyboard/screen-reader users, not just mouse hover
              aria-disabled={!comparable || undefined}
              onClick={() => {
                if (comparable) onCompare();
              }}
              title={comparable ? 'Show the drift between these two' : 'Both shots need to have finished'}
            >
              Compare
            </button>
          )}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <button type="button" className="sc-btn sc-btn-primary">
                Add to set
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              {sets.map((s) => (
                <DropdownMenu.Item key={s.id} onSelect={() => onAdd(s)}>
                  {s.name}
                </DropdownMenu.Item>
              ))}
              {sets.length > 0 && <DropdownMenu.Separator />}
              <DropdownMenu.Item onSelect={onNew}>New set…</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </>
      )}
      <button type="button" className="sc-btn" onClick={onClear}>
        Clear
      </button>
      {archivedLens && (
        <Confirm
          label={`Delete ${count} permanently`}
          title={`Delete ${count} shot${count === 1 ? '' : 's'} permanently?`}
          body="This cannot be undone."
          busy={false}
          onConfirm={() => onDeleteBatch(pickedIds)}
        />
      )}
    </div>
  );
}

/**
 * useParams only reaches as far as the route that rendered you, so the child
 * route's shotId is invisible from here. The overlay hangs off the hub and off
 * a set alike, so both spellings have to be matched — and unconditionally,
 * because React counts hooks by position.
 */
function useNodeId(): string | null {
  const onHub = useMatch(P.hubShot);
  const inSet = useMatch(P.setShot);
  return onHub?.params.shotId ?? inSet?.params.shotId ?? null;
}
