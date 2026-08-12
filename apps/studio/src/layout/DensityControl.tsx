import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { SquaresFour } from '@phosphor-icons/react';
import { DENSITY_STAGES, TILE_MAX, TILE_MIN, type DensityCols, normalizeDensity } from './masonry.js';

/**
 * Catalog wall density — two-view icon toggle (compact ↔ large).
 * Sliding pill only (no wall fade — grid reflow is instant).
 * Separate from Create’s feed size slider. Hidden on phone via `.sc-density`.
 */
export function DensityControl({ value, onChange }: { value: number; onChange: (cols: DensityCols) => void }) {
  const current = normalizeDensity(value);
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const placeInk = () => {
      const on = root.querySelector<HTMLElement>(':scope > button[data-on]');
      if (!on) {
        root.style.setProperty('--sc-density-x', '0px');
        root.style.setProperty('--sc-density-w', '0px');
        return;
      }
      root.style.setProperty('--sc-density-x', `${on.offsetLeft}px`);
      root.style.setProperty('--sc-density-w', `${on.offsetWidth}px`);
    };

    placeInk();
    if (!root.dataset.inkReady) {
      requestAnimationFrame(() => {
        root.dataset.inkReady = '';
      });
    }

    const ro = new ResizeObserver(placeInk);
    ro.observe(root);
    return () => ro.disconnect();
  }, [current]);

  return (
    <div ref={rootRef} className="sc-density" role="radiogroup" aria-label="Grid size">
      <span className="sc-density-ink" aria-hidden />
      {DENSITY_STAGES.map((cols) => {
        const compact = cols === 7;
        const on = current === cols;
        return (
          <button
            key={cols}
            type="button"
            role="radio"
            className="sc-density-opt"
            aria-checked={on}
            aria-label={compact ? 'Compact' : 'Large'}
            title={compact ? 'More cards per row' : 'Fewer, larger cards'}
            data-on={on || undefined}
            onClick={() => {
              if (cols !== current) onChange(cols);
            }}
          >
            <DensityIcon cols={cols} />
          </button>
        );
      })}
    </div>
  );
}

/** Create feed only — continuous tile-width range (original control). */
export function FeedDensitySlider({ value, onChange }: { value: number; onChange: (px: number) => void }) {
  return (
    <label className="sc-feed-density">
      <SquaresFour size={13} />
      <input
        type="range"
        min={TILE_MIN}
        max={TILE_MAX}
        step={20}
        value={value}
        aria-label="Grid size"
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

/**
 * Matched pair: same 16×16 frame, same 1.5px gutter, same rx ratio.
 * Compact = 3×3, large = 2×2 — density reads from cell count, not weight.
 */
function DensityIcon({ cols }: { cols: DensityCols }) {
  const n = cols === 7 ? 3 : 2;
  const box = 16;
  const pad = 1.5;
  const gap = 1.5;
  const inner = box - pad * 2;
  const cell = (inner - gap * (n - 1)) / n;
  const rx = Math.max(0.6, cell * 0.22);

  const cells: { x: number; y: number }[] = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      cells.push({
        x: pad + col * (cell + gap),
        y: pad + row * (cell + gap),
      });
    }
  }

  return (
    <svg className="sc-density-icon" width={box} height={box} viewBox={`0 0 ${box} ${box}`} aria-hidden>
      {cells.map((c, i) => (
        <rect key={i} x={c.x} y={c.y} width={cell} height={cell} rx={rx} ry={rx} fill="currentColor" />
      ))}
    </svg>
  );
}

/** Sets --sc-wall-cols for CSS auto-fill floor (desktop only via media query). */
export function densityWallStyle(cols: number): CSSProperties {
  return { '--sc-wall-cols': String(normalizeDensity(cols)) } as CSSProperties;
}
