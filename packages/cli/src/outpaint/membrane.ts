/**
 * The membrane that carries a seam error into a generated margin.
 *
 * Where a grown frame's margin meets the picture, the two disagree: they are
 * two renderings of the same scene, so their values differ along the join. The
 * fix is gradient-domain (Perez et al., "Poisson Image Editing", 2003) — hold
 * the boundary at the picture's own values and let a harmonic field carry that
 * correction into the margin, so the margin keeps its own texture everywhere
 * while the discontinuity at the boundary becomes zero by construction.
 *
 * What this replaces mattered. The first version measured the error along the
 * seam, smoothed it, and multiplied it by a ramp that decayed with depth. That
 * field is separable: the profile along the seam keeps its exact shape at every
 * depth and only shrinks. So an error that steps halfway down the join stays a
 * step all the way to the outer edge, fading but never spreading — a band,
 * which is the very thing the eye finds. A real harmonic field diffuses
 * sideways as it travels inward, and the step is gone within a few tens of
 * pixels.
 *
 * The solve is a Laplace problem on the margin rectangle: Dirichlet on the line
 * that touches the picture, Neumann (zero gradient) on the other three, which
 * lets the correction reach the frame border instead of being forced back to
 * zero there. Nothing here reads or writes a pixel of the original.
 *
 * Method: red-black successive over-relaxation on a coarse-to-fine cascade.
 * Plain Gauss-Seidel needs on the order of n^2 sweeps to carry information
 * across n cells, which is why fixed-iteration implementations of this are
 * usually far from converged; over-relaxation with the optimal factor brings
 * that to order n, and starting each level from the level below removes the
 * rest. A harmonic field is smooth by definition, so the solve runs on a small
 * grid and is interpolated up at no visible cost.
 */

/** Longest edge of the grid the field is actually solved on. */
const SOLVE_MAX_EDGE = 192;
/** Coarsest level of the cascade. */
const SOLVE_MIN_EDGE = 8;
/** Sweeps per level, as a multiple of that level's longest edge. */
const SWEEPS_PER_EDGE = 2;
const MIN_SWEEPS = 40;
/**
 * Sweeps of the final pass, run at full margin resolution.
 *
 * The cascade settles the shape of the field cheaply, but it carries the seam's
 * boundary values at the coarse grid's spacing, which blunts the correction in
 * the first few tens of pixels - measured against a real photograph, exactly
 * the band where the old ramp was still the better of the two. The coarse
 * answer is already right everywhere else, so a short pass at full resolution
 * with the true seam only has local detail left to fix.
 */
const POLISH_SWEEPS = 32;
/** Above this many cells the polish is skipped rather than allowed to crawl. */
const POLISH_MAX_CELLS = 4_000_000;

export interface MembraneRequest {
  /** Margin size in pixels. */
  width: number;
  height: number;
  /** Which axis the frame grew along, so which way is "into the margin". */
  axis: 'width' | 'height';
  /** Whether the picture touches the far end of the margin or the near one. */
  seamAt: 'far' | 'near';
  /**
   * Boundary values along the seam, RGB triples, one per pixel along the join.
   * Length must be `along * 3`, where `along` is height for a width-axis grow.
   */
  seam: Float32Array;
}

/**
 * Solve the correction field for one margin.
 *
 * Returns RGB triples in margin raster order, `width * height * 3` long, to be
 * added to the margin's own values.
 */
