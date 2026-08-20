import type { SVGProps } from 'react';

/**
 * The Scenri mark: the symbol set beside the wordmark, at every width.
 *
 * Artwork of record is apps/studio/brand/scenri-{symbol,lockup}.svg; the paths
 * below are the same geometry inlined so the mark costs no request and cannot
 * arrive after the bar it sits in. test/scenriMark.test.ts fails if the two
 * drift apart.
 *
 * Ink is `currentColor`, deliberately. The Figma file ships four frames, and
 * its `-light` / `-dark` suffixes name the colour of the artwork, not the theme
 * it belongs to: `-light` is the white cut, for a dark background. Wiring those
 * names straight onto `[data-theme]` gives white on white. There is no variant
 * to get backwards here, because `.sc-wordmark` already sets
 * `color: var(--sc-fg)` and the mark simply inherits it.
 */

const SYMBOL = [
  'M64 18.71V38.8L51.38 51.39V12.62H57.9C61.27 12.62 64 15.35 64 18.72V18.71Z',
  'M12.62 12.62V51.39H6.1C2.73 51.39 0 48.66 0 45.29V25.2L12.62 12.61V12.62Z',
  'M51.38 51.38L38.79 64H18.7C15.33 64 12.6 61.27 12.6 57.9V51.38H51.37H51.38Z',
  'M12.62 12.62L25.2 0H45.29C48.66 0 51.39 2.73 51.39 6.1V12.62H12.62Z',
];

const WORDMARK = [
  'M100.99 28.93L91.76 27.8C88.5 27.41 87.19 26.58 87.19 25.1C87.19 23.45 89.98 22.49 94.29 22.49C99.38 22.49 102.43 23.36 104.17 26.58L111.61 24.27C108.65 17.87 102.08 16 94.98 16C85.1 16 78.7 19.31 78.7 25.97C78.7 31.02 82.49 33.81 90.28 34.76L98.68 35.8C102.29 36.24 103.3 37.19 103.3 38.5C103.3 40.24 100.64 41.46 95.59 41.46C89.41 41.46 87.01 40.2 85.31 37.02L77.52 39.33C80.31 45.77 86.92 47.95 95.07 47.95C105.17 47.95 111.88 44.55 111.88 37.72C111.88 32.84 108.53 29.84 101 28.93H100.99Z',
  'M132.73 22.66C137 22.66 140.87 24.01 142.7 28.54L150.49 26.67C148.79 20.66 142.3 16.05 132.6 16.05C121.41 16.05 113.44 22.23 113.44 31.98C113.44 41.73 121.41 48 132.6 48C142.31 48 148.8 43.3 150.49 37.29L142.7 35.42C140.87 39.95 137 41.3 132.73 41.3C126.94 41.3 122.24 38.38 122.24 32.42V31.55C122.24 25.59 126.94 22.67 132.73 22.67V22.66Z',
  'M161.51 34.89H179.58V28.71H161.51V22.97H181.54V16.52H152.8V47.43H181.84V40.99H161.51V34.89Z',
  'M208.71 33.85H208.67L193.86 16.52H184.94V47.43H193.04V27.49H193.08L210.15 47.43H216.81V16.52H208.71V33.85Z',
  'M252.25 26.8C252.25 20.14 248.07 16.52 239.84 16.52H220.77V47.43H229.48V37.5H236.62L242.63 47.43H252.56L245.55 36.37C249.9 34.8 252.25 31.62 252.25 26.79V26.8ZM243.54 27.32C243.54 29.98 242.06 31.28 239.06 31.28H229.48V22.96H239.06C242.06 22.96 243.54 24.27 243.54 26.88V27.32Z',
  'M263.79 16.52H255.08V47.43H263.79V16.52Z',
];

/**
 * Symbol plus wordmark, 4.122:1. Twenty pixels tall renders eighty-two wide,
 * which the bar has room for at every width down to 320.
 *
 * The symbol alone has no component: nothing in the app draws it on its own,
 * and brand/scenri-symbol.svg is what the icon generator renders every square
 * icon from.
 */
export function ScenriLockup(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 263.79 64" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      {[...SYMBOL, ...WORDMARK].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
