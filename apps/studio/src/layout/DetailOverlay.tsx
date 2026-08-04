import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowsClockwise,
  ArrowsLeftRight,
  CaretLeft,
  CaretRight,
  CopySimple,
  DownloadSimple,
  PencilSimple,
  Plus,
  Star,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import { Spinner } from '@radix-ui/themes';
import {
  api,
  assetUrl,
  imgUrl,
  nodeLabel,
  type Brand,
  type EngineInfo,
  type TextLayer,
  type TreeNode,
} from '../api.js';
import { flattenToBlob } from '../editor/flatten.js';
import { ExportDialog } from './ExportDialog.js';
import { StageFrame } from './Stage.js';
import { Inspector, type InspectorTab } from './Inspector.js';
import { Composer } from './Composer.js';
import { Coin } from './Coin.js';
import { useAppData } from '../app/AppShell.js';
import { useToasts } from '../toasts.js';

/**
 * Full-screen takeover for one shot: lineage filmstrip left, stage with the
 * text editor center, merged inspector plus edit composer right. The version
 * tree stays legible here even though the canvas below is a flat masonry.
 */
export function DetailOverlay({
  node,
  nodes,
  brand,
  engines,
  projectId,
  imageIndex,
  onImageIndex,
  onClose,
  onSelect,
  onRetry,
  onChanged,
  onRemix,
  layers,
  selectedLayerId,
  onSelectLayer,
  onLayersChange,
  onAddLayer,
  onLift,
  lifting,
  tab,
  onTabChange,
}: {
  node: TreeNode;
  nodes: TreeNode[];
  brand: Brand;
  engines: EngineInfo[];
  projectId: string;
  imageIndex: number;
  onImageIndex: (i: number) => void;
  onClose: () => void;
  onSelect: (id: string) => void;
  onRetry: (n: TreeNode) => void;
  onChanged: () => void;
  onRemix: (n: TreeNode) => void;
  layers: TextLayer[];
  selectedLayerId: string | null;
  onSelectLayer: (id: string | null) => void;
  onLayersChange: (ls: TextLayer[]) => void;
  onAddLayer: () => void;
  onLift: () => void;
  lifting: boolean;
  tab: InspectorTab;
  onTabChange: (t: InspectorTab) => void;
}) {
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const ancestors = useMemo(() => {
    const out: TreeNode[] = [];
    let cur = node.parentId ? byId.get(node.parentId) : null;
    while (cur && cur.kind !== 'root') {
      out.unshift(cur);
      cur = cur.parentId ? byId.get(cur.parentId) : null;
    }
    return out;
  }, [node, byId]);
  const children = useMemo(() => nodes.filter((n) => n.parentId === node.id && n.kind !== 'root'), [nodes, node.id]);
  const siblings = useMemo(
    () => nodes.filter((n) => n.parentId === node.parentId && n.kind !== 'root'),
    [nodes, node.parentId],
  );
  const sibIndex = siblings.findIndex((n) => n.id === node.id);
  const parent = node.parentId ? byId.get(node.parentId) : null;
  const parentShot = parent && parent.kind !== 'root' ? parent : null;
  const { push } = useToasts();
  const [working, setWorking] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const hash = node.images[imageIndex] ?? node.images[0];
  const baseName =
    node.prompt
      .slice(0, 40)
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9-]/g, '') || 'shot';

  const copyImage = async () => {
    setWorking(true);
    try {
      const blob =
        layers.length > 0 ? await flattenToBlob(imgUrl(hash), layers) : await (await fetch(imgUrl(hash))).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      push({ kind: 'success', title: 'Copied to clipboard' });
    } catch (e: any) {
      push({ kind: 'error', title: 'Copy failed', detail: String(e.message ?? e) });
    } finally {
      setWorking(false);
    }
  };

  // scroll lock while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const frame = (n: TreeNode, current = false) => (
    <button
      type="button"
      key={n.id}
      className="bt-fr"
      data-current={current}
      data-failed={n.status === 'error' || (!n.images[0] && n.status !== 'running')}
      title={nodeLabel(n)}
      onClick={() => onSelect(n.id)}
    >
      {n.images[0] ? (
        <img src={imgUrl(n.images[0])} alt="" />
      ) : n.status === 'running' ? (
        <span className="bt-shimmer" />
      ) : (
        <WarningCircle size={13} />
      )}
      {n.kept && (
        <span className="bt-fr-star">
          <Star size={11} weight="fill" />
        </span>
      )}
    </button>
  );

  return createPortal(
    <div className="bt-ovl" role="dialog" aria-modal="true" aria-label={nodeLabel(node)}>
      <div className="bt-ovl-winbar">
        <button type="button" className="bt-icon-btn" onClick={onClose} aria-label="Close" title="Close (esc)">
          <X size={13} />
        </button>
        <button
          type="button"
          className="bt-icon-btn"
          disabled={sibIndex <= 0}
          style={sibIndex <= 0 ? { opacity: 0.4 } : undefined}
          onClick={() => sibIndex > 0 && onSelect(siblings[sibIndex - 1].id)}
          aria-label="Previous variant"
        >
          <CaretLeft size={13} />
        </button>
        <button
          type="button"
          className="bt-icon-btn"
          disabled={sibIndex >= siblings.length - 1}
          style={sibIndex >= siblings.length - 1 ? { opacity: 0.4 } : undefined}
          onClick={() => sibIndex < siblings.length - 1 && onSelect(siblings[sibIndex + 1].id)}
          aria-label="Next variant"
        >
          <CaretRight size={13} />
        </button>
      </div>

      <div className="bt-ovl-strip">
        <span className="bt-eyebrow">Lineage</span>
        {ancestors.map((a) => (
          <span key={a.id} style={{ display: 'contents' }}>
            {frame(a)}
            <span className="bt-wire" />
          </span>
        ))}
        {frame(node, true)}
        {children.length > 0 && (
          <>
            <span className="bt-wire" />
            <span className="bt-sib-row">{children.slice(0, 4).map((c) => frame(c))}</span>
          </>
        )}
      </div>

      <div className="bt-ovl-stage">
        {node.status === 'done' && node.images.length > 0 && (
          <div className="bt-ovl-tools">
            <span
              className="bt-ovl-cost"
              title={node.costUsd > 0 ? `$${node.costUsd.toFixed(3)} of your API budget` : 'Generated on a free engine'}
            >
              <Coin size={13} />
              {node.costUsd > 0 ? `$${node.costUsd.toFixed(2)}` : 'Free'}
            </span>
            <button
              type="button"
              className="bt-icon-btn"
              onClick={() => setExportOpen(true)}
              aria-label="Export"
              title="Export"
            >
              {working ? <Spinner size="1" /> : <DownloadSimple size={14} />}
            </button>
            <button
              type="button"
              className="bt-icon-btn"
              onClick={() => void api.keep(node.id, !node.kept).then(onChanged)}
              aria-label={node.kept ? 'Remove from keepers' : 'Keep'}
              title={node.kept ? 'Keeper' : 'Keep'}
              style={node.kept ? { color: 'var(--bt-star)' } : undefined}
            >
              <Star size={14} weight={node.kept ? 'fill' : 'regular'} />
            </button>
            {parentShot && (
              <button
                type="button"
                className="bt-icon-btn"
                onClick={() => onTabChange('info')}
                aria-label="Compare with source"
                title="Compare with source"
              >
                <ArrowsLeftRight size={14} />
              </button>
            )}
            <button
              type="button"
              className="bt-icon-btn"
              onClick={() => void copyImage()}
              aria-label="Copy image"
              title="Copy image"
            >
              <CopySimple size={14} />
            </button>
          </div>
        )}
        <StageFrame
          node={node}
          imageIndex={imageIndex}
          onRetry={() => onRetry(node)}
          layers={layers}
          selectedLayerId={selectedLayerId}
          onSelectLayer={onSelectLayer}
          onLayersChange={onLayersChange}
        />
        {node.status === 'done' && node.images.length > 1 && (
          <div style={{ display: 'flex', gap: 8 }}>
            {node.images.map((h, i) => (
              <button
                type="button"
                key={h}
                onClick={() => onImageIndex(i)}
                aria-label={`Image ${i + 1}`}
                style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer', lineHeight: 0 }}
              >
                <img
                  src={imgUrl(h)}
                  alt=""
                  className="bt-thumb"
                  data-active={i === imageIndex}
                  width={52}
                  height={52}
                />
              </button>
            ))}
          </div>
        )}
      </div>

      <aside className="bt-ovl-meta">
        <div className="bt-ovl-head">
          <b>{node.kind === 'edit' ? 'Refine' : 'Generation'}</b>
          <small>
            {node.images.length > 1 ? `${imageIndex + 1} of ${node.images.length} variants` : nodeLabel(node)}
          </small>
        </div>
        <div className="bt-ovl-who">
          {node.engineId} · {node.costUsd > 0 ? `$${node.costUsd.toFixed(3)}` : 'free'}
        </div>

        <Ingredients brief={node.brief} brand={brand} />

        {parentShot && (
          <div className="bt-ctx">
            <button
              type="button"
              className="bt-ctx-chip"
              onClick={() => onSelect(parentShot.id)}
              title="Open the shot this came from"
            >
              {parentShot.images[0] && <img src={imgUrl(parentShot.images[0])} alt="" />}
              edited from <b style={{ color: 'var(--bt-fg)', fontWeight: 500 }}>{nodeLabel(parentShot)}</b>
            </button>
          </div>
        )}

        {/* What to do next, offered rather than hunted for. Every one of these
            already existed; they were just buried in tabs and menus. */}
        {node.status === 'done' && node.images.length > 0 && (
          <div className="bt-sugg">
            <button type="button" className="bt-s bt-s-primary" onClick={onLift} disabled={lifting}>
              {lifting ? <Spinner size="1" /> : <PencilSimple size={12} />} Make text editable
            </button>
            <button type="button" className="bt-s" onClick={onAddLayer}>
              <Plus size={12} /> Add text
            </button>
            {node.brief && (
              <button type="button" className="bt-s" onClick={() => onRemix(node)}>
                <ArrowsClockwise size={12} /> Remix this brief
              </button>
            )}
            <button type="button" className="bt-s" onClick={() => setExportOpen(true)}>
              <DownloadSimple size={12} /> Export
            </button>
          </div>
        )}

        <div className="bt-ovl-body">
          <Inspector
            node={node.kind !== 'root' ? node : null}
            nodes={nodes}
            imageIndex={imageIndex}
            onChanged={onChanged}
            brand={brand}
            layers={layers}
            selectedLayerId={selectedLayerId}
            onSelectLayer={onSelectLayer}
            onLayersChange={onLayersChange}
            onAddLayer={onAddLayer}
            onLift={onLift}
            lifting={lifting}
            tab={tab}
            onTabChange={onTabChange}
            onExport={() => setExportOpen(true)}
          />
        </div>

        <div className="bt-ovl-edit">
          <Composer
            projectId={projectId}
            brand={brand}
            engines={engines}
            parent={node}
            shots={nodes}
            costLine={false}
            onQueued={onChanged}
          />
        </div>
      </aside>
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} hash={hash} baseName={baseName} layers={layers} />
    </div>,
    document.body,
  );
}

