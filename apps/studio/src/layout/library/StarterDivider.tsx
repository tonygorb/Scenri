/**
 * The seam between what you brought and what ships with Scenri.
 *
 * A centred label with a rule running out to each edge: it reads as a change
 * of section rather than a heading for what follows, which is what this is.
 * Products, Presenters and Scenes all show it in the same place, in their cold
 * state only, so the three pages open the same way.
 */
export function StarterDivider({ label }: { label: string }) {
  return (
    <div className="sc-starter-rule">
      <span>{label}</span>
    </div>
  );
}
