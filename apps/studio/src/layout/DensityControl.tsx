import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { PREF, useLocalPref } from '../prefs.js';
import { DENSITY_DEFAULT, TILE_STOPS, type DensityCols, nearestTileStop, normalizeDensity } from './masonry.js';

export type DensitySize = 'compact' | 'large';

/** Compact (~7 cols) vs large (~5). Credits share hierarchy; compact is a step smaller. */
export function densitySize(cols: number): DensitySize {
  return normalizeDensity(cols) === 5 ? 'large' : 'compact';
}

/** Same pref the wall toggle writes — for portaled tips outside the masonry. */
export function useWallDensitySize(): DensitySize {
  const [raw] = useLocalPref(PREF.wallDensity, DENSITY_DEFAULT);
  return densitySize(raw);
}

interface SizeOption {
  value: number;
  label: string;
  hint: string;
  /** Cells per side in the icon: 3 reads denser than 2. */
  cells: number;
}

const WALL_OPTIONS: SizeOption[] = [
  { value: 7, label: 'Compact', hint: 'More cards per row', cells: 3 },
  { value: 5, label: 'Large', hint: 'Fewer, larger cards', cells: 2 },
];

const FEED_OPTIONS: SizeOption[] = TILE_STOPS.map((s) => ({
  value: s.px,
  label: s.label,
  hint: s.label === 'Compact' ? 'More shots per row' : 'Fewer, larger shots',
  cells: s.cells,
}));

/**
 * Catalog wall density — two-view icon toggle (compact ↔ large).
 * Sliding pill only (no wall fade — grid reflow is instant).
 */
export function DensityControl({ value, onChange }: { value: number; onChange: (cols: DensityCols) => void }) {
  return (
    <SizeToggle
      label="Grid size"
      value={normalizeDensity(value)}
      options={WALL_OPTIONS}
      onChange={(v) => onChange(v as DensityCols)}
    />
  );
}

/**
 * The Create feed's own size, in the same control.
 *
 * It was a fourteen-stop width slider, which was both a shape nothing else in
 * the app used and a promise it could not keep: the feed only reflows when the
 * column count flips, so most of those stops moved nothing. The feed is a wall
 * of pictures like every other wall here, so it gets the wall's own toggle —
 * one control, one meaning, wherever you meet it.
 */
export function FeedSizeControl({ value, onChange }: { value: number; onChange: (px: number) => void }) {
  return <SizeToggle label="Shot size" value={nearestTileStop(value)} options={FEED_OPTIONS} onChange={onChange} />;
}

/** The shared shape: a radiogroup of matched icons under one sliding pill. */
function SizeToggle({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number;
  options: SizeOption[];
  onChange: (value: number) => void;
}) {
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
  }, [value]);

  return (
    <div ref={rootRef} className="sc-density" role="radiogroup" aria-label={label}>
      <span className="sc-density-ink" aria-hidden />
      {options.map((opt) => {
        const on = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            className="sc-density-opt"
            aria-checked={on}
            aria-label={opt.label}
            title={opt.hint}
            data-on={on || undefined}
            onClick={() => {
              if (!on) onChange(opt.value);
            }}
          >
            <DensityIcon cells={opt.cells} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * Matched pair: same 16×16 frame, same 1.5px gutter, same rx ratio.
 * Compact = 3×3, large = 2×2 — density reads from cell count, not weight.
 */
function DensityIcon({ cells }: { cells: number }) {
  const n = cells;
  const box = 16;
  const pad = 1.5;
  const gap = 1.5;
  const inner = box - pad * 2;
  const cell = (inner - gap * (n - 1)) / n;
  const rx = Math.max(0.6, cell * 0.22);

  const rects: { x: number; y: number }[] = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      rects.push({ x: pad + col * (cell + gap), y: pad + row * (cell + gap) });
    }
  }

  return (
    <svg className="sc-density-icon" width={box} height={box} viewBox={`0 0 ${box} ${box}`} aria-hidden>
      {rects.map((c) => (
        <rect key={`${c.x}-${c.y}`} x={c.x} y={c.y} width={cell} height={cell} rx={rx} ry={rx} fill="currentColor" />
      ))}
    </svg>
  );
}

/** Sets --sc-wall-cols for CSS auto-fill floor (desktop only via media query). */
export function densityWallStyle(cols: number): CSSProperties {
  return { '--sc-wall-cols': String(normalizeDensity(cols)) } as CSSProperties;
}
