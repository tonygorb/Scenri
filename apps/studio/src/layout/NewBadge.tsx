import { useWhatsNew } from '../app/WhatsNew.js';

/**
 * The word New beside a feature's way in, while this install has not used it
 * (DESIGN.md, "New"). Nothing otherwise, and never a control: it goes when the
 * feature is used, or by itself once its release is thirty days old.
 */
export function NewBadge({ feature }: { feature: string }) {
  const { isNew } = useWhatsNew();
  return isNew(feature) ? <span className="sc-tag sc-tag-new">New</span> : null;
}
