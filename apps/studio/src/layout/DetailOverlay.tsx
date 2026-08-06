import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { FocusScope } from '@radix-ui/react-focus-scope';
import {
  ArrowsClockwise,
  GitBranch,
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
  XCircle,
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
import { CompareDialog } from './CompareDialog.js';
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
  onCancel,
  onChanged,
  onRemix,
  onBranch,
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
  onCancel: (n: TreeNode) => void;
  onChanged: () => Promise<void> | void;
  onRemix: (n: TreeNode) => void;
  /** Point the brief at this shot and stand back so you can see it. */
  onBranch: (n: TreeNode) => void;
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
  const root = useMemo(() => nodes.find((n) => n.kind === 'root') ?? null, [nodes]);
  const parent = node.parentId ? byId.get(node.parentId) : null;
  const parentShot = parent && parent.kind !== 'root' ? parent : null;
  const { push } = useToasts();
  const [working, setWorking] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
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
      className="sc-fr"
      data-current={current}
      data-failed={n.status === 'error' || (!n.images[0] && n.status !== 'running' && n.status !== 'cancelled')}
      data-cancelled={n.status === 'cancelled' && !n.images[0]}
      title={nodeLabel(n)}
      onClick={() => onSelect(n.id)}
    >
      {n.images[0] ? (
        <img src={imgUrl(n.images[0])} alt="" />
      ) : n.status === 'running' ? (
        <span className="sc-shimmer" />
      ) : n.status === 'cancelled' ? (
        <XCircle size={13} />
      ) : (
        <WarningCircle size={13} />
      )}
      {n.kept && (
        <span className="sc-fr-star">
          <Star size={11} weight="fill" />
        </span>
      )}
    </button>
  );

  return createPortal(
    <FocusScope trapped asChild>
      <div className="sc-ovl" role="dialog" aria-modal="true" aria-label={nodeLabel(node)}>
        <div className="sc-ovl-winbar">
          <button type="button" className="sc-icon-btn" onClick={onClose} aria-label="Close" title="Close (esc)">
            <X size={13} />
          </button>
          {/* These step siblings, which are whole runs off the same parent, so
            they are versions. Variants are the images inside one run and are
            stepped on the stage with [ and ]. */}
          <button
            type="button"
            className="sc-icon-btn"
            disabled={sibIndex <= 0}
            style={sibIndex <= 0 ? { opacity: 0.4 } : undefined}
            onClick={() => sibIndex > 0 && onSelect(siblings[sibIndex - 1].id)}
            aria-label="Previous version"
            title="Previous version"
          >
            <CaretLeft size={13} />
          </button>
          <button
            type="button"
            className="sc-icon-btn"
            disabled={sibIndex >= siblings.length - 1}
            style={sibIndex >= siblings.length - 1 ? { opacity: 0.4 } : undefined}
            onClick={() => sibIndex < siblings.length - 1 && onSelect(siblings[sibIndex + 1].id)}
            aria-label="Next version"
            title="Next version"
          >
            <CaretRight size={13} />
          </button>
        </div>

        <div className="sc-ovl-strip">
          <span className="sc-eyebrow">Lineage</span>
          {ancestors.map((a) => (
            <span key={a.id} style={{ display: 'contents' }}>
              {frame(a)}
              <span className="sc-wire" />
            </span>
          ))}
          {frame(node, true)}
          {children.length > 0 && (
            <>
              <span className="sc-wire" />
              <span className="sc-sib-row">{children.slice(0, 4).map((c) => frame(c))}</span>
            </>
          )}
        </div>

        <div className="sc-ovl-stage">
          {node.status === 'done' && node.images.length > 0 && (
            <div className="sc-ovl-tools">
              <span
                className="sc-ovl-cost"
                title={
                  node.costUsd > 0 ? `$${node.costUsd.toFixed(3)} of your API budget` : 'Generated on a free engine'
                }
              >
                <Coin size={13} />
                {node.costUsd > 0 ? `$${node.costUsd.toFixed(2)}` : 'Free'}
              </span>
              <button
                type="button"
                className="sc-icon-btn"
                onClick={() => setExportOpen(true)}
                aria-label="Export"
                title="Export"
              >
                {working ? <Spinner size="1" /> : <DownloadSimple size={14} />}
              </button>
              <button
                type="button"
                className="sc-icon-btn"
                onClick={() =>
                  void api
                    .keep(node.id, !node.kept)
                    .then(onChanged)
                    .catch((e) =>
                      push({ kind: 'error', title: 'Could not update keeper status', detail: String(e.message ?? e) }),
                    )
                }
                aria-label={node.kept ? 'Remove from keepers' : 'Keep'}
                title={node.kept ? 'Keeper' : 'Keep'}
                style={node.kept ? { color: 'var(--sc-star)' } : undefined}
              >
                <Star size={14} weight={node.kept ? 'fill' : 'regular'} />
              </button>
              {parentShot?.images[0] && (
                // Compare used to mean "switch to a tab called Info and scroll",
                // which is why nobody found the one feature that answers what the
                // model changed without being asked. It is an action, so it is a
                // button, next to the shot it is about.
                <button
                  type="button"
                  className="sc-icon-btn"
                  onClick={() => setCompareOpen(true)}
                  aria-label="Compare with the shot this came from"
                  title="Compare with source"
                >
                  <ArrowsLeftRight size={14} />
                </button>
              )}
              <button
                type="button"
                className="sc-icon-btn"
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
            onCancel={() => onCancel(node)}
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
                    className="sc-thumb"
                    data-active={i === imageIndex}
                    width={52}
                    height={52}
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        <aside className="sc-ovl-meta">
          <div className="sc-ovl-head">
            <b>{node.kind === 'edit' ? 'Refine' : 'Generation'}</b>
            <small>
              {node.images.length > 1 ? `${imageIndex + 1} of ${node.images.length} variants` : nodeLabel(node)}
            </small>
          </div>
          <div className="sc-ovl-who">
            {node.engineId} · {node.costUsd > 0 ? `$${node.costUsd.toFixed(3)}` : 'free'}
          </div>

          <Ingredients brief={node.brief} brand={brand} />

          {parentShot && (
            <div className="sc-ctx">
              <button
                type="button"
                className="sc-ctx-chip"
                onClick={() => onSelect(parentShot.id)}
                title="Open the shot this came from"
              >
                {parentShot.images[0] && <img src={imgUrl(parentShot.images[0])} alt="" />}
                edited from <b style={{ color: 'var(--sc-fg)', fontWeight: 500 }}>{nodeLabel(parentShot)}</b>
              </button>
            </div>
          )}

          {/* What to do next, offered rather than hunted for. Every one of these
            already existed; they were just buried in tabs and menus. */}
          {node.status === 'done' && node.images.length > 0 && (
            <div className="sc-sugg">
              <button type="button" className="sc-s sc-s-primary" onClick={onLift} disabled={lifting}>
                {lifting ? <Spinner size="1" /> : <PencilSimple size={12} />} Make text editable
              </button>
              <button type="button" className="sc-s" onClick={onAddLayer}>
                <Plus size={12} /> Add text
              </button>
              <button type="button" className="sc-s" onClick={() => onBranch(node)}>
                <GitBranch size={12} /> Branch from this
              </button>
              {node.brief && (
                <button type="button" className="sc-s" onClick={() => onRemix(node)}>
                  <ArrowsClockwise size={12} /> Remix this brief
                </button>
              )}
              <button type="button" className="sc-s" onClick={() => setExportOpen(true)}>
                <DownloadSimple size={12} /> Export
              </button>
            </div>
          )}

          <div className="sc-ovl-body">
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
              onCompare={parentShot?.images[0] ? () => setCompareOpen(true) : undefined}
            />
          </div>

          <div className="sc-ovl-edit">
            {/* In here the target is the whole screen, so it is stated rather
              than chosen: `target` is this shot and there is no chip, because
              there is nothing else this composer could be talking about. The
              root is the fallback for the cases that cannot branch, so a look
              or a non-editing engine still makes a new shot rather than filing
              one under a shot it never used. */}
            <Composer
              projectId={projectId}
              brand={brand}
              engines={engines}
              parent={root}
              target={node}
              shots={nodes}
              // an edit/regen submitted from inside the overlay used to only
              // reload the tree in place, leaving you looking at the shot you
              // just replaced; wait for the new node to actually exist, then
              // reuse the same in-overlay navigation the lineage filmstrip
              // and Prev/Next already use to land on it
              onQueued={async (id) => {
                await onChanged();
                if (id) onSelect(id);
              }}
            />
          </div>
        </aside>
        <ExportDialog open={exportOpen} onOpenChange={setExportOpen} hash={hash} baseName={baseName} layers={layers} />
        {parentShot?.images[0] && (
          <CompareDialog
            open={compareOpen}
            onOpenChange={setCompareOpen}
            a={parentShot}
            b={node}
            imageA={parentShot.images[0]}
            imageB={hash}
          />
        )}
      </div>
    </FocusScope>,
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
      return [
        {
          key: `t${t.id}`,
          kind: 'look',
          label: l?.name ?? 'a look no longer in the catalog',
          thumb: l?.previewUrl ?? null,
        },
      ];
    }
    if (t?.t === 'color') {
      return [{ key: `c${t.hex}`, kind: 'color', label: t.name ?? t.hex, swatch: t.hex }];
    }
    return [];
  });
  if (!chips.length) return null;

  return (
    <div className="sc-ingredients">
      {chips.map((c) => (
        <span className="sc-ingredient" key={c.key} data-kind={c.kind} title={`${c.kind}: ${c.label}`}>
          {c.thumb ? <img src={c.thumb} alt="" /> : c.swatch ? <i style={{ background: c.swatch }} /> : null}
          {c.label}
        </span>
      ))}
    </div>
  );
}
