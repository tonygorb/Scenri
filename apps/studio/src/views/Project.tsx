import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Callout, DropdownMenu, Flex } from '@radix-ui/themes';
import { CaretDown, SidebarSimple } from '@phosphor-icons/react';
import {
  api,
  type Brand,
  type EngineInfo,
  type Project as ProjectRow,
  type Look,
  type TextLayer,
  type TreeNode,
} from '../api.js';
import { TopBar, Wordmark, type NavItem } from '../layout/TopBar.js';
import { Shortcuts } from '../layout/Shortcuts.js';
import { Canvas } from '../layout/Canvas.js';
import { AssetsPanel } from '../layout/AssetsPanel.js';
import { DetailOverlay } from '../layout/DetailOverlay.js';
import { Composer, type ComposerHandle } from '../layout/Composer.js';
import type { InspectorTab } from '../layout/Inspector.js';
import { useToasts } from '../toasts.js';

export function ProjectView({
  brand,
  engines,
  nav,
  projectId,
  startTemplate,
  openTemplates,
  projects,
  settingsButton,
  onSwitchProject,
}: {
  brand: Brand;
  engines: EngineInfo[];
  nav: NavItem[];
  projectId: string;
  /** Template picked on Home: seeds the composer for this project. */
  startTemplate?: string;
  /** "New photoshoot": opens the attach panel on Looks. */
  openTemplates?: boolean;
  projects: ProjectRow[];
  settingsButton: React.ReactNode;
  onSwitchProject: (id: string) => void;
}) {
  const [nodes, setNodes] = useState<TreeNode[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [imageIndex, setImageIndex] = useState(0);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [draftLayers, setDraftLayers] = useState<TextLayer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [lifting, setLifting] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('text');
  const [remixBrief, setRemixBrief] = useState<any>(null);
  const [templates, setTemplates] = useState<Look[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { push } = useToasts();
  const statusRef = useRef<Map<string, string>>(new Map());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composerRef = useRef<ComposerHandle>(null);

  useEffect(() => {
    void api
      .looks()
      .then((r) => setTemplates(r.looks))
      .catch(() => {});
  }, []);

  const loadTree = useCallback(async () => {
    try {
      const t = await api.tree(projectId);
      for (const n of t.nodes) {
        const prev = statusRef.current.get(n.id);
        if (prev === 'running' && n.status === 'done') {
          push({
            kind: 'success',
            title: 'Generation finished',
            detail: n.prompt.replace(/^\[[^\]]*\]\s*/, '').slice(0, 60),
            action: {
              label: 'View',
              onClick: () => {
                setSelectedId(n.id);
                setImageIndex(0);
                setOverlayOpen(true);
              },
            },
          });
        } else if (prev === 'running' && n.status === 'error') {
          push({ kind: 'error', title: 'Generation failed', detail: n.error ?? undefined });
        }
        statusRef.current.set(n.id, n.status);
      }
      setNodes(t.nodes);
      setErr(null);
    } catch (e: any) {
      setErr(String(e.message ?? e));
    }
  }, [projectId]);
  useEffect(() => {
    setNodes(null);
    setSelectedId(null);
    setImageIndex(0);
    setOverlayOpen(false);
    void loadTree();
  }, [loadTree]);

  const running = (nodes ?? []).some((n) => n.status === 'running');
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (running) pollRef.current = setInterval(() => void loadTree(), 1500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [running, loadTree]);

  const byParent = useMemo(() => {
    const m = new Map<string | null, TreeNode[]>();
    for (const n of nodes ?? []) {
      if (!m.has(n.parentId)) m.set(n.parentId, []);
      m.get(n.parentId)!.push(n);
    }
    return m;
  }, [nodes]);
  const root = (nodes ?? []).find((n) => n.kind === 'root') ?? null;

  const selected = useMemo(() => {
    const list = nodes ?? [];
    const byId = list.find((n) => n.id === selectedId);
    if (byId) return byId;
    // never land the user on a failure: prefer the newest usable shot
    const usable = list.filter((n) => n.kind !== 'root' && n.status !== 'error');
    const any = list.filter((n) => n.kind !== 'root');
    return usable[usable.length - 1] ?? any[any.length - 1] ?? root;
  }, [nodes, selectedId, root]);

  const select = (id: string) => {
    setSelectedId(id);
    setImageIndex(0);
  };
  const openShot = (id: string) => {
    select(id);
    setOverlayOpen(true);
  };

  // hydrate editable layers when the edited surface changes
  const surfaceKey = `${selected?.id ?? 'none'}:${imageIndex}`;
  useEffect(() => {
    setDraftLayers((selected?.overlays?.[String(imageIndex)] ?? []) as TextLayer[]);
    setSelectedLayerId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaceKey]);

  const changeLayers = (node: TreeNode, layers: TextLayer[]) => {
    setDraftLayers(layers);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void api.saveOverlays(node.id, { ...node.overlays, [String(imageIndex)]: layers }).then(() => loadTree());
    }, 700);
  };

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
    });
    await loadTree();
  };

  const liftText = async (node: TreeNode) => {
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
      await loadTree();
      select(child.id);
    } finally {
      setLifting(false);
    }
  };

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
      if (e.key === 'Escape' && overlayOpen) {
        setOverlayOpen(false);
        e.preventDefault();
        return;
      }
      if (!selected) return;
      if (e.key === 'k' && selected.kind !== 'root' && selected.status === 'done') {
        void api.keep(selected.id, !selected.kept).then(() => void loadTree());
        e.preventDefault();
        return;
      }
      const sibs = (byParent.get(selected.parentId) ?? []).filter((n) => n.kind !== 'root');
      const i = sibs.findIndex((n) => n.id === selected.id);
      if (e.key === 'ArrowLeft' && i > 0) {
        select(sibs[i - 1].id);
        e.preventDefault();
      } else if (e.key === 'ArrowRight' && i >= 0 && i < sibs.length - 1) {
        select(sibs[i + 1].id);
        e.preventDefault();
      } else if (e.key === 'ArrowUp' && selected.parentId) {
        select(selected.parentId);
        e.preventDefault();
      } else if (e.key === 'ArrowDown') {
        const kids = byParent.get(selected.id) ?? [];
        if (kids.length) {
          select(kids[0].id);
          e.preventDefault();
        }
      } else if (e.key === '[' && imageIndex > 0) setImageIndex(imageIndex - 1);
      else if (e.key === ']' && selected.images.length - 1 > imageIndex) setImageIndex(imageIndex + 1);
      else if (e.key === 'Enter' && !overlayOpen && selected.kind !== 'root') setOverlayOpen(true);
      else if (e.key === '.' && !overlayOpen) setAssetsOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, byParent, imageIndex, overlayOpen, shortcutsOpen]);

  const overlayNode = overlayOpen && selected && selected.kind !== 'root' ? selected : null;

  return (
    <div className="bt-work" data-assets={assetsOpen}>
      <TopBar
        engines={engines}
        nav={nav}
        left={
          <Flex align="center" gap="2">
            <span className="bt-desktop-only">
              <Wordmark />
            </span>
            <span className="bt-crumb">{brand.json?.meta?.name} / </span>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                <button
                  type="button"
                  className="bt-crumb"
                  style={{
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 2px',
                  }}
                >
                  <b>{projects.find((x) => x.id === projectId)?.name ?? 'Project'}</b>
                  <CaretDown size={11} />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content>
                {projects.map((pr) => (
                  <DropdownMenu.Item key={pr.id} onSelect={() => onSwitchProject(pr.id)}>
                    {pr.name}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </Flex>
        }
        right={
          <>
            {settingsButton}
            <button
              type="button"
              className="bt-icon-btn bt-desktop-only"
              onClick={() => setAssetsOpen((v) => !v)}
              aria-label="Toggle assets panel"
              title="Assets panel (.)"
              style={assetsOpen ? { background: 'var(--bt-raised)', color: 'var(--bt-fg)' } : undefined}
            >
              <SidebarSimple size={14} mirrored />
            </button>
          </>
        }
      />

      <div className="bt-canvas">
        {err && (
          <Callout.Root color="red" mb="3">
            <Callout.Text>{err}</Callout.Text>
          </Callout.Root>
        )}
        {nodes === null && (
          <div className="bt-feed">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="bt-cell bt-skeleton"
                style={{ aspectRatio: i % 3 === 0 ? '4/5' : '1', cursor: 'default' }}
              />
            ))}
          </div>
        )}
        {nodes !== null && (
          <Canvas nodes={nodes} selectedId={selected?.id ?? null} onOpen={openShot} onRetry={(n) => void retry(n)} />
        )}
      </div>

      {assetsOpen && <div className="bt-assets-backdrop" onClick={() => setAssetsOpen(false)} aria-hidden />}
      <Shortcuts open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      <AssetsPanel
        brand={brand}
        templates={templates}
        shots={nodes ?? []}
        onProduct={(id) => composerRef.current?.insertToken({ t: 'product', id })}
        onCharacter={(id) => composerRef.current?.insertToken({ t: 'character', id })}
        onColor={(hex, name) => composerRef.current?.insertToken({ t: 'color', hex, name })}
        onRef={(imageHash) => composerRef.current?.insertToken({ t: 'ref', imageHash })}
        onTemplate={(id) => composerRef.current?.applyTemplate(id)}
        onBrandChanged={() => void loadTree()}
        onClose={() => setAssetsOpen(false)}
      />

      <div className="bt-dock-fade" aria-hidden />
      <div className="bt-canvas-dock" data-full={!assetsOpen}>
        <Composer
          ref={composerRef}
          projectId={projectId}
          brand={brand}
          engines={engines}
          parent={root}
          shots={nodes ?? []}
          initialBrief={remixBrief}
          startTemplate={startTemplate}
          openAttachTab={openTemplates ? 'Looks' : undefined}
          onQueued={() => {
            setRemixBrief(null);
            void loadTree();
          }}
        />
      </div>

      {overlayNode && (
        <DetailOverlay
          node={overlayNode}
          nodes={nodes ?? []}
          brand={brand}
          engines={engines}
          projectId={projectId}
          imageIndex={imageIndex}
          onImageIndex={setImageIndex}
          onClose={() => setOverlayOpen(false)}
          onSelect={select}
          onRetry={(n) => void retry(n)}
          onChanged={() => void loadTree()}
          onRemix={(n) => {
            setRemixBrief({ ...n.brief, _at: Date.now() });
            setOverlayOpen(false);
          }}
          layers={draftLayers}
          selectedLayerId={selectedLayerId}
          onSelectLayer={setSelectedLayerId}
          onLayersChange={(ls) => changeLayers(overlayNode, ls)}
          onAddLayer={() => addTextLayer(overlayNode)}
          onLift={() => void liftText(overlayNode)}
          lifting={lifting}
          tab={inspectorTab}
          onTabChange={setInspectorTab}
        />
      )}
    </div>
  );
}
