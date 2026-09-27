/**
 * How much a person can type in one go in a creation conversation.
 *
 * The chat composer's maxLength, and the cap on every answer that keeps their
 * words whole. It was 400 at the box, which stopped testers mid-description,
 * and lower still behind it (200 for a scene row or a kept detail), so what
 * got past the box was cut in silence further in (2026-09-27). The server
 * says the same number as TYPED_TEXT_MAX in packages/cli/src/assetRecords.ts;
 * `textMaxParity.test.ts` holds the two together.
 */
export const TEXT_MAX = 4000;

/**
 * A field composed from taps and typed words together: a guided scene
 * direction, a presenter's direction with its follow-up folded in. The
 * server's COMPOSED_TEXT_MAX.
 */
export const COMPOSED_TEXT_MAX = 8000;
