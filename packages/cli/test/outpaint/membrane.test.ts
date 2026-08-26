import { describe, expect, it } from 'vitest';
import { solveMembrane } from '../../src/outpaint/membrane.js';

/** RGB triples along a seam, all channels the same, from a per-pixel value. */
function seamOf(values: number[]): Float32Array {
  const out = new Float32Array(values.length * 3);
  values.forEach((v, i) => {
    out[i * 3] = v;
    out[i * 3 + 1] = v;
    out[i * 3 + 2] = v;
  });
  return out;
}

/** Read the red channel of a solved margin field at margin (x, y). */
function at(field: Float32Array, width: number, x: number, y: number): number {
  return field[(y * width + x) * 3];
}

describe('solveMembrane', () => {
  it('carries a constant seam error across the whole margin', () => {
    // A constant boundary with zero-gradient sides has one harmonic solution:
    // the same constant everywhere. It is the sharpest test of the boundaries.
    const height = 64;
    const width = 40;
    const field = solveMembrane({
      width,
      height,
      axis: 'width',
      seamAt: 'near',
      seam: seamOf(new Array(height).fill(20)),
    });
    for (let y = 0; y < height; y += 7) {
      for (let x = 0; x < width; x += 5) {
        expect(at(field, width, x, y)).toBeCloseTo(20, 1);
      }
    }
  });

  it('is zero everywhere when the margin already meets the picture', () => {
    const field = solveMembrane({
      width: 32,
      height: 32,
      axis: 'width',
      seamAt: 'near',
      seam: seamOf(new Array(32).fill(0)),
    });
    expect(Math.max(...Array.from(field, Math.abs))).toBeLessThan(1e-6);
  });

  it('holds the seam line at exactly the error it was given', () => {
    const height = 48;
    const width = 24;
    const values = Array.from({ length: height }, (_, i) => (i < height / 2 ? 30 : -30));
    const field = solveMembrane({ width, height, axis: 'width', seamAt: 'near', seam: seamOf(values) });
    // seamAt 'near' puts the join at x = 0.
    for (let y = 0; y < height; y++) expect(at(field, width, 0, y)).toBeCloseTo(values[y], 5);
  });

  it('leaves the outer edge free rather than forcing it back to zero', () => {
    const height = 48;
    const width = 24;
    const field = solveMembrane({
      width,
      height,
      axis: 'width',
      seamAt: 'near',
      seam: seamOf(new Array(height).fill(18)),
    });
    // Neumann: the last two columns agree, and neither has been dragged to 0.
    for (let y = 4; y < height; y += 9) {
      expect(at(field, width, width - 1, y)).toBeCloseTo(at(field, width, width - 2, y), 1);
      expect(Math.abs(at(field, width, width - 1, y))).toBeGreaterThan(10);
    }
  });

  it('satisfies Laplace in the interior', () => {
    const height = 64;
    const width = 32;
    const values = Array.from({ length: height }, (_, i) => 25 * Math.sin((i / height) * Math.PI * 3));
    const field = solveMembrane({ width, height, axis: 'width', seamAt: 'near', seam: seamOf(values) });
    let worst = 0;
    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        const lap =
          4 * at(field, width, x, y) -
          at(field, width, x - 1, y) -
          at(field, width, x + 1, y) -
          at(field, width, x, y - 1) -
          at(field, width, x, y + 1);
        worst = Math.max(worst, Math.abs(lap));
      }
    }
    expect(worst).toBeLessThan(0.5);
  });

  it('spreads a step along the seam sideways as it travels inward, which a ramp cannot', () => {
    // This is the defect the ramp had. Its field was smooth[along] * fall(depth),
    // so the profile along the seam kept its exact shape at every depth and only
    // shrank: a step at the join stayed a step at the outer edge. A harmonic
    // field diffuses, so the step flattens out with depth.
    const height = 96;
    const width = 48;
    const values = Array.from({ length: height }, (_, i) => (i < height / 2 ? 30 : -30));
    const field = solveMembrane({ width, height, axis: 'width', seamAt: 'near', seam: seamOf(values) });

    /** How sharp the along-seam step still is at depth x, relative to the join. */
    const stepAt = (x: number) => Math.abs(at(field, width, x, height / 2 - 1) - at(field, width, x, height / 2));

    const atJoin = stepAt(0);
    expect(atJoin).toBeCloseTo(60, 0);
    // Well inside the margin the step has all but gone.
    expect(stepAt(width - 1)).toBeLessThan(atJoin * 0.05);
    // And it decays monotonically, rather than being rescaled at a fixed shape.
    for (let x = 1; x < width; x++) expect(stepAt(x)).toBeLessThanOrEqual(stepAt(x - 1) + 1e-3);
  });

  it('puts the seam on the correct edge for each of the four margins', () => {
    const one = (axis: 'width' | 'height', seamAt: 'far' | 'near', width: number, height: number) => {
      const along = axis === 'width' ? height : width;
      return solveMembrane({ width, height, axis, seamAt, seam: seamOf(new Array(along).fill(40)) });
    };
    // A left margin joins the picture at its right edge; a right margin at its left.
    const left = one('width', 'far', 16, 32);
    expect(at(left, 16, 15, 8)).toBeCloseTo(40, 5);
    const right = one('width', 'near', 16, 32);
    expect(at(right, 16, 0, 8)).toBeCloseTo(40, 5);
    // A top margin joins at its bottom edge; a bottom margin at its top.
    const top = one('height', 'far', 32, 16);
    expect(at(top, 32, 8, 15)).toBeCloseTo(40, 5);
    const bottom = one('height', 'near', 32, 16);
    expect(at(bottom, 32, 8, 0)).toBeCloseTo(40, 5);
  });

  it('survives degenerate margins', () => {
    expect(solveMembrane({ width: 0, height: 10, axis: 'width', seamAt: 'near', seam: seamOf([]) })).toHaveLength(0);
    const thin = solveMembrane({ width: 1, height: 4, axis: 'width', seamAt: 'near', seam: seamOf([5, 5, 5, 5]) });
    expect(Array.from(thin.filter((_, i) => i % 3 === 0))).toEqual([5, 5, 5, 5]);
  });
});