/**
 * What went into the shot, named. A brief already stores its tokens, so the
 * ingredients are a read of the record rather than a guess from the pixels.
 */
function Ingredients({ brief, brand }: { brief: TreeNode['brief']; brand: Brand | null }) {
  const { looks } = useAppData();

  const tokens = brief?.tokens ?? [];
  if (!tokens.length) return null;
  const products: any[] = (brand?.json?.products ?? []) as any[];
  const cast: any[] = (brand?.json?.characters ?? []) as any[];

  type Chip = { key: string; kind: string; label: string; thumb?: string | null; swatch?: string };
  const chips: Chip[] = tokens.flatMap((t: any): Chip[] => {
    if (t?.t === 'product') {
      const p = products.find((x) => x.id === t.id);
      return [{ key: `p${t.id}`, kind: 'product', label: p?.name ?? 'product', thumb: assetUrl(p?.shots?.[0]?.file) }];
    }
    if (t?.t === 'character') {
      const c = cast.find((x) => x.id === t.id);
      return [{ key: `h${t.id}`, kind: 'cast', label: c?.name ?? 'someone', thumb: assetUrl(c?.shots?.[0]?.file) }];
    }
    if (t?.t === 'template') {
      const l = looks.find((x) => x.id === t.id);
      return [{ key: `t${t.id}`, kind: 'look', label: l?.name ?? t.id, thumb: l?.previewUrl ?? null }];
    }
    if (t?.t === 'color') {
      return [{ key: `c${t.hex}`, kind: 'color', label: t.name ?? t.hex, swatch: t.hex }];
    }
    return [];
  });
  if (!chips.length) return null;

  return (
    <div className="bt-ingredients">
      {chips.map((c) => (
        <span className="bt-ingredient" key={c.key} data-kind={c.kind} title={`${c.kind}: ${c.label}`}>
          {c.thumb ? <img src={c.thumb} alt="" /> : c.swatch ? <i style={{ background: c.swatch }} /> : null}
          {c.label}
        </span>
      ))}
    </div>
  );
}
