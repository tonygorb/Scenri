import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeft, ArrowRight, Check, Plus, Trash } from '@phosphor-icons/react';
import { nextHex, normalizeHex, type Swatch } from '../brand/palette.js';
import { ColorPicker } from '../layout/ColorPicker.js';
import { PHONE, useMediaQuery } from '../useMediaQuery.js';
import { useSheetDrag } from '../useSheetDrag.js';
import { panelStyle, placePanel, type Placed } from './anchorPanel.js';
import type { CloseReason } from './IngredientPicker.js';
import type { SentenceToken } from './line.js';

/** Narrower than the catalog panel: a palette is a list, not a grid of thumbs. */
const MENU_W = 260;

export interface ColorChipMenuProps {
  /** The chip itself. Live DOM, because React does not own the line's children. */
  anchor: HTMLElement;
  currentHex: string | null;
  currentName?: string;
  palette: Swatch[];
  onPick: (token: Extract<SentenceToken, { t: 'color' }>, opts?: { live?: boolean }) => void;
  onRemove: () => void;
  onClose: (reason: CloseReason) => void;
  /** Step the chip through the sentence; the sheet's touch reorder path. */
  onMove?: (dir: -1 | 1) => void;
}

/**
 * Change the colour a chip already holds.
 *
 * Not IngredientPicker: a brand palette is a handful of named swatches, not a
 * catalog you search. Same shell — chip-anchored panel, phone sheet, caret
 * handed back on close — so the gesture is the one already learned.
 */
export function ColorChipMenu(props: ColorChipMenuProps) {
  const phone = useMediaQuery(PHONE);
  // Move buttons are the sheet's touch reorder path; a pointer has the drag.
  return phone ? <ColorSheet {...props} /> : <ColorPanel {...{ ...props, onMove: undefined }} />;
}

function sameHex(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = a ? normalizeHex(a) : null;
  const right = b ? normalizeHex(b) : null;
  return !!left && left === right;
}

