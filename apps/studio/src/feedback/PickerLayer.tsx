import { Crosshair } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { areaOf } from './registry.js';

/**
 * Pick the thing you want to talk about.
 *
 * A full-screen layer takes the pointer so a click cannot also press the
 * button underneath — reporting a Generate button should not generate. The
 * element under the cursor is found with elementFromPoint after temporarily
 * disabling the layer's own hit-testing, which is cheaper and more reliable
 * than tracking pointer events through every surface in the app.
 *
 * Works identically under touch, which is the point: there is no right-click
 * on a phone, and long-press already belongs to the browser's own image and
 * selection menus.
 */

interface Props {
  onPick: (el: Element) => void;
  onCancel: () => void;
}

const under = (x: number, y: number, layer: Element | null): Element | null => {
  const prev = (layer as HTMLElement | null)?.style.pointerEvents;
  if (layer) (layer as HTMLElement).style.pointerEvents = 'none';
  const el = document.elementFromPoint(x, y);
  if (layer) (layer as HTMLElement).style.pointerEvents = prev ?? '';
  return el;
};

export function PickerLayer({ onPick, onCancel }: Props) {
  const [hover, setHover] = useState<{ rect: DOMRect; area: string | null } | null>(null);
  const [layer, setLayer] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const track = (x: number, y: number) => {
    const el = under(x, y, layer);
    if (!el || el === document.body || el === document.documentElement) return setHover(null);
    setHover({ rect: el.getBoundingClientRect(), area: areaOf(el) });
  };

  const commit = (x: number, y: number) => {
    const el = under(x, y, layer);
    if (el && el !== document.body && el !== document.documentElement) onPick(el);
    else onCancel();
  };

  return createPortal(
    <>
      <div
        ref={setLayer}
        className="sc-fb-picker"
        data-fb-ui=""
        role="presentation"
        onPointerMove={(e) => track(e.clientX, e.clientY)}
        onPointerDown={(e) => {
          e.preventDefault();
          commit(e.clientX, e.clientY);
        }}
      />
      {hover && (
        <div
          className="sc-fb-ring"
          data-fb-ui=""
          style={{ left: hover.rect.x, top: hover.rect.y, width: hover.rect.width, height: hover.rect.height }}
        />
      )}
      <div className="sc-fb-hint" data-fb-ui="">
        <Crosshair size={14} />
        {hover?.area ? `Report: ${hover.area}` : 'Tap the thing that looks wrong'}
        <span style={{ opacity: 0.6 }}>· Esc to cancel</span>
      </div>
    </>,
    document.body,
  );
}
