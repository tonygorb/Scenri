import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { useSearchParams } from 'react-router';
import type { Brand } from '../api.js';
import { PHONE, useMediaQuery } from '../useMediaQuery.js';

/** A thumb, not a mouse: focusing the brief raises a keyboard over the panel. */
const COARSE = '(pointer: coarse)';
import { AttachBody } from './attach/AttachBody.js';
import type { AttachCard, AttachTab } from './attach/attachRules.js';
import { keepCaret } from './line.js';

export type { AttachTab } from './attach/attachRules.js';

export interface AttachPanelProps {
  brand: Brand;
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
  /** A ticked tile pressed again: the chip comes back out of the shot. */
  onRemove: (card: AttachCard) => void;
  onUpload: () => void;
  /** Image files pasted into the picker: the same door as Upload image. */
  onFiles: (files: FileList) => void;
  /**
   * `restore`: whether the composer should put the caret back in the brief.
   * Asked for when the close came from inside the panel on a desktop; never
   * on a phone, because focusing the brief raises the keyboard.
   */
  onClose: (o: { restore: boolean }) => void;
}

/**
 * The "+" in the composer: add something to this shot.
 *
 * One panel, anchored above the composer at its full width, on every screen.
 * Non-modal on purpose: it stays open for multi-attach, the brief stays in
 * view and editable behind it, and because its mousedown never takes the
 * caret a pick lands exactly where you were typing. A phone gets the same
 * panel with thumb-sized controls and the keyboard dropped on open, so the
 * space above the composer is the panel's; a sheet was tried and covered the
 * very composer the picker adds to.
 */
export function AttachPanel(props: AttachPanelProps) {
  const phone = useMediaQuery(PHONE);
  const touch = useMediaQuery(COARSE);
  const [tab, setTab] = useState<AttachTab>(props.initialTab ?? 'All');
  useEffect(() => {
    setTab(props.initialTab ?? 'All');
  }, [props.initialTab]);
  // The creation dialog lives in the URL now, so "is something stacked on top
  // of me" is a question the URL answers rather than a boolean this panel has
  // to remember to keep in sync.
  const [params] = useSearchParams();
  const creating = params.get('new') !== null;

  return (
    <AttachDock id={props.id} phone={phone} touch={touch} creating={creating} onClose={props.onClose}>
      <AttachBody
        brand={props.brand}
        tab={tab}
        onTab={setTab}
        activeProductCategory={props.activeProductCategory}
        refining={props.refining}
        full={props.full}
        attached={props.attached}
        phone={phone}
        touch={touch}
        onPick={props.onPick}
        onRemove={props.onRemove}
        onUpload={props.onUpload}
        onFiles={props.onFiles}
        onClose={() => props.onClose({ restore: !touch })}
      />
    </AttachDock>
  );
}

/**
 * The shell: no focus trap, no scrim, no aria-modal. Escape closes it from
 * anywhere, an outside click closes it, and the composer decides what gets
 * focus afterwards.
 */
function AttachDock({
  id,
  phone,
  touch,
  creating,
  onClose,
  children,
}: {
  id?: string;
  phone: boolean;
  touch: boolean;
  creating: boolean;
  onClose: (o: { restore: boolean }) => void;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const close = () => onClose({ restore: !touch && !!rootRef.current?.contains(document.activeElement) });
  const closeRef = useRef(close);
  closeRef.current = close;

  // A touch screen opens this over the brief with the software keyboard up,
  // which leaves the panel a strip. Drop the keyboard: the caret is
  // remembered and a pick still lands where it was; the field waits to be tapped.
  useEffect(() => {
    if (touch) (document.activeElement as HTMLElement | null)?.blur?.();
  }, [touch]);

  // The room above the composer is the panel's, and on a phone it is not a
  // constant: a four-line brief or a keyboard moves the composer up. Measure
  // it (the top bar stays clear) and hand it to the stylesheet; a resize, a
  // keyboard and a growing brief all re-measure.
  useLayoutEffect(() => {
    const el = rootRef.current;
    const host = el?.parentElement;
    if (!phone || !el || !host) return;
    const measure = () => {
      const topbar =
        Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sc-topbar-h')) || 0;
      const room = host.getBoundingClientRect().top - topbar - 16;
      el.style.setProperty('--ap-avail', `${Math.max(160, Math.round(room))}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
    };
  }, [phone]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || creating) return;
      // the creation dialog is a real Radix Dialog stacked on top: its own
      // Escape closes it; this only steps in once nothing is on top.
      // A search with text in it takes the first Escape for itself (the body
      // clears it); the next one closes the panel.
      const a = document.activeElement;
      if (a instanceof HTMLInputElement && rootRef.current?.contains(a) && a.value) return;
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [creating]);

  /**
   * The caret guard cancels every mousedown in the panel so the brief keeps
   * its caret, which also meant nothing in the panel could ever take focus
   * away from the search field: once tapped it wore its ring until the panel
   * closed. A press anywhere else in the panel lets the field go first.
   */
  const onMouseDownCapture = (e: ReactMouseEvent) => {
    const a = document.activeElement;
    const target = e.target as HTMLElement;
    if (a instanceof HTMLInputElement && rootRef.current?.contains(a) && !target.closest('input')) a.blur();
    keepCaret(e);
  };

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
      onMouseDownCapture={onMouseDownCapture}
    >
      {children}
    </div>
  );
}
