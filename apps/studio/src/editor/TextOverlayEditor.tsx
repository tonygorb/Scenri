import { useEffect, useRef, useState } from 'react';
import type { TextLayer } from '../api.js';
import { fontById } from './fonts.js';
import { SIZE_BASE } from './flatten.js';

/**
 * DOM-based WYSIWYG text layer editor rendered over the stage image.
 * Canva idioms: click select, drag move, side handles resize width,
 * double-click inline edit, Esc deselect, Delete removes, center snap.
 */
export function TextOverlayEditor({
  layers,
  selectedId,
  onSelect,
  onChange,
  contentWidth,
}: {
  layers: TextLayer[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (layers: TextLayer[]) => void;
  /** Rendered width of the image content box in CSS px. */
  contentWidth: number;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [snap, setSnap] = useState(false);
  const drag = useRef<{
    id: string;
    mode: 'move' | 'left' | 'right';
    startX: number;
    startY: number;
    orig: TextLayer;
  } | null>(null);

  const scale = (contentWidth || 1) / SIZE_BASE;

  const update = (id: string, patch: Partial<TextLayer>) =>
    onChange(layers.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing) return;
      if (e.key === 'Escape') onSelect(null);
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        selectedId &&
        document.activeElement?.tagName !== 'TEXTAREA' &&
        document.activeElement?.tagName !== 'INPUT'
      ) {
        onChange(layers.filter((l) => l.id !== selectedId));
        onSelect(null);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [layers, selectedId, editing, onChange, onSelect]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      const box = boxRef.current;
      if (!d || !box) return;
      const r = box.getBoundingClientRect();
      const dxPct = ((e.clientX - d.startX) / r.width) * 100;
      const dyPct = ((e.clientY - d.startY) / r.height) * 100;
      if (d.mode === 'move') {
        let nx = d.orig.x + dxPct;
        const ny = Math.min(96, Math.max(-10, d.orig.y + dyPct));
        const center = nx + d.orig.width / 2;
        if (Math.abs(center - 50) < 1.6) {
          nx = 50 - d.orig.width / 2;
          setSnap(true);
        } else setSnap(false);
        update(d.id, { x: Math.min(98, Math.max(-40, nx)), y: ny });
      } else if (d.mode === 'right') {
        update(d.id, { width: Math.min(120, Math.max(8, d.orig.width + dxPct)) });
      } else {
        const nw = Math.min(120, Math.max(8, d.orig.width - dxPct));
        update(d.id, { x: d.orig.x + (d.orig.width - nw), width: nw });
      }
    };
    const onUp = () => {
      drag.current = null;
      setSnap(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  });

  const startDrag = (e: React.PointerEvent, id: string, mode: 'move' | 'left' | 'right') => {
    e.preventDefault();
    e.stopPropagation();
    const l = layers.find((x) => x.id === id);
    if (!l) return;
    drag.current = { id, mode, startX: e.clientX, startY: e.clientY, orig: { ...l } };
    onSelect(id);
  };

  return (
    <div
      ref={boxRef}
      style={{ position: 'absolute', inset: 0 }}
      onPointerDown={() => {
        onSelect(null);
        setEditing(null);
      }}
    >
      {snap && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: 0,
            bottom: 0,
            width: 1,
            background: 'var(--bt-focus)',
            opacity: 0.8,
          }}
        />
      )}
      {layers.map((l) => {
        const sel = l.id === selectedId;
        const font = fontById(l.fontId);
        return (
          <div
            key={l.id}
            onPointerDown={(e) => startDrag(e, l.id, 'move')}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditing(l.id);
            }}
            style={{
              position: 'absolute',
              left: `${l.x}%`,
              top: `${l.y}%`,
              width: `${l.width}%`,
              cursor: 'move',
              outline: sel ? '1.5px solid var(--bt-focus)' : '1.5px solid transparent',
              outlineOffset: 2,
              userSelect: 'none',
              touchAction: 'none',
            }}
          >
            {editing === l.id ? (
              <textarea
                value={l.text}
                onChange={(e) => update(l.id, { text: e.target.value })}
                onBlur={() => setEditing(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setEditing(null);
                  e.stopPropagation();
                }}
                onPointerDown={(e) => e.stopPropagation()}
                style={{
                  width: '100%',
                  background: 'rgba(0,0,0,0.35)',
                  border: '1px dashed var(--bt-focus)',
                  borderRadius: 4,
                  color: l.color,
                  fontFamily: font.family,
                  fontWeight: l.weight,
                  fontSize: l.size * scale,
                  lineHeight: l.lineHeight,
                  textAlign: l.align,
                  opacity: l.opacity,
                  resize: 'none',
                  outline: 'none',
                  padding: 0,
                  overflow: 'hidden',
                }}
                rows={Math.max(1, l.text.split('\n').length)}
              />
            ) : (
              <div
                style={{
                  fontFamily: font.family,
                  fontWeight: l.weight,
                  fontSize: l.size * scale,
                  lineHeight: l.lineHeight,
                  textAlign: l.align,
                  color: l.color,
                  opacity: l.opacity,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  letterSpacing: l.letterSpacing ? l.letterSpacing * scale : undefined,
                  textTransform: l.uppercase ? 'uppercase' : undefined,
                  textShadow: l.shadow
                    ? `${l.shadow.x * scale}px ${l.shadow.y * scale}px ${l.shadow.blur * scale}px ${l.shadow.color}`
                    : undefined,
                  WebkitTextStroke:
                    l.stroke && l.stroke.width > 0 ? `${l.stroke.width * scale}px ${l.stroke.color}` : undefined,
                }}
              >
                {l.background ? (
                  <span
                    style={{
                      background: l.background.color,
                      padding: `${l.background.paddingY * scale}px ${l.background.paddingX * scale}px`,
                      borderRadius: l.background.radius * scale,
                      boxDecorationBreak: 'clone',
                      WebkitBoxDecorationBreak: 'clone',
                    }}
                  >
                    {l.text || ' '}
                  </span>
                ) : (
                  l.text || ' '
                )}
              </div>
            )}
            {sel && !editing && (
              <>
                <Handle side="left" onPointerDown={(e) => startDrag(e, l.id, 'left')} />
                <Handle side="right" onPointerDown={(e) => startDrag(e, l.id, 'right')} />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Handle({ side, onPointerDown }: { side: 'left' | 'right'; onPointerDown: (e: React.PointerEvent) => void }) {
  return (
    <div
      className="bt-editor-handle"
      onPointerDown={onPointerDown}
      style={{
        position: 'absolute',
        top: '50%',
        [side]: -7,
        transform: 'translateY(-50%)',
        width: 10,
        height: 22,
        borderRadius: 5,
        background: 'var(--bt-focus)',
        cursor: 'ew-resize',
        border: '2px solid var(--bt-panel)',
      }}
    />
  );
}
