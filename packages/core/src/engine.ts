/**
 * EngineAdapter — the one interface every generation backend implements.
 *
 * Contract notes:
 * - Adapters must be side-effect free until generate/edit is called.
 * - `costEstimate` returns 0 for engines billed outside the app (e.g. a local
 *   agent session); the cost ledger records estimates, never invents charges.
 * - Local-agent adapters (codex-cli) are OSS-local only and must respect the
 *   `localOnly` capability flag: the hosted product never bridges a user's
 *   subscription session — a subscription is licensed to its owner, on their
 *   own machine, and is not ours to resell or pool.
 */

/** Why a reference image is attached — the compiler's only defence against one image bleeding into a dimension it does not own. */
export type ReferenceRole = 'product' | 'character' | 'brand' | 'scene' | 'composition' | 'style' | 'reference';

/**
 * What each reference role means, in the words an adapter puts in front of the
 * model. One map, shared by every adapter: when these lived per-engine the same
 * role meant subtly different things on codex and on openrouter, so the same
 * brief produced differently-constrained images depending on where it ran.
 */
export const REFERENCE_ROLE_DIRECTIVE: Record<ReferenceRole, string> = {
  product: 'the exact product — preserve its label, shape, colors and design faithfully; do not redesign it',
  character:
    'the exact person — match their face, facial structure, skin, hair and build exactly; their clothing, pose and background are capture context, not styling to reproduce',
  brand:
    "the brand's own mark — if the direction calls for the mark to appear, reproduce it exactly as drawn, same colours, letterforms and proportions, every character down to the smallest secondary lettering, in its original script and reading direction, never translated, transliterated or re-spelled; otherwise take only its colour and treatment, and never its subject, geometry or composition",
  // Only a figure-led scene attaches one of these now, so this says what that
  // case actually needs. It used to read "environment and light only - take no
  // subject or person from it", which handed the model a photograph of a face
  // treatment and told it to ignore the treatment. A hand-attached reference
  // says "match ... treatment" and works; this now says the same thing, with the
  // identity carve-out a scene needs and a lone reference does not. The tail
  // names staged objects as stand-ins rather than just "no product": a bare
  // prohibition still left the demo object in the frame, because the model had
  // nowhere to put what the photograph so vividly showed.
  //
  // The carve-out leads. It used to sit forty words in, one subordinate
  // clause after a paragraph of "match this" - and the tester case (a close
  // portrait as the scene image beside a selected presenter) showed which
  // half the model heard. Every treatment clause is retained word for word;
  // only the order and the register of the identity refusal changed.
  scene:
    'a reference for this world, never for a person: take no identity from the person in it — not their face, not their likeness — they are an anonymous stand-in whose place the attached subject takes. Match the environment, the light, and the material, density, scale, finish and spread of the treatment applied to the figure, including which parts of the form it covers and how far it reaches; treat any product, garment or prop staged in it as the same kind of stand-in, demonstrating placement and scale — never an object to reproduce',
  composition:
    'a reference for framing, camera angle and pose only — take no subject, color, material or branding from it',
  style: 'a reference for overall treatment and mood only — take no composition, subject or product detail from it',
  reference: 'a reference to match in composition, lighting and treatment',
};

/** The same contract, compressed for edit prompts where the source image already carries the subject. */
export const EDIT_REFERENCE_ROLE_DIRECTIVE: Record<ReferenceRole, string> = {
  product: 'the exact product: keep or restore its label, shape and design faithfully',
  character:
    "the exact person: keep their face, facial structure, skin, hair and build faithfully; take no clothing, pose or background from this reference, and keep the source image's existing outfit unless the instruction changes it",
  brand:
    "the brand's own mark: reproduce it exactly as drawn wherever it appears — every character down to the smallest secondary lettering, in its original script and reading direction — never redrawn, re-lettered, translated or transliterated",
  scene: 'a reference for environment, light and treatment only — take no identity from any person in it',
  composition: 'a reference for framing and pose only',
  style: 'a reference for treatment and mood only',
  reference: 'a reference for composition, lighting and treatment only',
};

