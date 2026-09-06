import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { FocusScope } from '@radix-ui/react-focus-scope';
import {
  Archive,
  ArrowCounterClockwise,
  ArrowsClockwise,
  CaretDown,
  CaretUp,
  CaretLeft,
  CaretRight,
  Check,
  CopySimple,
  DotsThree,
  DownloadSimple,
  PencilSimple,
  Star,
  TrashSimple,
  X,
} from '@phosphor-icons/react';
import { AlertDialog, Button, ContextMenu, DropdownMenu, Flex } from '@radix-ui/themes';
import { imgUrl, nodeLabel, type Brand, type EngineInfo, type FeedNode, thumbUrl } from '../api.js';
import { StageFrame } from './Stage.js';
import { Tip } from './Tip.js';
import { Composer } from './Composer.js';
import { useToasts } from '../toasts.js';
import { failureToast } from '../failure.js';
import { briefProse } from '../briefDiff.js';
import type { TokenNames } from '../feedRules.js';
import { attachableMarks, markLabel } from '../brand/marks.js';
import { briefTokens, serializeBriefTokens, type SentenceToken } from '../composer/line.js';
import { LineageStrip } from './detail/LineageStrip.js';
import { trailOf, whereIs } from './detail/historyRules.js';
import { useMediaQuery } from '../useMediaQuery.js';
import { ShotRail } from './detail/ShotRail.js';
import { useSwipe } from './detail/useSwipe.js';
import { neighborsOf } from '../feedRules.js';
import { ChipPreview } from '../composer/ChipPreview.js';
import { useHoverPreview } from '../composer/useHoverPreview.js';
import { BriefLine } from './detail/Ingredients.js';
import { useLineageOf } from './detail/useLineageOf.js';
import { useFullNode } from './detail/useFullNode.js';
import { PREF, useLocalPref } from '../prefs.js';

/**
 * The details panel's adjustable width. One bounded range, one reset value,
 * carried by the same `--sc-ovl-panel-w` custom property the stylesheet has
 * always read, so the grid, the header stop and the divider all follow one
 * number.
 */
/** Below this the panel stacks under the stage: the overlay's own one-column breakpoint. */
const STACKED = '(max-width: 1023px)';
const PANEL_MIN = 380;
const PANEL_MAX = 480;
const PANEL_DEFAULT = 380;
const clampPanel = (w: number) => Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.round(w)));

/** The scene a brief names, in either of the shapes briefs have carried it. */

/**
 * Full-screen takeover for one shot: lineage filmstrip left, stage with the
 * text editor center, merged inspector plus edit composer right. The version
 * tree stays legible here even though the canvas below is a flat masonry.
 */
