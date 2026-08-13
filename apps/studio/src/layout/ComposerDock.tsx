import type { ReactNode } from 'react';

/**
 * The floating shelf the Composer sits in, and the gradient that lifts it off
 * whatever is scrolling underneath.
 *
 * Both screens that hold a brief mount this rather than repeating the pair of
 * divs: Create, where the dock steps aside for the assets panel, and Home,
 * where there is no panel to step aside for. Everything the shelf grows later
 * — keyboard inset, safe-area padding, a new state attribute — lands in one
 * place instead of drifting between two views.
 *
 * `full` is that one difference: false only while Create's assets panel holds
 * a grid column, which is the sole case where the dock is not centred on the
 * viewport (see `.sc-canvas-dock` in tokens.css).
 */
export function ComposerDock({ full = true, children }: { full?: boolean; children: ReactNode }) {
  return (
    <>
      <div className="sc-dock-fade" data-full={full} aria-hidden />
      <div className="sc-canvas-dock" data-full={full}>
        {children}
      </div>
    </>
  );
}