export interface BrandContext {
  /** Parsed brand.json (see @scenri/brand). Injected into generation. */
  brand: unknown;
  /**
   * Absolute paths of resolved brand assets (logos, style refs, locked shots).
   *
   * Informational only — no adapter reads this, and none should. An image
   * reaches a model exactly one way: as a compiled attachment with a role, so
   * that the composer's preview and the engine's input can never disagree about
   * what was sent. To put a logo in front of a model, attach it as a `brand`
   * reference (see the `mark` brief token), not from here.
   *
   * Kept only because this is the public adapter contract and every engine
   * fixture constructs it; scheduled for removal in a minor release. Do not
   * make an adapter read it in the meantime — that would put a second,
   * role-less path to a logo beside the one the budget governs.
   */
  assetPaths: Record<string, string>;
}

export interface GenerateRequest {
  prompt: string;
  brand: BrandContext;
  referenceImages?: string[];
  /** Role of each entry in `referenceImages`, same order/length when present. */
  /**
   * Parallel to referenceImages: why each image is attached. An adapter turns a
   * role into a directive, which is what keeps a style reference from steering
   * composition or a composition reference from recolouring the product.
   * `reference` is the untyped legacy role.
   */
  referenceRoles?: ReferenceRole[];
  width: number;
  height: number;
  count: number;
}

export interface EditRequest {
  instruction: string;
  sourceImage: string;
  brand: BrandContext;
  /** Region hint for localized edits; absent = whole image. */
  mask?: string;
  /** Paths of pixel-locked assets that must survive the edit (drift-diff inputs). */
  lockedAssets?: string[];
  /** Identity/style references, e.g. restore label/design during text removal. */
  referenceImages?: string[];
  /**
   * Role of each entry in `referenceImages`, same order/length when present.
   * Without this an adapter has to guess, and the codex edit path used to
   * assume every reference was a product — so a presenter's face arriving at
   * an edit was described to the model as "the exact product".
   */
  /**
   * Parallel to referenceImages: why each image is attached. An adapter turns a
   * role into a directive, which is what keeps a style reference from steering
   * composition or a composition reference from recolouring the product.
   * `reference` is the untyped legacy role.
   */
  referenceRoles?: ReferenceRole[];
  /**
   * The exact output size the caller will composite against, when it has one
   * (an expansion plans its frame to the pixel). Advisory: an adapter that can
   * ask its model for exact dimensions does, the rest ignore it — the caller's
   * compositing pass owns the guarantee either way, this only spares a rescale
   * when the engine complies.
   */
  width?: number;
  height?: number;
  /**
   * This edit is an EXPANSION, and where the original sits inside the frame it
   * is growing into.
   *
   * An adapter with a real outpainting endpoint uses this to ask for exactly
   * that: a model conditioned on the picture, painting only the margin. One
   * that has none ignores it and keeps receiving the whole bed with an
   * instruction, which is a re-render of everything and cannot be relied on to
   * continue the picture's geometry across the join.
   *
   * The caller composites the original back either way, so this changes how
   * good the margin is, never whether the picture survives.
   */
  expand?: {
    /** Where the original's top-left lands in the new frame. */
    left: number;
    top: number;
    /** The original's own size, unscaled. */
    width: number;
    height: number;
  };
  /**
   * Makes a generation repeatable on an adapter whose provider accepts one.
   *
   * Without it the same request returns a different picture every time, which
   * is not merely untidy: an expansion's seam quality was measured at 2.8, 15.1
   * and 2.1 across three identical calls, so nothing about the margin could be
   * tested, tuned or regressed. Adapters that have no seed ignore this, and are
   * honest about it through `supportsOutpaint`.
   */
  seed?: number;
}

export interface EngineResult {
  images: string[]; // absolute paths written into the content-addressed store
  costUsd: number; // 0 for externally-billed engines
  raw?: unknown; // provider response for debugging
}

