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
    "the brand's own mark — if the direction calls for the mark to appear, reproduce it exactly as drawn, same colours, letterforms and proportions; otherwise take only its colour and treatment, and never its subject, geometry or composition",
  scene: 'a reference for the environment and light only — take no subject, product or person from it',
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
  brand: "the brand's own mark: reproduce it exactly as drawn wherever it appears, never redrawn or re-lettered",
  scene: 'a reference for environment and light only',
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

export interface EngineCapabilities {
  id: string; // "codex-cli" | "openrouter" | ...
  displayName: string;
  localOnly: boolean; // true => never available in hosted mode
  supportsEdit: boolean;
  supportsMask: boolean;
  maxReferenceImages: number;
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
 * one-step fix the Settings pane covers.
 */
export type UnavailableCode = 'not-installed' | 'not-authenticated';

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