export function solveMembrane(req: MembraneRequest): Float32Array {
  const { width, height, axis, seamAt } = req;
  const along = axis === 'width' ? height : width;
  const depth = axis === 'width' ? width : height;
  const out = new Float32Array(width * height * 3);
  if (width < 1 || height < 1 || along < 1 || depth < 1) return out;

  // A margin one pixel deep is entirely boundary: the seam value is the answer.
  if (depth === 1) {
    for (let a = 0; a < along; a++) {
      const off = marginOffset(0, a, width, axis, seamAt, depth) * 3;
      for (let c = 0; c < 3; c++) out[off + c] = req.seam[a * 3 + c];
    }
    return out;
  }

  const coarse = cascade(req.seam, along, depth);

  // Full resolution, from the cascade's answer, with the true seam.
  if (depth * along <= POLISH_MAX_CELLS) {
    const full: Grid = { along, depth, data: new Float32Array(along * depth * 3) };
    prolong(coarse, full);
    relax(full, req.seam, POLISH_SWEEPS);
    for (let d = 0; d < depth; d++) {
      for (let a = 0; a < along; a++) {
        const off = marginOffset(d, a, width, axis, seamAt, depth) * 3;
        const src = (d * along + a) * 3;
        out[off] = full.data[src];
        out[off + 1] = full.data[src + 1];
        out[off + 2] = full.data[src + 2];
      }
    }
    return out;
  }

  // Interpolate the solved grid back out to margin pixels.
  for (let d = 0; d < depth; d++) {
    for (let a = 0; a < along; a++) {
      const off = marginOffset(d, a, width, axis, seamAt, depth) * 3;
      sampleGrid(coarse, d, a, depth, along, out, off);
    }
  }
  return out;
}

/**
 * Canonical grid coordinates to margin raster index.
 *
 * `d` counts inward from the seam, `a` runs along it. The seam is the margin's
 * last line when the picture sits beyond the margin's far end, and its first
 * line otherwise — which is the same mapping the ramp used, kept so the two can
 * be compared directly.
 */
function marginOffset(
  d: number,
  a: number,
  width: number,
  axis: 'width' | 'height',
  seamAt: 'far' | 'near',
  depth: number,
): number {
  if (axis === 'width') {
    const x = seamAt === 'far' ? depth - 1 - d : d;
    return a * width + x;
  }
  const y = seamAt === 'far' ? depth - 1 - d : d;
  return y * width + a;
}

interface Grid {
  depth: number;
  along: number;
  /** RGB triples, `depth * along * 3`. */
  data: Float32Array;
}

/** Coarse to fine: each level starts from the one below it, already close. */
function cascade(seam: Float32Array, along: number, depth: number): Grid {
  const scale = Math.max(1, Math.ceil(Math.max(along, depth) / SOLVE_MAX_EDGE));
  const targetAlong = Math.max(2, Math.round(along / scale));
  const targetDepth = Math.max(2, Math.round(depth / scale));

  const edges: number[] = [];
  for (let e = SOLVE_MIN_EDGE; e < Math.max(targetAlong, targetDepth); e *= 2) edges.push(e);
  edges.push(Math.max(targetAlong, targetDepth));

  let grid: Grid | null = null;
  for (const edge of edges) {
    const ratio = edge / Math.max(targetAlong, targetDepth);
    const la = Math.max(2, Math.round(targetAlong * ratio));
    const ld = Math.max(2, Math.round(targetDepth * ratio));
    const next: Grid = { along: la, depth: ld, data: new Float32Array(la * ld * 3) };
    if (grid) prolong(grid, next);
    relax(next, resampleSeam(seam, along, la));
    grid = next;
  }
  return grid as Grid;
}

/** The seam's boundary data, resampled to a level's width. */
function resampleSeam(seam: Float32Array, along: number, to: number): Float32Array {
  const out = new Float32Array(to * 3);
  for (let i = 0; i < to; i++) {
    const src = to === 1 ? 0 : (i * (along - 1)) / (to - 1);
    const lo = Math.floor(src);
    const hi = Math.min(along - 1, lo + 1);
    const t = src - lo;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = seam[lo * 3 + c] * (1 - t) + seam[hi * 3 + c] * t;
  }
  return out;
}