function ColorBody({ currentHex, currentName, palette, onPick, onRemove, onClose, onMove }: ColorChipMenuProps) {
  const rows = useMemo(() => {
    const seen = new Set<string>();
    const out: Swatch[] = [];
    const push = (s: Swatch) => {
      const hex = normalizeHex(s.hex);
      if (!hex || seen.has(hex)) return;
      seen.add(hex);
      out.push({ ...s, hex });
    };
    const current = currentHex ? normalizeHex(currentHex) : null;
    if (current && !palette.some((s) => sameHex(s.hex, current))) {
      push({ hex: current, name: currentName || current, slot: 'accent' });
    }
    for (const s of palette) push(s);
    return out;
  }, [palette, currentHex, currentName]);

  const listRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      rows.findIndex((s) => sameHex(s.hex, currentHex)),
    ),
  );

  useEffect(() => {
    setActive((a) => Math.max(0, Math.min(a, Math.max(0, rows.length - 1))));
  }, [rows.length]);

  useLayoutEffect(() => {
    const i = Math.max(
      0,
      rows.findIndex((s) => sameHex(s.hex, currentHex)),
    );
    listRef.current?.querySelectorAll<HTMLElement>('[data-nav]')[i]?.focus({ preventScroll: true });
  }, []);

  const focusRow = useCallback((i: number) => {
    const el = listRef.current?.querySelectorAll<HTMLElement>('[data-nav]')[i];
    if (!el) return;
    setActive(i);
    el.focus({ preventScroll: true });
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose('escape');
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = active + (e.key === 'ArrowDown' ? 1 : -1);
      if (next >= 0 && next < rows.length) focusRow(next);
    }
  };

  const pick = (s: Swatch) => onPick({ t: 'color', hex: s.hex, name: s.name || undefined });

  const custom = (hex: string, live?: boolean) => {
    const named = rows.find((s) => sameHex(s.hex, hex));
    onPick({ t: 'color', hex, name: named?.name || undefined }, live ? { live: true } : undefined);
  };

  const current = currentHex ? normalizeHex(currentHex) : null;
  const customCurrent = !!current && !palette.some((s) => sameHex(s.hex, current));

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a key router, not a control
    <div className="sc-swap-inner" onKeyDown={onKeyDown}>
      <div className="sc-swap-body">
        {rows.length === 0 ? (
          <p className="sc-swap-empty">No brand colours yet.</p>
        ) : (
          <div className="sc-swap-swatches" ref={listRef} role="listbox" aria-label="Choose a colour">
            {rows.map((s, i) => {
              const on = sameHex(s.hex, currentHex);
              const body = (
                <>
                  <span className="sc-swap-dot" style={{ background: s.hex }} aria-hidden />
                  <b dir="auto">{s.name}</b>
                  <span>{s.hex}</span>
                  {on && (
                    <span className="sc-swap-tick" aria-hidden>
                      <Check size={11} weight="bold" />
                    </span>
                  )}
                </>
              );
              if (customCurrent && on) {
                return (
                  <ColorPicker
                    key="current-custom"
                    className="sc-swap-swatch"
                    triggerStyle={{ background: 'none' }}
                    value={s.hex}
                    presets={palette.map((p) => p.hex)}
                    commitMode="live"
                    align="start"
                    label={`Edit ${s.name}`}
                    triggerProps={{
                      role: 'option',
                      'aria-selected': true,
                      'data-on': '',
                      'data-nav': i,
                      tabIndex: i === active ? 0 : -1,
                      title: `${s.name} ${s.hex}`,
                      onFocus: () => setActive(i),
                    }}
                    onChange={(hex) => custom(hex, true)}
                  >
                    {body}
                  </ColorPicker>
                );
              }
              return (
                <div
                  key={s.hex}
                  className="sc-swap-swatch"
                  role="option"
                  aria-selected={on}
                  data-on={on || undefined}
                  data-nav={i}
                  tabIndex={i === active ? 0 : -1}
                  title={`${s.name} ${s.hex}`}
                  onFocus={() => setActive(i)}
                  onClick={() => pick(s)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    pick(s);
                  }}
                >
                  {body}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="sc-swap-foot">
        <ColorPicker
          className="sc-swap-swatch sc-swap-custom"
          triggerStyle={{ background: 'none' }}
          value={currentHex ?? nextHex(palette)}
          presets={palette.map((s) => s.hex)}
          commitMode="live"
          align="start"
          label="Custom colour"
          onChange={(hex) => custom(hex, true)}
        >
          <Plus size={12} />
          <b>Custom colour</b>
        </ColorPicker>
        {onMove && (
          <div className="sc-swap-move">
            <button type="button" className="sc-btn" onClick={() => onMove(-1)}>
              <ArrowLeft size={13} /> Move earlier
            </button>
            <button type="button" className="sc-btn" onClick={() => onMove(1)}>
              Move later <ArrowRight size={13} />
            </button>
          </div>
        )}
        <button type="button" className="sc-swap-remove" onClick={onRemove}>
          <Trash size={13} />
          Remove colour
        </button>
      </div>
    </div>
  );
}

function ColorPanel(props: ColorChipMenuProps) {
  const { anchor, onClose } = props;
  const [pos, setPos] = useState<Placed | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const vv = window.visualViewport;
      const p = placePanel(
        anchor.getBoundingClientRect(),
        { width: vv?.width ?? window.innerWidth, height: vv?.height ?? window.innerHeight },
        { width: MENU_W },
      );
      if (!p) {
        onClose('outside');
        return;
      }
      setPos(p);
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
    };
  }, [anchor, onClose]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (rootRef.current?.contains(t)) return;
      // Only the anchor chip is a toggle; any other chip is an outside click.
      if (anchor.contains(t)) return;
      // ColorPicker portals its popover; a drag on the hue strip is not "outside".
      if (t.closest?.('.sc-cp')) return;
      onClose('outside');
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose, anchor]);

  if (!pos) return null;
  return createPortal(
    <div
      ref={rootRef}
      className="sc-swap"
      data-kind="color"
      data-side={pos.side}
      role="dialog"
      aria-label="Change colour"
      style={panelStyle(pos)}
    >
      <ColorBody {...props} />
    </div>,
    document.body,
  );
}

function ColorSheet(props: ColorChipMenuProps) {
  const { onClose } = props;
  const { sheet, grip } = useSheetDrag(() => onClose('dismiss'));

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose('dismiss')}>
      <Dialog.Portal>
        <Dialog.Overlay className="sc-shotsheet-scrim" />
        <Dialog.Content
          ref={sheet}
          className="sc-shotsheet sc-swapsheet"
          data-kind="color"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            sheet.current?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            onClose('escape');
          }}
        >
          <div className="sc-shotsheet-grip" {...grip}>
            <span className="sc-shotsheet-bar" aria-hidden />
            <Dialog.Title className="sc-vh">Change colour</Dialog.Title>
          </div>
          <ColorBody {...props} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
