import type { SVGProps } from 'react';

/**
 * Replicate's mark.
 *
 * Here for the same reason as OpenAIMark and OpenRouterMark: recognition beats
 * a generic glyph in a list whose whole job is to be scanned. Used
 * referentially, to name which service a key belongs to. scenri is not
 * affiliated with, endorsed by or certified by Replicate.
 *
 * Geometry from Simple Icons (https://simpleicons.org), CC0-1.0, reproduced
 * unmodified apart from taking `currentColor` so it reads in both themes.
 * "Replicate" is a trademark of its owner; the CC0 licence covers the artwork
 * file, never the trademark. See NOTICE.
 */
export function ReplicateMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path d="M24 10.262v2.712h-9.518V24h-3.034V10.262zm0-5.131v2.717H8.755V24H5.722V5.131zM24 0v2.717H3.034V24H0V0z" />
    </svg>
  );
}
