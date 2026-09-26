import { FocusScope } from '@radix-ui/react-focus-scope';
import { X } from '@phosphor-icons/react';
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Tip } from '../../layout/Tip.js';
import { PREF, useLocalPref } from '../../prefs.js';
import { useDockHeight } from '../../useDockHeight.js';

/**
 * How wide the rail may be made.
 *
 * The default is the width it has always had. The floor is where the rail's
 * cards stop reading as cards, the ceiling is where the stage stops being the
 * larger half, which is the whole point of the surface.
 */
const RAIL_DEFAULT = 500;
const RAIL_MIN = 400;
const RAIL_MAX = 760;
const clampRail = (w: number) => Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(w)));

/**
 * The studio's frame: a stage on the left and a rail on the right, over the
 * page it was opened from, the way the shot overlay stands over the hub. Not a
 * dialog in the house sense: the work takes minutes and has an address, so
 * the surface is a route and this only draws it.
 *
 * It knows nothing about what is made in it. The presenter studio puts a
 * conversation in the rail, the scene studio a direction desk; both hand this
 * their stage, their rail body and their foot, and get the same close, the
 * same head, the same seam and the same phone.
 *
 * On a phone the pieces stack into one column with one scroller and a foot
 * that stays put. Whether the stage is on a phone at all is the flow's call:
 * a conversation carries its own pictures, a scene has nothing else to look at.
 */
export function StudioFrame({
  title,
  headAction,
  stage,
  body,
  bodyProps,
  foot,
  overlay,
  kind,
  resizeLabel,
  onPaste,
  onDropFiles,
  onClose,
}: {
  title: string;
  /** The head's one quiet action. */
  headAction?: ReactNode;
  stage: ReactNode;
  body: ReactNode;
  /** Data attributes the flow's rail styles key on. */
  bodyProps?: Record<`data-${string}`, string | boolean | undefined>;
  foot: ReactNode;
  /** Dialogs the flow opens over the surface. */
  overlay?: ReactNode;
  /** Which studio this is, for the stylesheet: `data-kind` on the root. */
  kind: 'presenter' | 'scene';
  /** What the seam resizes, in the rail's own word. */
  resizeLabel: string;
  /** Pictures pasted anywhere on the surface. */
  onPaste?: (files: File[]) => void;
  /** Pictures dropped anywhere on the surface. */
  onDropFiles?: (files: File[]) => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  // The composer at the foot; on a phone the toast stack stands above it.
  const [footEl, setFootEl] = useState<HTMLDivElement | null>(null);
  useDockHeight(footEl, '--sc-pstudio-dock-h');

  // Escape leaves, as it does the shot overlay, unless a popover or a Confirm
  // inside already took the key (Radix marks its Escape handled).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [railW, setRailW] = useLocalPref<number>(PREF.pstudioRailW, RAIL_DEFAULT);
  const dragX = useRef(0);
  const dragRaf = useRef(0);
  const opener = useRef<HTMLElement | null>(null);

  return createPortal(
    <FocusScope
      trapped
      loop
      asChild
      onMountAutoFocus={(e) => {
        opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        e.preventDefault();
        rootRef.current?.focus({ preventScroll: true });
      }}
      // Focus goes back to what opened the studio. The page under it can put
      // that control back as a new element while the studio is open (the bar's
      // New follows the route), and focus then fell to the page body: the
      // control in its place takes it instead, else the page's main landmark.
      onUnmountAutoFocus={(e) => {
        if (opener.current?.isConnected) return;
        e.preventDefault();
        (document.querySelector<HTMLElement>('.sc-new-go') ?? document.getElementById('main'))?.focus();
      }}
    >
      <div
        ref={rootRef}
        tabIndex={-1}
        className="sc-pstudio"
        data-kind={kind}
        style={{ '--sc-pstudio-rail-set': `${clampRail(railW)}px` } as CSSProperties}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sc-pstudio-title"
        onDragOver={(e) => {
          if (onDropFiles && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
        }}
        onDrop={(e) => {
          // a drop target inside took it already (a Dropzone prevents default): once, not twice
          if (!onDropFiles || e.defaultPrevented) return;
          const files = Array.from(e.dataTransfer?.files ?? []);
          if (!files.length) return;
          e.preventDefault();
          onDropFiles(files);
        }}
        onPaste={(e) => {
          if (!onPaste) return;
          const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
          if (!files.length) return;
          e.preventDefault();
          onPaste(files);
        }}
      >
        <div className="sc-pstudio-grid">
          {/* The seam between stage and rail is the handle, exactly as it is
              between a shot and its details: drag to size the rail,
              double-click to put it back, arrow keys from the keyboard. During
              a drag only the custom property moves; the preference is written
              once, on release. */}
          {/* biome-ignore lint/a11y/useSemanticElements: an <hr> cannot be a focusable window splitter; ARIA's separator-as-widget pattern is exactly a focusable div with valuenow */}
          <div
            className="sc-pstudio-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label={resizeLabel}
            aria-valuemin={RAIL_MIN}
            aria-valuemax={RAIL_MAX}
            aria-valuenow={clampRail(railW)}
            tabIndex={0}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
              const root = e.currentTarget.closest<HTMLElement>('.sc-pstudio');
              // one write per frame: a write per pointer event forced a layout
              // per event for the whole rail while it was being dragged
              dragX.current = e.clientX;
              if (dragRaf.current) return;
              dragRaf.current = requestAnimationFrame(() => {
                dragRaf.current = 0;
                root?.style.setProperty('--sc-pstudio-rail-set', `${clampRail(window.innerWidth - dragX.current)}px`);
              });
            }}
            onPointerUp={(e) => {
              e.currentTarget.releasePointerCapture(e.pointerId);
              if (dragRaf.current) {
                cancelAnimationFrame(dragRaf.current);
                dragRaf.current = 0;
              }
              setRailW(clampRail(window.innerWidth - e.clientX));
            }}
            onDoubleClick={() => setRailW(RAIL_DEFAULT)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') setRailW((w) => clampRail(w + 16));
              else if (e.key === 'ArrowRight') setRailW((w) => clampRail(w - 16));
              else return;
              e.preventDefault();
            }}
          />
          <Tip label="Close (esc)">
            <button type="button" className="sc-pstudio-close" onClick={onClose} aria-label="Close">
              <X size={13} />
            </button>
          </Tip>
          <div className="sc-pstudio-head sc-newdlg-head">
            <h2 id="sc-pstudio-title" className="sc-newdlg-title">
              {title}
            </h2>
            {headAction}
            <button type="button" className="sc-set-close sc-newdlg-close" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          </div>
          <div className="sc-pstudio-scroll">
            {stage}
            <div className="sc-pstudio-body" {...bodyProps}>
              {body}
            </div>
          </div>
          <div className="sc-pstudio-foot sc-dock" ref={setFootEl}>
            {foot}
          </div>
        </div>
        {overlay}
      </div>
    </FocusScope>,
    document.body,
  );
}