/** Bilinear interpolation of a coarse solution into a finer grid. */
function prolong(from: Grid, to: Grid): void {
  for (let d = 0; d < to.depth; d++) {
    const sd = to.depth === 1 ? 0 : (d * (from.depth - 1)) / (to.depth - 1);
    for (let a = 0; a < to.along; a++) {
      const sa = to.along === 1 ? 0 : (a * (from.along - 1)) / (to.along - 1);
      sampleGrid(from, sd, sa, from.depth, from.along, to.data, (d * to.along + a) * 3);
    }
  }
}

/** Bilinear read of a grid at fractional coordinates, written as an RGB triple. */
function sampleGrid(
  grid: Grid,
  d: number,
  a: number,
  fromDepth: number,
  fromAlong: number,
  into: Float32Array,
  off: number,
): void {
  const sd = fromDepth === grid.depth ? d : grid.depth === 1 ? 0 : (d * (grid.depth - 1)) / (fromDepth - 1);
  const sa = fromAlong === grid.along ? a : grid.along === 1 ? 0 : (a * (grid.along - 1)) / (fromAlong - 1);
  const d0 = Math.floor(sd);
  const a0 = Math.floor(sa);
  const d1 = Math.min(grid.depth - 1, d0 + 1);
  const a1 = Math.min(grid.along - 1, a0 + 1);
  const td = sd - d0;
  const ta = sa - a0;
  const i00 = (d0 * grid.along + a0) * 3;
  const i01 = (d0 * grid.along + a1) * 3;
  const i10 = (d1 * grid.along + a0) * 3;
  const i11 = (d1 * grid.along + a1) * 3;
  for (let c = 0; c < 3; c++) {
    const top = grid.data[i00 + c] * (1 - ta) + grid.data[i01 + c] * ta;
    const bot = grid.data[i10 + c] * (1 - ta) + grid.data[i11 + c] * ta;
    into[off + c] = top * (1 - td) + bot * td;
  }
}

/**
 * Red-black SOR on one level.
 *
 * Row `d = 0` is held at the seam values (Dirichlet). The outer row and both
 * ends of the strip are free, with out-of-range neighbours read as their
 * in-range mirror, which is a zero-gradient (Neumann) boundary.
 */
function relax(grid: Grid, seam: Float32Array, fixedSweeps?: number): void {
  const { depth, along, data } = grid;
  for (let a = 0; a < along; a++) {
    const off = a * 3;
    for (let c = 0; c < 3; c++) data[off + c] = seam[off + c];
  }
  if (depth < 2) return;

  const n = Math.max(depth, along);
  // The optimal over-relaxation factor for Laplace on a grid this size. Plain
  // Gauss-Seidel is this with omega = 1, and needs n^2 sweeps where this needs n.
  const omega = Math.min(1.99, 2 / (1 + Math.sin(Math.PI / Math.max(2, n))));
  const sweeps = fixedSweeps ?? Math.max(MIN_SWEEPS, SWEEPS_PER_EDGE * n);

  for (let sweep = 0; sweep < sweeps; sweep++) {
    for (let parity = 0; parity < 2; parity++) {
      for (let d = 1; d < depth; d++) {
        const row = d * along;
        const rowUp = (d - 1) * along;
        // Neumann at the outer edge: the row beyond it mirrors the row before.
        const rowDn = (d < depth - 1 ? d + 1 : d - 1) * along;
        for (let a = (d + parity) % 2; a < along; a += 2) {
          const iL = row + (a > 0 ? a - 1 : Math.min(1, along - 1));
          const iR = row + (a < along - 1 ? a + 1 : Math.max(0, along - 2));
          const i = row + a;
          for (let c = 0; c < 3; c++) {
            const avg =
              (data[(rowUp + a) * 3 + c] + data[(rowDn + a) * 3 + c] + data[iL * 3 + c] + data[iR * 3 + c]) * 0.25;
            data[i * 3 + c] += omega * (avg - data[i * 3 + c]);
          }
        }
      }
    }
  }
}
