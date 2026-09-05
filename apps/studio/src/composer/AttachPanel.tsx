import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useSearchParams } from 'react-router';
import type { Brand, FeedNode } from '../api.js';
import { PHONE, useMediaQuery } from '../useMediaQuery.js';
import { useSheetDrag } from '../useSheetDrag.js';
import { AttachBody } from './attach/AttachBody.js';
import { NAV_KEYS, type AttachCard, type AttachTab } from './attach/attachRules.js';
import { keepCaret } from './line.js';

export type { AttachTab } from './attach/attachRules.js';

export interface AttachPanelProps {
  brand: Brand;
  shots: FeedNode[];
  initialTab?: AttachTab;
  /** For the opener's aria-controls. */
  id?: string;
  /** The category of whichever product is already in the brief, if any — see compat.ts. */
  activeProductCategory?: string | null;
  /**
   * A refine is armed on the hub, so a scene cannot join: it would start a
   * new shot, and silently trading the armed refine for a scene chip is the
   * mode-flip-as-side-effect this panel refuses to do. The scene tiles sit
   * out — visible, dimmed, disabled — and a helper line says how to use one:
   * end the refine first. Deliberately NOT the overlay composer's rule,
   * where there is no armed chip to lose and a scene plainly flips the
   * button to Generate.
   */
  refining?: boolean;
  /**
   * The shot already carries as many identities as one shot takes: every
   * identity tile sits out, dimmed and inert, and this is the sentence that
   * says why, on hover, so the grid never has to move to explain itself.
   * Colours are not identities and stay live.
   */
  full?: string | null;
  /** What the shot already holds, by identity key. */
  attached: ReadonlySet<string>;
  onPick: (card: AttachCard) => void;
  onUpload: () => void;
  /**
   * `restore`: whether the composer should put the caret back in the brief.
   * The anchored panel asks for it when the close came from inside it; the
   * phone sheet never does, because focusing the brief raises the keyboard.
   */
  onClose: (o: { restore: boolean }) => void;
}

/**
 * The "+" in the composer: add something to this shot.
 *
 * One body, two shells. On a desktop it is the anchored panel above the
 * composer, non-modal on purpose: it stays open for multi-attach, the brief
 * stays editable behind it, and because its mousedown never takes the caret
 * a pick lands exactly where you were typing. On a phone it is a sheet under
 * the thumb, on the shell the shot settings and the chip picker already use.
 */
export function AttachPanel(props: AttachPanelProps) {
  const phone = useMediaQuery(PHONE);
  const [tab, setTab] = useState<AttachTab>(props.initialTab ?? 'All');
  useEffect(() => {
    setTab(props.initialTab ?? 'All');
  }, [props.initialTab]);
  // The creation dialog lives in the URL now, so "is something stacked on top
  // of me" is a question the URL answers rather than a boolean this panel has
  // to remember to keep in sync.
  const [params] = useSearchParams();
  const creating = params.get('new') !== null;

  const body = (restore: boolean) => (
    <AttachBody
      brand={props.brand}
      shots={props.shots}
      tab={tab}
      onTab={setTab}
      activeProductCategory={props.activeProductCategory}
      refining={props.refining}
      full={props.full}
      attached={props.attached}
      phone={phone}
      onPick={props.onPick}
      onUpload={props.onUpload}
      onClose={() => props.onClose({ restore })}
    />
  );

  return phone ? (
    <AttachSheet creating={creating} onClose={() => props.onClose({ restore: false })}>
      {body(false)}
    </AttachSheet>
  ) : (
    <AttachDock id={props.id} creating={creating} onClose={props.onClose}>
      {body(true)}
    </AttachDock>
  );
}

// ---------------------------------------------------------------- desktop

/**
 * Anchored above the composer at its full width. Non-modal: no focus trap,
 * no scrim, no aria-modal. Escape closes it from anywhere, an outside click
 * closes it, and the composer decides what gets focus afterwards.
 */
function AttachDock({
  id,
  creating,
  onClose,
  children,
}: {
  id?: string;
  creating: boolean;
  onClose: (o: { restore: boolean }) => void;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const close = () => onClose({ restore: !!rootRef.current?.contains(document.activeElement) });
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // the creation dialog is a real Radix Dialog stacked on top: its own
      // Escape closes it; this only steps in once nothing is on top
      if (e.key === 'Escape' && !creating) {
        e.stopPropagation();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [creating]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      // same reason: the creation dialog portals to document.body, so a click
      // inside it — its input, its own close button — reads as "outside
      // .sc-attachpanel" and closed both the dialog and the panel underneath it
      if (creating) return;
      const t = e.target as HTMLElement;
      if (!t.closest('.sc-attachpanel') && !t.closest('.sc-attach-toggle')) closeRef.current();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [creating]);

  return (
    <div
      ref={rootRef}
      className="sc-attachpanel"
      role="dialog"
      id={id}
      aria-label="Add to shot"
      onMouseDownCapture={keepCaret}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- phone

/**
 * A sheet under the thumb, on the shell the shot settings already established.
 *
 * It borrows `.sc-shotsheet` wholesale rather than growing a second sheet, so
 * the drag, both animations, the reduced-motion rule and the scrollbar gutter
 * are the ones already written and already tested.
 */
function AttachSheet({ creating, onClose, children }: { creating: boolean; onClose: () => void; children: ReactNode }) {
  const { sheet, grip } = useSheetDrag(onClose);
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="sc-shotsheet-scrim" />
        <Dialog.Content
          ref={sheet}
          className="sc-shotsheet sc-attachsheet"
          aria-describedby={undefined}
          // Radix focuses the first tabbable thing it finds, which is the
          // search field, which raises the keyboard over the grid the sheet
          // exists to show. Focus the sheet itself instead: the trap and
          // Escape still work, and the field waits to be tapped.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            sheet.current?.focus({ preventScroll: true });
          }}
          // Radix would hand focus back to the "+", which sits beside a
          // contenteditable; the composer decides, and on a phone it decides
          // not to raise the keyboard.
          onCloseAutoFocus={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            if (!creating) onClose();
          }}
          // The shot overlay listens on the window for the same Escape and
          // the same arrows. Nothing typed into this sheet is for it.
          onKeyDown={(e) => {
            if (e.key === 'Escape' || NAV_KEYS.has(e.key)) e.stopPropagation();
          }}
        >
          <div className="sc-shotsheet-grip" {...grip}>
            <span className="sc-shotsheet-bar" aria-hidden />
            <Dialog.Title className="sc-vh">Add to shot</Dialog.Title>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
