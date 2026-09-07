import { PRODUCT_REF_MAX } from './brief.js';
import { PRODUCT_ANGLES_BY_CATEGORY } from './demoProducts.js';

/**
 * The views Scenri may draw for a product: the ones a rotation of the visible
 * object can honestly supply. A back, a label or a detail is where lettering
 * and hidden construction live, and no reading of a front photograph knows
 * them; those come from photographs only, and the coverage note asks for one.
 */
export const DERIVABLE_ANGLES = ['three-quarter', 'front', 'side', 'lateral-side', 'medial-side', 'top'] as const;
const DERIVABLE = new Set<string>(DERIVABLE_ANGLES);

/**
 * Which views to offer, from what the photographs already show.
 *
 * The category's own angle list, minus the angles a photograph covers, kept to
 * the derivable set, and capped so photographs plus drawn views never exceed
 * what a brief attaches: a drawn view past that cap could never ride, so it
 * would be spent for nothing. A photograph with no known angle covers
 * nothing, but still takes its seat.
 */
export function plannedViews(
  category: string | null | undefined,
  photoAngles: (string | null | undefined)[],
  max = PRODUCT_REF_MAX,
): string[] {
  const plan = (category && PRODUCT_ANGLES_BY_CATEGORY[category]) || PRODUCT_ANGLES_BY_CATEGORY.other;
  const covered = new Set(photoAngles.filter((a): a is string => !!a));
  const room = Math.max(0, max - photoAngles.length);
  return plan.filter((a) => DERIVABLE.has(a) && !covered.has(a)).slice(0, room);
}
