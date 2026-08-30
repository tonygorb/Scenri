/**
 * The variation plan: what makes N outputs a SET rather than N rolls of a die.
 *
 * A brief compiles once, to one prompt and one attachment list, and every
 * output of a multi-image run is generated from that one canonical recipe. The
 * only thing that may legitimately differ between outputs is the PHOTOGRAPHY,
 * so that difference is written here, once, deterministically, and carried to
 * the engine as `GenerateRequest.variations` — one entry per requested image.
 *
 * Why this module exists rather than a clause inside an adapter:
 *
 * The reported failure was "output 1 holds the selected presenter, outputs 2, 3
 * and 4 drift into other people". By the time it was reported the request path
 * was already provably identical for every output — one compile, one reference
 * set, one size, no shared mutable state. The single piece of per-output
 * information that reached the model was a COUNTER: "take 3 of 4". A counter is
 * not neutral text. In shoot language a rising take number reads as *we have
 * already done that, go further*, which is a licence to deviate that grows
 * monotonically with the output index — exactly the shape of the report.
 *
 * So no counter appears here, and no output is described in terms of any other
 * output. Each slot gets the same-shaped clause: one framing sentence naming
 * the photographic move for that slot, then the identical set of locks, last,
 * where recency makes them strongest. Slot 0 is not privileged and not
 * impoverished: it gets the straight read of the direction, in the same shape.
 */

export interface VariationContext {
  /** A presenter is attached, so a specific person's identity is locked. */
  hasPresenter: boolean;
  /** A product is attached, so a specific object's identity is locked. */
  hasProduct: boolean;
  /** A brand mark is attached and must survive every frame unredrawn. */
  hasMark: boolean;
  /**
   * The direction already chose the camera. The brief then owns the variation
   * envelope and the ladder narrows to moves that cannot contradict it — the
   * same rule `shotSpecifiesCamera` already enforces for a scene's camera
   * tendency, applied to the set.
   */
  cameraFixed: boolean;
}

/**
 * Camera moves for a brief that left the camera open. Index 0 is the straight
 * read, so a slot never has to be described as a departure from another slot.
 */
const OPEN_LADDER = [
  'Frame this one as the direction describes it, the straight read of the brief.',
  'Step the camera to one side of where the direction places it, and let the pose settle with the move.',
  'Frame tighter on the subject than the straight read, same lens character.',
  'Drop the eye line a little and leave more air in the frame.',
  'Step back for a wider read of the same setup.',
  'Come round to a three-quarter view of the same arrangement.',
  'Take it from slightly above, the same distance.',
  'Hold the same framing and let the subject carry a different beat of the same moment.',
];

/**
 * Moves for a brief that named its own camera. Distance, height and lens are
 * the direction's to decide, so these move only what it did not fix.
 */
const FIXED_LADDER = [
  'Frame this one as the direction describes it, the straight read of the brief.',
  'Keep the camera the direction asks for and shift it a little laterally.',
  'Keep the camera the direction asks for and let the weight and hands settle differently.',
  'Keep the camera the direction asks for and change the head angle slightly.',
  'Keep the camera the direction asks for and let the light fall a touch differently across the same setup.',
  'Keep the camera the direction asks for and give the expression a different beat of the same moment.',
  'Keep the camera the direction asks for and rearrange the near foreground slightly.',
  'Keep the camera the direction asks for and let the pose breathe a little wider.',
];

/**
 * What every frame in the run shares. Stated identically for every slot, and
 * last in the clause, so no slot can read as the one where it mattered less.
 *
 * Wardrobe is named explicitly. It is not implied by "same person": a model
 * given a new camera angle will happily re-dress the subject, and four frames
 * in four outfits are not a set. Only the cloth's behaviour may move.
 */
function locks(ctx: VariationContext): string {
  const parts = [
    'Every frame in this run belongs to one continuous shoot: the same location, the same light, ' +
      'and the same wardrobe garment for garment, changing only as the pose moves the cloth.',
  ];
  if (ctx.hasPresenter)
    parts.push(
      'The person is the one in the character references and nobody else, unchanged in face, hair, build and skin.',
    );
  if (ctx.hasProduct)
    parts.push(
      'The product is the one in the product references and no other, unchanged in geometry, packaging, label and colour.',
    );
  if (ctx.hasMark) parts.push('The brand mark stays exactly as drawn.');
  return parts.join(' ');
}

/**
 * One clause per requested image, index-aligned with the engine's output slots.
 *
 * A single-image run returns an empty plan: it has nothing to be consistent
 * with, and leaving its prompt untouched is what keeps a Generate 1 byte-stable
 * against every golden fixture that already asserts it.
 */
export function variationPlan(count: number, ctx: VariationContext): string[] {
  if (!Number.isFinite(count) || count <= 1) return [];
  const ladder = ctx.cameraFixed ? FIXED_LADDER : OPEN_LADDER;
  const shared = locks(ctx);
  return Array.from({ length: Math.floor(count) }, (_, i) => `${ladder[i % ladder.length]} ${shared}`);
}
