/**
 * EngineAdapter — the one interface every generation backend implements.
 *
 * Contract notes:
 * - Adapters must be side-effect free until generate/edit is called.
 * - `costEstimate` returns 0 for engines billed outside the app (e.g. a local
 *   agent session); the cost ledger records estimates, never invents charges.
 * - Local-agent adapters (codex-cli) are OSS-local only and must respect the
 *   `localOnly` capability flag: the hosted product never bridges a user's
 *   subscription session (see docs/STRATEGY.md §13).
 */

export interface BrandContext {
  /** Parsed brand.json (see @scenri/brand). Injected into generation. */
  brand: unknown;
  /** Absolute paths of resolved brand assets (logos, style refs, locked shots). */
  assetPaths: Record<string, string>;
}

export interface GenerateRequest {
  prompt: string;
  brand: BrandContext;
  referenceImages?: string[];
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
  /** Product fidelity references, e.g. restore label/design during text removal. */
  referenceImages?: string[];
}

export interface EngineResult {
  images: string[]; // absolute paths written into the content-addressed store
  costUsd: number; // 0 for externally-billed engines
  raw?: unknown; // provider response for debugging
}

export interface EngineCapabilities {
  id: string; // "codex-cli" | "openrouter" | ...
  displayName: string;
  localOnly: boolean; // true => never available in hosted mode
  supportsEdit: boolean;
  supportsMask: boolean;
  maxReferenceImages: number;
}

export interface EngineAdapter {
  capabilities(): EngineCapabilities;
  /** Cheap readiness probe: binary present, session valid, key set, etc. */
  isAvailable(): Promise<{ ok: boolean; reason?: string }>;
  costEstimate(req: GenerateRequest | EditRequest): Promise<number>;
  generate(req: GenerateRequest, signal?: AbortSignal): Promise<EngineResult>;
  edit(req: EditRequest, signal?: AbortSignal): Promise<EngineResult>;
}