export function DetailOverlay({
  node,
  rootId,
  items,
  loadMore,
  complete,
  brand,
  engines,
  projectId,
  onClose,
  onSelect,
  onRetry,
  onCancel,
  onKeep,
  onLanded,
  onRemix,
  onArchive,
  onUnarchive,
  onDelete,
  onRefined,
  tokenNames,
}: {
  node: FeedNode;
  /** The project's root, which a new shot from in here hangs off. */
  rootId: string | null;
  /** The feed's pages in its order: the rail lists them and the arrows walk them. */
  items: FeedNode[];
  /** The next page of the feed, asked for as the walk nears the loaded edge. */
  loadMore: () => void;
  /** Every page is in. */
  complete: boolean;
  /** The newest done shots, for the attach panel of the composer in here. */
  brand: Brand;
  engines: EngineInfo[];
  projectId: string;
  onClose: () => void;
  onSelect: (id: string) => void;
  onRetry: (n: FeedNode) => void;
  onCancel: (n: FeedNode) => void;
  onKeep: (n: FeedNode) => void;
  /** Shots that did not exist a moment ago were made from in here. */
  onLanded: (nodes: FeedNode[]) => void;
  onRemix: (n: FeedNode) => void;
  /** Settle once the record has moved or the refusal has been said, so the control can stop waiting. */
  onArchive: (n: FeedNode) => Promise<void> | void;
  onUnarchive: (n: FeedNode) => Promise<void> | void;
  onDelete: (n: FeedNode) => void;
  /** A shot was made from in here, so the workspace can follow the same thread. */
  onRefined?: (nodeId: string, kind?: 'generation' | 'edit') => void;
  /** Ids to display names, for the line saying which ingredient moved. */
  tokenNames: TokenNames;
}) {
  // One small indexed query each: the tree around this shot, and the whole
  // record behind its summary. Neither is waited for; the summary draws now.
  const { ancestors, children, history } = useLineageOf(node);
  const full = useFullNode(node);
  /** What the engine that ran this is called, so a failure can name it in a sentence. */
  const engine = useMemo(() => engines.find((e) => e.id === node.engineId), [engines, node.engineId]);
  const { push } = useToasts();
  /** The details panel's width, remembered across sessions. */
  const [panelW, setPanelW] = useLocalPref<number>(PREF.ovlPanelW, PANEL_DEFAULT);
  const dragX = useRef(0);
  const dragRaf = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  /** Whether the brief line has any chips to say: mirrors BriefLine's own
   *  null condition, so a token-less legacy shot never shows a bare label. */
  const hasContext = useMemo(
    () => (node.brief?.tokens ?? []).some((t: { t?: string }) => t?.t && t.t !== 'text' && t.t !== 'format'),
    [node.brief],
  );
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
  const said = useMemo(() => briefProse(full ?? node, proseNames), [full, node, proseNames]);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  /** A clipboard write in flight, and the moment after one that landed. */
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  /** An archive or a restore in flight. */
  const [archiving, setArchiving] = useState(false);
  /** The brief's own copy: in flight, and the moment after it landed. Same control, same feedback as the picture's. */
  const [briefCopying, setBriefCopying] = useState(false);
  const [briefCopied, setBriefCopied] = useState(false);
  // The picture on the stage changed under every one of these.
  useEffect(() => {
    setCopied(false);
    setBriefCopied(false);
    setArchiving(false);
  }, [node.id]);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(t);
  }, [copied]);
  useEffect(() => {
    if (!briefCopied) return;
    const t = setTimeout(() => setBriefCopied(false), 1400);
    return () => clearTimeout(t);
  }, [briefCopied]);
  /** Long briefs clamp at five lines; the toggle appears only when the clamp
   *  actually bites, so short briefs never grow a dangling "more". */
  const briefRef = useRef<HTMLDivElement>(null);
  const [briefOpen, setBriefOpen] = useState(false);
  const [briefOverflows, setBriefOverflows] = useState(false);
  useEffect(() => setBriefOpen(false), [node.id]);
  // Measured while the clamp is on (an open record never overflows, and a
  // verdict taken then would drop the release under the pointer that just
  // pressed it), and again whenever the box changes width, so a phone
  // sheet that settles its width after the first paint gets a fresh one.
  useLayoutEffect(() => {
    const el = briefRef.current;
    if (!el || briefOpen) return;
    const measure = () => setBriefOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [said, briefOpen]);
  /**
   * The image's whole history as a trail, the root first and every version
   * made from it after, worn under the stage and the same whichever version
   * is on the stage. The server carries the set; a server older than that
   * gets the old composition (the ancestors, this shot, its first
   * refinements). A refinement the pages already hold but the answer
   * predates is folded in by its parent; the rest of the reading (which tile
   * is the original, which number, which source) is `trailOf`'s.
   */
  const trail = useMemo(
    () => trailOf(history ?? [...ancestors, node, ...children.slice(0, 6)], node, items),
    [history, ancestors, node, children, items],
  );
  /** This shot's own step in the trail: what the panel calls the record. */
  const here = useMemo(() => trail.find((s) => s.node.id === node.id) ?? null, [trail, node.id]);
  /**
   * Stacked, the panel sits right under the trail, so its title is the line
   * that says where you are and the trail draws none of its own (the
   * stylesheet hides it at the same width). Side by side, the title is the
   * record's name and the trail carries the line, next to the tiles.
   */
  const stacked = useMediaQuery(STACKED);
  const title =
    trail.length > 1 && stacked
      ? whereIs(trail, node.id)
      : node.kind !== 'edit'
        ? 'Shot'
        : history && here
          ? here.label
          : 'Refinement';
  /** Where this shot sits in the feed you came from, and the shots either side: what the arrows, the wheel and a swipe step. */
  const step = useMemo(() => neighborsOf(items, node.id), [items, node.id]);
  // The next page of the feed as the walk nears the loaded edge: the same
  // page the grid would have fetched on scroll, and no other read.
  useEffect(() => {
    if (step.at >= 0 && !complete && items.length - step.at <= 6) loadMore();
  }, [step.at, items.length, complete, loadMore]);
  const stepTo = (dir: 1 | -1) => {
    const to = dir > 0 ? step.next : step.prev;
    if (to) onSelect(to.id);
  };
  /** Which shot an arrow would step to, as a picture: hovering an arrow peeks its neighbour. */
  const arrowPeek = useHoverPreview<{
    key: string;
    src: string;
    label: string;
    noun: string;
    el: HTMLElement;
    id: string;
  }>();
  const peekOn = (n: FeedNode | null, noun: string) =>
    n?.images[0]
      ? {
          onPointerEnter: (e: ReactPointerEvent<HTMLElement>) => {
            if (e.pointerType !== 'mouse') return;
            arrowPeek.open({
              key: n.id,
              src: thumbUrl(n.images[0], 'tile'),
              label: nodeLabel(n),
              noun,
              el: e.currentTarget,
              id: n.id,
            });
          },
          onPointerLeave: (e: ReactPointerEvent<HTMLElement>) => {
            if (e.pointerType === 'mouse') arrowPeek.close();
          },
        }
      : {};
  /** On a phone the picture itself steps shots: a swipe left asks for the next. */
  const swipe = useSwipe({ onLeft: () => stepTo(1), onRight: () => stepTo(-1) });
  // The card on an arrow shows the shot it would step to. After a step the
  // pointer is still on the arrow and the neighbour is a new shot, so the
  // card follows: the new neighbour at once, or nothing at the end of the
  // walk. Keyed on the shot alone: the pointer has not moved.
  useEffect(() => {
    const shown = arrowPeek.shown;
    if (!shown) return;
    const n = shown.noun === 'Next shot' ? step.next : step.prev;
    if (n?.images[0]) {
      arrowPeek.open({
        key: n.id,
        src: thumbUrl(n.images[0], 'tile'),
        label: nodeLabel(n),
        noun: shown.noun,
        el: shown.el,
        id: n.id,
      });
    } else arrowPeek.closeNow();
  }, [node.id]);
  // Pre-decode the tile derivative of the versions beside this one and the
  // shots either side. The stage paints that derivative under the original
  // while the original decodes, so a step to a neighbour shows a picture at
  // once. Only the neighbours, and released on cleanup: decoding every
  // version of a long chain at full resolution held a dozen bitmaps for a
  // strip of 52px thumbs.
  useEffect(() => {
    const at = trail.findIndex((s) => s.node.id === node.id);
    const near = [trail[at - 1]?.node, trail[at + 1]?.node, step.prev, step.next].filter(
      (n): n is FeedNode => !!n?.images[0],
    );
    const held = near.map((n) => {
      const img = new Image();
      img.decoding = 'async';
      img.src = thumbUrl(n.images[0], 'tile');
      img.decode?.().catch(() => {
        /* a version that cannot decode will simply load the old way */
      });
      return img;
    });
    return () => {
      for (const img of held) img.src = '';
    };
  }, [trail, node.id, step.prev, step.next]);
  const hash = node.images[0];
  const baseName =
    node.promptHead
      .slice(0, 40)
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9-]/g, '') || 'shot';

  /**
   * The original onto the clipboard, as the PNG the engine made.
   *
   * The blob is promised to the clipboard rather than awaited first: Safari
   * only lets the clipboard be written inside the click that asked, and an
   * await before the write is where that permission used to run out. From
   * the button, the tooltip says Copied and the glyph ticks; from the menu,
   * which has closed by then, a toast says it instead.
   */
  const copyImage = async (viaMenu = false) => {
    if (copying) return;
    setCopying(true);
    try {
      const png = fetch(imgUrl(hash)).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      if (viaMenu) push({ kind: 'success', title: 'Copied to clipboard' });
      else setCopied(true);
    } catch (e: any) {
      push(failureToast(e, 'Copy failed'));
    } finally {
      setCopying(false);
    }
  };

  /** Archive or restore, holding the control until the answer is in. */
  const putAway = async () => {
    if (archiving) return;
    setArchiving(true);
    try {
      await (node.archived ? onUnarchive(node) : onArchive(node));
    } finally {
      setArchiving(false);
    }
  };

  /**
   * Copy the prompt in the composer's own clipboard grammar: the HTML flavour
   * pastes back into any prompt line as real chips, the plain flavour pastes
   * everywhere else as the sentence you read. The chips are the record's
   * canonical tokens, the same set Edit the prompt rebuilds from.
   */
  const copyBrief = async () => {
    if (briefCopying) return;
    setBriefCopying(true);
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
      // the control itself says so, the way the picture's copy does
      setBriefCopied(true);
    } catch (e: any) {
      push(failureToast(e, 'Copy failed'));
    } finally {
      setBriefCopying(false);
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
  type Action = {
    key: string;
    /** The accessible name, and the tooltip's words. */
    label: string;
    icon: ReactNode;
    onClick: () => void;
    /** The same verb from the menu, when it has to say its result differently. */
    onMenu?: () => void;
    tint?: string;
    /** A toggle, and whether it is on. */
    on?: boolean;
    /** A request is out; the control waits and takes no second press. */
    busy?: boolean;
    /** Opens a dialog rather than acting at once. */
    dialog?: boolean;
    /** The tooltip's words for a moment after the verb landed, held open. */
    said?: string;
  };

  /** The ones that act on a file, so they are only offered where there is one. */
  const fileActions: Action[] = [
    {
      key: 'download',
      label: 'Download',
      icon: <DownloadSimple size={14} />,
      // The picture itself, as the file it is, in one click: the store
      // serves every image as a PNG, so the name can say so without asking.
      // This was a dialog of presets and a zip; nobody wanted the zip.
      onClick: () => {
        const a = document.createElement('a');
        a.href = imgUrl(hash);
        a.download = `${baseName}.png`;
        a.click();
      },
    },
    {
      key: 'keep',
      label: node.kept ? 'Remove from keepers' : 'Keep',
      icon: <Star size={14} weight={node.kept ? 'fill' : 'regular'} />,
      onClick: () => onKeep(node),
      // the keeper mark keeps its gold: the one on-state that is a colour
      tint: node.kept ? 'var(--sc-star)' : undefined,
      on: node.kept,
    },
    {
      key: 'copy',
      label: 'Copy image',
      icon: copied ? <Check size={14} weight="bold" /> : <CopySimple size={14} />,
      onClick: () => void copyImage(),
      onMenu: () => void copyImage(true),
      busy: copying,
      said: copied ? 'Copied' : undefined,
    },
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
      onClick: () => void putAway(),
      busy: archiving,
    },
    ...(node.archived
      ? [
          {
            key: 'delete',
            label: 'Delete permanently',
            icon: <TrashSimple size={14} />,
            onClick: () => setDeleteConfirmOpen(true),
            tint: 'var(--sc-red)',
            dialog: true,
          },
        ]
      : []),
  ];

  const hasImage = node.status === 'done' && node.images.length > 0;

  const canEditPrompt = !hasImage && node.kind !== 'edit' && !!node.brief;
  const actions: Action[] = hasImage ? [...fileActions, ...keepActions] : keepActions;
  /** The same verbs on a right click over the picture, the ones the header carries. */
  const stageMenu = hasImage ? (
    <ContextMenu.Content>
      {actions.map((a) => (
        <ContextMenu.Item
          key={a.key}
          onSelect={a.onMenu ?? a.onClick}
          disabled={a.busy}
          color={a.tint ? 'red' : undefined}
        >
          {a.icon}
          {a.label}
        </ContextMenu.Item>
      ))}
    </ContextMenu.Content>
  ) : undefined;

  return createPortal(
    // `loop` as well as `trapped`: without it Tab reached the last control and
    // then did nothing at all — eighteen further presses moved focus nowhere,
    // which reads as a frozen page rather than a contained one.
    <FocusScope
      trapped
      loop
      asChild
      // The surface takes focus on open, silently, the way every dialog here
      // does (app/dialogs.ts). Aimed at the first control instead, the Close
      // button, its tooltip opened on arrival and the first Escape closed the
      // tooltip rather than the shot.
      onMountAutoFocus={(e) => {
        e.preventDefault();
        rootRef.current?.focus({ preventScroll: true });
      }}
    >
      <div
        ref={rootRef}
        tabIndex={-1}
        className="sc-ovl"
        data-fb="shot-overlay"
        data-fb-node={node.id}
        role="dialog"
        aria-modal="true"
        aria-label={nodeLabel(node)}
        data-rail={items.length > 1 ? '' : undefined}
        style={{ '--sc-ovl-panel-w': `${clampPanel(panelW)}px` } as CSSProperties}
      >
        {/* The feed you came from, stood on end where there is room for it.
            A trail of one is not a trail: the old versions rail held a
            full-height column for a single thumbnail of the shot you were
            already looking at, so this one is absent below two, and it lists
            the feed rather than a lineage. */}
        {items.length > 1 && (
          <ShotRail shots={items} activeId={node.id} onSelect={onSelect} onEndReached={loadMore} complete={complete} />
        )}
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
            <Tip label="Close (esc)">
              <button type="button" className="sc-icon-btn" onClick={onClose} aria-label="Close">
                <X size={13} />
              </button>
            </Tip>
            {/* The arrows step the feed the rail lists, so the two agree on
                what "next" is. Hovering an arrow peeks the shot it would step
                to, which is the whole difference between stepping and
                guessing. They appear only when there is somewhere to step:
                two permanently dimmed arrows are two controls' worth of room
                spent saying "not available". */}
            {step.at >= 0 && items.length > 1 && (
              <>
                <button
                  type="button"
                  className="sc-icon-btn"
                  disabled={!step.prev}
                  onClick={() => step.prev && onSelect(step.prev.id)}
                  aria-label="Previous shot"
                  {...peekOn(step.prev, 'Previous shot')}
                >
                  <CaretLeft size={13} />
                </button>
                <button
                  type="button"
                  className="sc-icon-btn"
                  disabled={!step.next}
                  onClick={() => step.next && onSelect(step.next.id)}
                  aria-label="Next shot"
                  {...peekOn(step.next, 'Next shot')}
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
                {/* Each verb says its name on hover and on focus, and its
                    state on the control itself: a toggle that is on wears the
                    lit look and says so, a request in flight holds the cursor,
                    a verb that opens a dialog says that too. The words in the
                    tooltip are the words in aria-label, or for a moment the
                    result ("Copied"), held open so nothing else has to appear. */}
                {actions.map((a) => (
                  <Tip key={a.key} label={a.said ?? a.label} open={!!a.said}>
                    <button
                      type="button"
                      className="sc-icon-btn"
                      onClick={a.onClick}
                      aria-label={a.label}
                      aria-pressed={a.on === undefined ? undefined : a.on}
                      data-on={a.on || undefined}
                      aria-haspopup={a.dialog ? 'dialog' : undefined}
                      aria-busy={a.busy || undefined}
                      data-busy={a.busy || undefined}
                      style={a.tint ? { color: a.tint } : undefined}
                    >
                      {a.icon}
                    </button>
                  </Tip>
                ))}
              </div>

              <DropdownMenu.Root>
                <Tip label="More actions">
                  <DropdownMenu.Trigger>
                    <button type="button" className="sc-icon-btn sc-ovl-overflow" aria-label="More actions">
                      <DotsThree size={18} weight="bold" />
                    </button>
                  </DropdownMenu.Trigger>
                </Tip>
                <DropdownMenu.Content align="end" sideOffset={6}>
                  {actions.map((a) => (
                    <DropdownMenu.Item
                      key={a.key}
                      onSelect={a.onMenu ?? a.onClick}
                      disabled={a.busy}
                      color={a.tint ? 'red' : undefined}
                    >
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

        {arrowPeek.shown && (
          <ChipPreview
            key={arrowPeek.shown.key}
            anchor={arrowPeek.shown.el}
            kind="shot"
            noun={arrowPeek.shown.noun}
            src={arrowPeek.shown.src}
            label={arrowPeek.shown.label}
            onOpen={() => {
              const id = arrowPeek.shown?.id;
              arrowPeek.closeNow();
              if (id) onSelect(id);
            }}
            onHoverIn={arrowPeek.keep}
            onHoverOut={arrowPeek.close}
            onClose={arrowPeek.closeNow}
          />
        )}
        <div
          className="sc-ovl-stage"
          // the shot is capped so the version strip below it always has room;
          // the cap has to know whether that row is there
          data-takes={trail.length > 1 ? '' : undefined}
          {...swipe}
        >
          <StageFrame
            node={node}
            onRetry={() => onRetry(node)}
            onCancel={() => onCancel(node)}
            engineName={engine?.displayName}
            menu={stageMenu}
          />
          {/* The image's own history, right under the image: the original,
              a hairline, its refinements, this shot ringed, and one line
              saying where you are. Hovering peeks a step at a readable size
              with what it asked for; clicking moves the stage to it. */}
          {trail.length > 1 ? (
            <LineageStrip trail={trail} activeId={node.id} names={proseNames} onSelect={onSelect} />
          ) : (
            // The row is held even with nothing in it: the picture's cap and
            // its centre are the same on a shot with a history and one
            // without, so walking the feed never resizes the stage.
            <div className="sc-trail sc-trail-empty" aria-hidden />
          )}
        </div>

        {/* The seam between picture and panel is the handle: drag to size the
            panel, double-click to reset, arrow keys from the keyboard. During
            a drag only the CSS variable moves; the preference is written once,
            on release. It floats on the overlay root because the panel
            scrolls and the root does not. */}
        {/* biome-ignore lint/a11y/useSemanticElements: an <hr> cannot be a focusable window splitter; ARIA's separator-as-widget pattern is exactly a focusable div with valuenow */}
        <div
          className="sc-ovl-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the details panel"
          aria-valuemin={PANEL_MIN}
          aria-valuemax={PANEL_MAX}
          aria-valuenow={clampPanel(panelW)}
          tabIndex={0}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
            const root = e.currentTarget.closest<HTMLElement>('.sc-ovl');
            // one write per frame: a write per pointer event forced a layout
            // per event while the panel was being dragged
            dragX.current = e.clientX;
            if (dragRaf.current) return;
            dragRaf.current = requestAnimationFrame(() => {
              dragRaf.current = 0;
              root?.style.setProperty('--sc-ovl-panel-w', `${clampPanel(window.innerWidth - dragX.current)}px`);
            });
          }}
          onPointerUp={(e) => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
            e.currentTarget.releasePointerCapture(e.pointerId);
            setPanelW(clampPanel(window.innerWidth - e.clientX));
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            setPanelW(PANEL_DEFAULT);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setPanelW((w) => clampPanel(w + 16));
            else if (e.key === 'ArrowRight') setPanelW((w) => clampPanel(w - 16));
          }}
        />
        <aside className="sc-ovl-meta">
          {/* The sections scroll in a wrapper of their own and the composer is
              the column's foot outside it: inside the scroller, the reserved
              scrollbar gutter stacked on the composer's right inset (21px on
              the left, 31px on the right, measured). */}
          <div className="sc-ovl-scroll">
            {/* A typographic inspector: flat labeled sections divided by
              hairlines, nothing raised, nothing boxed. The engine id, wall
              time, "Free" and the filed-in sets that used to crowd the head
              are gone — facts about the run, not the work. Only money
              actually spent survives: a real price is a budget decision, a
              $0 label was noise. */}
            <div className="sc-ovl-head">
              {/* The record's name is its step in the trail under the picture,
                so the panel and the row speak one vocabulary; the number waits
                for the history, since a bare guess could be wrong on a branch. */}
              <b>{title}</b>
              {node.archived && <small className="sc-ovl-flag">archived</small>}
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
                <div className="sc-ovl-brief-head">
                  <span className="sc-eyebrow">Prompt</span>
                  {/* The same control as the verbs over the picture: a tooltip
                    that names it, a busy step, and "Copied" said on the control
                    rather than in a toast. Always there, in the eyebrow's row, so the
                    record starts under it and no chip can run beneath it. */}
                  <Tip label={briefCopied ? 'Copied' : 'Copy the prompt'} open={briefCopied || undefined}>
                    <button
                      type="button"
                      className="sc-icon-btn sc-ovl-copy"
                      aria-label="Copy the prompt"
                      aria-busy={briefCopying || undefined}
                      data-busy={briefCopying ? '' : undefined}
                      onClick={() => void copyBrief()}
                    >
                      {briefCopied ? <Check size={14} weight="bold" /> : <CopySimple size={14} />}
                    </button>
                  </Tip>
                </div>
                <div className="sc-brief-record">
                  <BriefLine
                    brief={node.brief}
                    prompt={full?.prompt ?? node.promptHead}
                    brand={brand}
                    saidRef={briefRef}
                    expanded={briefOpen}
                    clamped={briefOverflows && !briefOpen}
                  />
                </div>
                {(briefOverflows || briefOpen) && (
                  <button
                    type="button"
                    className="sc-s sc-ovl-more"
                    aria-expanded={briefOpen}
                    onClick={() => setBriefOpen((v) => !v)}
                  >
                    {briefOpen ? (
                      <>
                        <CaretUp size={12} /> Show less
                      </>
                    ) : (
                      <>
                        <CaretDown size={12} /> Show more
                      </>
                    )}
                  </button>
                )}
              </div>
            )}

            {/* A shot with a picture offers two verbs, repeat before change:
              Try again runs the same setup once more; Reuse setup starts a
              new shot from it in the composer, prompt, chips, shape and count,
              focused and announced, which is what people wanted for "like
              this one, but" that is not a refinement of this picture.
              Changing the picture itself is the refine field's job, and its
              prompt travels by Copy, chips and all. A shot that failed has
              no picture to refine: Edit the prompt puts its prompt back in the
              composer, which is exactly what a declined prompt or an unmakeable
              shape needs, and was the one route out a failed shot had no way to
              reach. A failed refinement gets no such verb: its ask was about a
              picture, and that picture is one step back on the trail with the
              refine field under it. Try again on a failure lives on the stage,
              which knows which failures re-running cannot fix. Archive and
              delete live once, in the bar over the shot. */}
            {(hasImage || canEditPrompt) && (
              <div className="sc-sugg">
                {canEditPrompt && (
                  <button
                    type="button"
                    className="sc-s"
                    onClick={() => onRemix(node)}
                    title="Put this prompt back in the composer, to change and run again"
                  >
                    <PencilSimple size={12} /> Edit the prompt
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
                {hasImage && (
                  <button
                    type="button"
                    className="sc-s"
                    onClick={() => onRemix(node)}
                    title="Start a new shot from this setup: same prompt, chips, shape and count, ready to change"
                  >
                    <ArrowsClockwise size={12} /> Reuse setup
                  </button>
                )}
              </div>
            )}

            {/* No versions section in here: the image's history wears the thumb
              strip under the stage. The sidebar does not own image navigation. */}

            {/* No station on a dead shot: the stage owns retrying a failure,
              and a Generate field down here made a failed refine read as a
              place to start over. Running keeps the held composer, so the
              field is already waiting when the picture lands. */}
          </div>
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
                parentId={rootId}
                target={node}
                // the variant on the stage is the one a refine works from
                sourceImage={hash}
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
                onQueued={(id, kind, _siblings, made) => {
                  onLanded(made ?? []);
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
        </aside>
      </div>
    </FocusScope>,
    document.body,
  );
}
