import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FocusScope } from '@radix-ui/react-focus-scope';
import {
  Archive,
  ArrowCounterClockwise,
  ArrowsClockwise,
  ArrowsLeftRight,
  CaretLeft,
  CaretRight,
  CopySimple,
  DotsThree,
  DownloadSimple,
  Star,
  TrashSimple,
  WarningCircle,
  X,
  XCircle,
} from '@phosphor-icons/react';
import { AlertDialog, Button, DropdownMenu, Flex } from '@radix-ui/themes';
import { api, imgUrl, nodeLabel, type Brand, type EngineInfo, type TreeNode } from '../api.js';
import { CompareDialog } from './CompareDialog.js';
import { ExportDialog } from './ExportDialog.js';
import { StageFrame } from './Stage.js';
import { Composer } from './Composer.js';
import { useToasts } from '../toasts.js';
import { failureToast } from '../failure.js';
import { briefProse, sourceImageOf } from '../briefDiff.js';
import type { TokenNames } from '../feedRules.js';
import { attachableMarks, markLabel } from '../brand/marks.js';
import { ChipPreview } from '../composer/ChipPreview.js';
import { briefTokens, serializeBriefTokens, type SentenceToken } from '../composer/line.js';
import { useHoverPreview } from '../composer/useHoverPreview.js';
import { BriefLine } from './detail/Ingredients.js';
import { useLineage } from './detail/useLineage.js';

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
  onArchive,
  onUnarchive,
  onDelete,
  onRefined,
  tokenNames,
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
  onArchive: (n: TreeNode) => void;
  onUnarchive: (n: TreeNode) => void;
  onDelete: (n: TreeNode) => void;
  /** A shot was made from in here, so the workspace can follow the same thread. */
  onRefined?: (nodeId: string, kind?: 'generation' | 'edit') => void;
  /** Ids to display names, for the line saying which ingredient moved. */
  tokenNames: TokenNames;
}) {
  const { ancestors, children, siblings, sibIndex, root, parentShot } = useLineage(nodes, node);
  /** What the engine that ran this is called, so a failure can name it in a sentence. */
  const engine = useMemo(() => engines.find((e) => e.id === node.engineId), [engines, node.engineId]);
  const { push } = useToasts();
  /** The image this refinement was made from, not merely the run's first. */
  const sourceHash = useMemo(() => sourceImageOf(node, parentShot), [node, parentShot]);
  /**
   * The scene this thread was shot in, for a refinement that names none of
   * its own: a refine keeps its world through the photograph, never as a
   * token, so the record said nothing about the one ingredient every refine
   * keeps. Nearest ancestor wins — a deeper re-scene overrides the original.
   */
  const worldTemplateId = useMemo(() => {
    if (node.kind !== 'edit') return null;
    const tplOf = (b: TreeNode['brief']) =>
      b?.tokens?.find((t: { t?: string; id?: string }) => t?.t === 'template')?.id ?? b?.templateId ?? null;
    if (tplOf(node.brief)) return null;
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const tid = tplOf(ancestors[i].brief);
      if (tid) return tid;
    }
    return null;
  }, [node, ancestors]);
  /** Whether the brief line has any chips to say: mirrors BriefLine's own
   *  null condition, so a token-less legacy shot never shows a bare label. */
  const hasContext = useMemo(() => {
    const own = (node.brief?.tokens ?? []).some((t: { t?: string }) => t?.t && t.t !== 'text' && t.t !== 'format');
    const carried = (((node.brief as { inherited?: unknown[] })?.inherited ?? []) as unknown[]).length > 0;
    return own || carried || !!worldTemplateId;
  }, [node.brief, worldTemplateId]);
  /** TokenNames plus the brand's marks, so the brief speaks every noun. */
  const proseNames = useMemo(() => {
    const marks = attachableMarks(brand.json);
    return {
      ...tokenNames,
      mark: (hash: string) => {
        const m = marks.find((x) => x.hash === hash);
        return m ? markLabel(brand.json, m) : null;
      },
    };
  }, [tokenNames, brand]);
  /** The whole sentence, nouns spoken: chips mid-sentence would otherwise
   *  leave holes in the prose ("holding a  in a  env"). The USING row stays
   *  the interactive statement of the same nouns. */
  const said = useMemo(() => briefProse(node, proseNames), [node, proseNames]);
  const [exportOpen, setExportOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  /** Long briefs clamp at five lines; the toggle appears only when the clamp
   *  actually bites, so short briefs never grow a dangling "more". */
  const briefRef = useRef<HTMLDivElement>(null);
  const [briefOpen, setBriefOpen] = useState(false);
  const [briefOverflows, setBriefOverflows] = useState(false);
  useEffect(() => setBriefOpen(false), [node.id]);
  useLayoutEffect(() => {
    const el = briefRef.current;
    setBriefOverflows(!!el && el.scrollHeight > el.clientHeight + 1);
  }, [said]);
  /** Hover peek over a version frame: the picture at a readable size before
   *  committing the panel to it. */
  const framePeek = useHoverPreview<{ key: string; src: string; label: string; el: HTMLElement; id: string }>();
  const hash = node.images[imageIndex] ?? node.images[0];
  const baseName =
    node.prompt
      .slice(0, 40)
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9-]/g, '') || 'shot';

  const copyImage = async () => {
    try {
      const blob = await (await fetch(imgUrl(hash))).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      push({ kind: 'success', title: 'Copied to clipboard' });
    } catch (e: any) {
      push(failureToast(e, 'Copy failed'));
    }
  };

  /**
   * Copy the brief in the composer's own clipboard grammar: the HTML flavour
   * pastes back into any brief line as real chips, the plain flavour pastes
   * everywhere else as the sentence you read. The chips are the setup's
   * canonical tokens (own plus carried, deduped) — the same set Reuse setup
   * rebuilds from.
   */
  const copyBrief = async () => {
    try {
      const tokens = node.brief ? briefTokens(node.brief as Parameters<typeof briefTokens>[0]) : null;
      if (!tokens || tokens.every((t) => t.t === 'text' && !t.v.trim())) {
        await navigator.clipboard.writeText(said);
      } else {
        const labelOf = (t: SentenceToken): string => {
          switch (t.t) {
            case 'text':
              return t.v;
            case 'product':
              return proseNames.product(t.id) ?? 'a product';
            case 'character':
              return proseNames.person(t.id) ?? 'a presenter';
            case 'template':
              return proseNames.scene(t.id) ?? 'a scene';
            case 'color':
              return t.name ?? t.hex;
            case 'ref':
              return 'reference image';
            case 'mark':
              return proseNames.mark?.(t.imageHash) ?? 'brand mark';
          }
        };
        const { text, html } = serializeBriefTokens(tokens, labelOf);
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([text], { type: 'text/plain' }),
            'text/html': new Blob([html], { type: 'text/html' }),
          }),
        ]);
      }
      push({ kind: 'success', title: 'Brief copied' });
    } catch (e: any) {
      push(failureToast(e, 'Copy failed'));
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

  /**
   * Everything you can do to the picture itself, as data.
   *
   * The header renders this twice — as a row of buttons where there is room,
   * and as one overflow menu where there is not — so a phone and a desktop
   * cannot end up offering different things, and adding an action never means
   * remembering to add it in two places. Order is priority order: what people
   * reach for most is first, and the destructive one is last.
   */
  type Action = { key: string; label: string; icon: ReactNode; onClick: () => void; tint?: string };

  /** The ones that act on a file, so they are only offered where there is one. */
  const fileActions: Action[] = [
    { key: 'export', label: 'Export', icon: <DownloadSimple size={14} />, onClick: () => setExportOpen(true) },
    {
      key: 'keep',
      label: node.kept ? 'Remove from keepers' : 'Keep',
      icon: <Star size={14} weight={node.kept ? 'fill' : 'regular'} />,
      onClick: () =>
        void api
          .keep(node.id, !node.kept)
          .then(onChanged)
          .catch((e) => push(failureToast(e, 'Could not update keeper status'))),
      tint: node.kept ? 'var(--sc-star)' : undefined,
    },
    { key: 'copy', label: 'Copy image', icon: <CopySimple size={14} />, onClick: () => void copyImage() },
    ...(sourceHash
      ? [
          {
            key: 'compare',
            label: 'Compare with source',
            icon: <ArrowsLeftRight size={14} />,
            onClick: () => setCompareOpen(true),
          },
        ]
      : []),
  ];

  /**
   * Putting a shot away is not a file action, and gating it on a finished
   * picture meant a failed shot opened onto a header with nothing in it but
   * Close — so the only way to get rid of one was to back out to the feed and
   * find it again. These are about the record, which exists either way.
   */
  const keepActions: Action[] = [
    {
      key: 'archive',
      label: node.archived ? 'Restore' : 'Archive',
      icon: node.archived ? <ArrowCounterClockwise size={14} /> : <Archive size={14} />,
      onClick: () => (node.archived ? onUnarchive(node) : onArchive(node)),
    },
    ...(node.archived
      ? [
          {
            key: 'delete',
            label: 'Delete permanently',
            icon: <TrashSimple size={14} />,
            onClick: () => setDeleteConfirmOpen(true),
            tint: 'var(--sc-red)',
          },
        ]
      : []),
  ];

  const hasImage = node.status === 'done' && node.images.length > 0;
  const actions: Action[] = hasImage ? [...fileActions, ...keepActions] : keepActions;

  /**
   * One step of the refinement drill: a thumb in the single row that reads
   * left to right as a descent, each version made from the one before it,
   * this shot ringed where the drill currently stands. Hovering peeks the
   * version at a readable size before the panel commits to it.
   */
  const drillRow = (n: TreeNode, current = false) => (
    <button
      type="button"
      className="sc-drill-row"
      data-fb-node={n.id}
      data-current={current}
      data-failed={n.status === 'error' || (!n.images[0] && n.status !== 'running' && n.status !== 'cancelled')}
      title={nodeLabel(n)}
      onClick={() => {
        framePeek.closeNow();
        onSelect(n.id);
      }}
      onPointerEnter={(e) =>
        e.pointerType === 'mouse' &&
        n.images[0] &&
        framePeek.open({ key: n.id, src: imgUrl(n.images[0]), label: nodeLabel(n), el: e.currentTarget, id: n.id })
      }
      onPointerLeave={(e) => e.pointerType === 'mouse' && framePeek.close()}
      onFocus={(e) =>
        e.currentTarget.matches(':focus-visible') &&
        n.images[0] &&
        framePeek.open({ key: n.id, src: imgUrl(n.images[0]), label: nodeLabel(n), el: e.currentTarget, id: n.id })
      }
    >
      {/* the thumb IS the step: no label, the hover peek carries the words */}
      <span className="sc-drill-thumb">
        {n.images[0] ? (
          <img src={imgUrl(n.images[0])} alt="" />
        ) : n.status === 'running' ? (
          <span className="sc-shimmer" />
        ) : n.status === 'cancelled' ? (
          <XCircle size={12} />
        ) : (
          <WarningCircle size={12} />
        )}
      </span>
      {n.kept && (
        <span className="sc-drill-star">
          <Star size={10} weight="fill" />
        </span>
      )}
    </button>
  );

  return createPortal(
    // `loop` as well as `trapped`: without it Tab reached the last control and
    // then did nothing at all — eighteen further presses moved focus nowhere,
    // which reads as a frozen page rather than a contained one.
    <FocusScope trapped loop asChild>
      <div
        className="sc-ovl"
        data-fb="shot-overlay"
        data-fb-node={node.id}
        data-fb-variant={imageIndex}
        role="dialog"
        aria-modal="true"
        aria-label={nodeLabel(node)}
        // A trail of one is not a trail. The rail held a full-height column for
        // a single thumbnail of the shot you were already looking at, which is
        // the sort of furniture that makes a screen feel unplanned.
      >
        {/* ONE header owns the top of this screen.

            It used to be two: a `position: fixed` bar carrying close and the
            version arrows, and a separate tools row that was the stage's own
            first child. Neither knew the other existed, so on a phone they
            landed on the same line and overlapped — measured at 67px on a
            320px screen and 32px on a 390px one, with "Next version" sitting
            entirely underneath the cost chip and the fixed bar painting over
            it. No amount of spacing fixes two layouts competing for one line.
            A single flex row with a left group and a right group cannot
            collide, at any width, by construction. */}
        <header className="sc-ovl-bar">
          <div className="sc-ovl-bar-l">
            <button type="button" className="sc-icon-btn" onClick={onClose} aria-label="Close" title="Close (esc)">
              <X size={13} />
            </button>
            {/* These step siblings, which are whole runs off the same parent,
                so they are versions. Variants are the images inside one run
                and are stepped on the stage with [ and ]. They appear only
                when there is somewhere to step: two permanently dimmed arrows
                are two controls' worth of room spent saying "not available". */}
            {siblings.length > 1 && (
              <>
                <button
                  type="button"
                  className="sc-icon-btn"
                  disabled={sibIndex <= 0}
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
                  onClick={() => sibIndex < siblings.length - 1 && onSelect(siblings[sibIndex + 1].id)}
                  aria-label="Next version"
                  title="Next version"
                >
                  <CaretRight size={13} />
                </button>
              </>
            )}
          </div>

          {actions.length > 0 && (
            <div className="sc-ovl-bar-r">
              {/* One list, two shells: buttons where the row is wide enough to
                  hold them, one overflow where it is not. Written once, so the
                  two can never drift apart or offer different things. */}
              <div className="sc-ovl-acts">
                {actions.map((a) => (
                  <button
                    type="button"
                    key={a.key}
                    className="sc-icon-btn"
                    onClick={a.onClick}
                    aria-label={a.label}
                    title={a.label}
                    style={a.tint ? { color: a.tint } : undefined}
                  >
                    {a.icon}
                  </button>
                ))}
              </div>

              <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                  <button type="button" className="sc-icon-btn sc-ovl-overflow" aria-label="More actions">
                    <DotsThree size={18} weight="bold" />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content align="end" sideOffset={6}>
                  {actions.map((a) => (
                    <DropdownMenu.Item key={a.key} onSelect={a.onClick} color={a.tint ? 'red' : undefined}>
                      {a.icon}
                      {a.label}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </div>
          )}
        </header>

        {/* Delete is confirmed from a dialog this header only opens, so the
            same action can sit in a menu item and in a button without two
            copies of the confirmation. */}
        <AlertDialog.Root open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <AlertDialog.Content maxWidth="420px">
            <AlertDialog.Title>Delete this shot permanently?</AlertDialog.Title>
            <AlertDialog.Description size="2">This cannot be undone.</AlertDialog.Description>
            <Flex gap="3" mt="4" justify="end">
              <AlertDialog.Cancel>
                <Button variant="soft" color="gray">
                  Cancel
                </Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action>
                <Button color="red" onClick={() => onDelete(node)}>
                  Delete permanently
                </Button>
              </AlertDialog.Action>
            </Flex>
          </AlertDialog.Content>
        </AlertDialog.Root>

        <div
          className="sc-ovl-stage"
          // the shot is capped so the row of takes below it always has room;
          // the cap has to know whether that row is there
          data-takes={node.status === 'done' && node.images.length > 1 ? '' : undefined}
        >
          <StageFrame
            node={node}
            imageIndex={imageIndex}
            onRetry={() => onRetry(node)}
            onCancel={() => onCancel(node)}
            engineName={engine?.displayName}
          />
          {node.status === 'done' && node.images.length > 1 && (
            <div className="sc-thumbs">
              {node.images.map((h, i) => (
                <button
                  type="button"
                  // index too: a run can hold the same content-addressed image
                  // twice, and the hash alone then collides as a key
                  // biome-ignore lint/suspicious/noArrayIndexKey: the run is append-only, so the take index is stable identity; it breaks the tie between duplicate hashes.
                  key={`${i}:${h}`}
                  className="sc-thumb-btn"
                  onClick={() => onImageIndex(i)}
                  aria-label={`Image ${i + 1}`}
                  aria-pressed={i === imageIndex}
                >
                  {/* the attributes stay as the pre-load intrinsic hint; the box
                      and the crop are the stylesheet's job, and were nobody's
                      until this rail stretched every portrait take it held */}
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
          {/* A typographic inspector: flat labeled sections divided by
              hairlines, nothing raised, nothing boxed. The engine id, wall
              time, "Free" and the filed-in sets that used to crowd the head
              are gone — facts about the run, not the work. Only money
              actually spent survives: a real price is a budget decision, a
              $0 label was noise. */}
          <div className="sc-ovl-head">
            <b>{node.kind === 'edit' ? 'Refined shot' : 'Shot'}</b>
            {node.archived && <small className="sc-ovl-flag">archived</small>}
            {/* which take of the run is on stage — refining works from it,
                and the ringed thumb under the picture is easy to miss */}
            {hasImage && node.images.length > 1 && (
              <small className="sc-ovl-take">
                take {imageIndex + 1} of {node.images.length}
              </small>
            )}
            {hasImage && node.costUsd > 0 && (
              <small className="sc-ovl-spend" title="Of your API budget">
                ${node.costUsd.toFixed(2)}
              </small>
            )}
          </div>

          {/* The whole record as one statement in the composer's voice: the
              typed sentence with its chips inline where they were said, and
              what the refinement carried riding after it. Long briefs clamp
              at five lines; "more" appears only when the clamp bites. */}
          {node.kind !== 'root' && (said || hasContext) && (
            <div className="sc-ovl-sec sc-ovl-brief">
              <span className="sc-eyebrow">Brief</span>
              <div className="sc-brief-record">
                <BriefLine
                  brief={node.brief}
                  prompt={node.prompt}
                  brand={brand}
                  worldTemplateId={worldTemplateId}
                  saidRef={briefRef}
                  expanded={briefOpen}
                />
              </div>
              {(briefOverflows || briefOpen) && (
                <button
                  type="button"
                  className="sc-ovl-more"
                  aria-expanded={briefOpen}
                  onClick={() => setBriefOpen((v) => !v)}
                >
                  {briefOpen ? 'less' : 'more'}
                </button>
              )}
              <button
                type="button"
                className="sc-ovl-copy"
                title="Copy the brief"
                aria-label="Copy the brief"
                onClick={() => void copyBrief()}
              >
                <CopySimple size={13} />
              </button>
            </div>
          )}

          {/* Reuse setup is offered on a failure too — changing the setup is
              exactly what a declined brief or an unmakeable shape needs, and it
              was the one route out that a failed shot had no way to reach.
              Try again is not: the stage panel already carries it, and it knows
              which failures re-running cannot fix. Compare, archive and delete
              live once, in the bar over the shot. */}
          {(hasImage || node.brief) && (
            <div className="sc-sugg">
              {node.brief && (
                <button
                  type="button"
                  className="sc-s"
                  onClick={() => onRemix(node)}
                  title="Put this shot's setup back in the brief, to change and run again"
                >
                  <ArrowsClockwise size={12} /> Reuse setup
                </button>
              )}
              {hasImage && (
                <button
                  type="button"
                  className="sc-s"
                  onClick={() => onRetry(node)}
                  title="Run the same setup again for a different take"
                >
                  <ArrowCounterClockwise size={12} /> Try again
                </button>
              )}
            </div>
          )}

          {/* The thread as a drill of refinements, anchored above the
              composer: one row, each version made from the one before the
              caret pointing at it, this shot ringed where the drill stands. */}
          {(ancestors.length > 0 || children.length > 0) && (
            <div className="sc-ovl-trail">
              <span className="sc-eyebrow">Versions</span>
              <div className="sc-ovl-drill">
                {[...ancestors, node, ...children.slice(0, 4)].map((n, i) => (
                  <span key={n.id} style={{ display: 'contents' }}>
                    {i > 0 && <CaretRight size={11} className="sc-drill-elbow" />}
                    {drillRow(n, n.id === node.id)}
                  </span>
                ))}
                {children.length > 4 && <span className="sc-drill-more">+{children.length - 4}</span>}
              </div>
            </div>
          )}

          {/* No station on a dead shot: the stage owns retrying a failure,
              and a Generate field down here made a failed refine read as a
              place to start over. Running keeps the held composer, so the
              field is already waiting when the picture lands. */}
          {(hasImage || node.status === 'running') && (
            <div className="sc-ovl-edit">
              {/* In here the target is the whole screen, so it is stated rather
              than chosen: `target` is this shot and there is no chip, because
              there is nothing else this composer could be talking about. The
              root is the fallback for the cases that cannot branch, so a look
              or a non-editing engine still makes a new shot rather than filing
              one under a shot it never used. No label and no divider: the
              island's own surface says where the work area starts. */}
              <Composer
                variant="overlay"
                projectId={projectId}
                brand={brand}
                engines={engines}
                parent={root}
                target={node}
                // the variant on the stage is the one a refine works from
                sourceImage={hash}
                shots={nodes}
                // The dock's composer is still mounted behind this one and there
                // is one saved draft per brand: without this, merely opening a
                // shot overwrote a half-typed brief with this composer's empty
                // sentence, and left its own target behind to be restored later
                // as a draft the person never wrote.
                persistDraft={false}
                // an edit/regen submitted from inside the overlay used to only
                // reload the tree in place, leaving you looking at the shot you
                // just replaced; wait for the new node to actually exist, then
                // reuse the same in-overlay navigation the lineage filmstrip
                // and Prev/Next already use to land on it
                onQueued={async (id, kind) => {
                  await onChanged();
                  if (id) onSelect(id);
                  // One thread, wherever it was pulled. Refining in here used to
                  // leave the workspace behind still pointed at nothing, so
                  // stepping back out and carrying on turned the next
                  // instruction into a brand new shot.
                  if (id) onRefined?.(id, kind);
                }}
              />
            </div>
          )}
          {framePeek.shown && (
            <ChipPreview
              key={framePeek.shown.key}
              anchor={framePeek.shown.el}
              kind="shot"
              src={framePeek.shown.src}
              label={framePeek.shown.label}
              onOpen={() => {
                const id = framePeek.shown?.id;
                framePeek.closeNow();
                if (id) onSelect(id);
              }}
              onHoverIn={framePeek.keep}
              onHoverOut={framePeek.close}
              onClose={framePeek.closeNow}
            />
          )}
        </aside>
        <ExportDialog open={exportOpen} onOpenChange={setExportOpen} hash={hash} baseName={baseName} />
        {parentShot && sourceHash && (
          <CompareDialog
            open={compareOpen}
            onOpenChange={setCompareOpen}
            a={parentShot}
            b={node}
            // the frame this refinement actually started from, so the drift
            // figure measures the change it made rather than the distance to
            // some other variant of the same run
            imageA={sourceHash}
            imageB={hash}
          />
        )}
      </div>
    </FocusScope>,
    document.body,
  );
}