/**
 * How far a delivered aspect ratio may sit from the requested one before it
 * counts as a failed generation rather than provider rounding.
 *
 * Anchored on real cases rather than picked for roundness. Providers that take
 * a fixed ratio menu instead of pixel dimensions must snap: 900x1000 -> 1:1 and
 * 1600x1000 -> 16:9 are each ~11% off and are the intended, harmless behaviour.
 * A whole bucket substitution is not harmless: the 4:5 portrait the Look
 * catalog is built on lands 25% away when it is silently squared, which
 * destroys the composition the user asked for. 15% separates the two.
 *
 * Both the request-time refusal and the post-generation check read this, so an
 * engine can never be allowed to snap in a way the delivered-image check would
 * then reject.
 */
export const ASPECT_TOLERANCE = 0.15;

/**
 * Common shapes, so a frame can be named rather than described in pixels.
 *
 * A model composes for "16:9" far more readily than for "1824 by 1024", and
 * codex's image tool takes no size parameter at all — the shape has to arrive
 * as language or the frame is composed at whatever the tool felt like. Moved
 * here from the CLI's expandRules so the codex engine can name shapes in its
 * own prompts; aspect language is this module's jurisdiction.
 */
const NAMED_RATIOS: Array<[string, number]> = [
  ['1:1', 1],
  ['4:5', 4 / 5],
  ['5:4', 5 / 4],
  ['2:3', 2 / 3],
  ['3:2', 3 / 2],
  ['3:4', 3 / 4],
  ['4:3', 4 / 3],
  ['9:16', 9 / 16],
  ['16:9', 16 / 9],
  ['2:1', 2],
  ['1:2', 0.5],
];

export function ratioLabel(width: number, height: number): string {
  const ratio = width / height;
  for (const [label, value] of NAMED_RATIOS) {
    if (Math.abs(ratio - value) / value < 0.02) return label;
  }
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const d = gcd(width, height) || 1;
  return `${Math.round(width / d)}:${Math.round(height / d)}`;
}

export interface EngineCapabilities {
  id: string; // "codex-cli" | "openrouter" | ...
  displayName: string;
  localOnly: boolean; // true => never available in hosted mode
  supportsEdit: boolean;
  supportsMask: boolean;
  /**
   * True when the adapter has a real outpainting endpoint — one that is given
   * the picture and where it sits in a larger frame, and paints only the
   * margin. False means an expansion is served by re-rendering the whole
   * canvas, which preserves the picture (the caller composites it back) but
   * cannot be relied on to continue its geometry across the join.
   */
  supportsOutpaint?: boolean;
  maxReferenceImages: number;
  /**
   * The longest edge, in pixels, a reference image is worth handing to this
   * engine. When set, the server downscales reference copies to fit before a
   * job (stored originals are untouched); absent means send as-is. Engines
   * that read references at reduced resolution server-side set this so a
   * full-resolution phone photo does not ride the uplink for nothing.
   */
  maxReferenceEdge?: number;
  /**
   * True for stub engines that draw placeholder art instead of calling a
   * model (the offline demo engine). Fidelity guarantees do not apply — the
   * output is obviously not a real photograph — so identity guards that would
   * refuse a real engine must skip these.
   */
  placeholder?: boolean;
}

/**
 * Why an engine is not ready, in the one vocabulary the setup UI can act on.
 *
 * `reason` is prose for a human; `code` is for a wizard that has to decide
 * which step to open. Only adapters with a real setup path (a local binary to
 * install and a session to sign into) set it — a missing API key is already a
 * one-step fix the Settings pane covers. `unverified` is the honest answer
 * when the probe itself could not finish: unknown is never available.
 */
export type UnavailableCode = 'not-installed' | 'not-authenticated' | 'update-needed' | 'unverified';

export interface EngineAvailability {
  ok: boolean;
  reason?: string;
  code?: UnavailableCode;
}

export interface EngineAdapter {
  capabilities(): EngineCapabilities;
  /** Cheap readiness probe: binary present, session valid, key set, etc. */
  isAvailable(): Promise<EngineAvailability>;
  costEstimate(req: GenerateRequest | EditRequest): Promise<number>;
  generate(req: GenerateRequest, signal?: AbortSignal): Promise<EngineResult>;
  edit(req: EditRequest, signal?: AbortSignal): Promise<EngineResult>;
}
