/** The server's wire shapes. Runtime-free: types only, plus nothing else. */
export interface Brand {
  id: string;
  slug: string;
  json: any;
  createdAt: string;
  updatedAt: string;
}
export interface Project {
  id: string;
  brandId: string;
  name: string;
  /** Its place in the address bar, unique within the brand. */
  slug: string;
  createdAt: string;
}
export interface TreeNode {
  id: string;
  projectId: string;
  parentId: string | null;
  kind: 'root' | 'generation' | 'edit';
  prompt: string;
  engineId: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  images: string[];
  costUsd: number;
  /** Wall time of the run in milliseconds; null for legacy and unfinished shots. */
  durationMs: number | null;
  kept: boolean;
  error: string | null;
  createdAt: string;
  /**
   * Captions once laid over a shot. Scenri makes the picture; composing type
   * onto it was a different product. Nothing writes this any more, and the
   * field stays only because shots already carry it.
   */
  overlays: Record<string, TextLayer[]>;
  /**
   * The recipe, stored verbatim so the shot can be run again or reopened in
   * the composer. `variants` and `quality` are settings rather than sentence:
   * the compiler never reads them, and without them a re-run of a four-variant
   * shot came back with one frame. Null on shots made before briefs existed.
   */
  brief: {
    tokens: any[];
    templateId?: string;
    templateFields?: Record<string, string>;
    variants?: number;
    quality?: 'draft' | 'standard' | 'high';
    /**
     * The shape it was shot at. Recorded so a later composer can tell whether
     * you have asked for a different one, which an edit cannot deliver: the
     * send becomes a new shot from this same setup instead.
     */
    format?: string;
    /**
     * For a refinement, the image of the parent run it was actually made from.
     * A run holds several; without this every surface fell back to the first,
     * and a refinement of variant three claimed a source it never touched.
     */
    sourceImage?: string;
    /** Real delivered pixel sizes per image, recorded at completion. */
    rendered?: { sizes: [number, number][] };
    /** How the shape was reached, when it was asked for by name. */
    reshape?: 'crop' | 'extend';
    /**
     * For a refinement: the identity tokens carried from the shot it refines,
     * recorded apart from `tokens` so what was asked and what was inherited
     * stay distinguishable everywhere they are shown.
     */
    inherited?: any[];
  } | null;
  archived: boolean;
  /** The multi-shot request this node came from; null for single sends and
   * for every edit. Provenance only — never a user-facing hierarchy. */
  batchId: string | null;
  /** Which slot of that request this node filled; 0 outside a batch. */
  batchIndex: number;
}

/** A node carrying the sets it has been put in, for lists that span the brand. */
export interface ActivityNode extends TreeNode {
  /** Empty when the shot is in no set, which is an ordinary state, not a gap. */
  setNames: string[];
}

/**
 * An opt-in grouping of shots. Not a place work happens — that is the brand's
 * one workspace — only a name you hang finished shots on, and a shot may hang
 * on several.
 */
export interface ShotSet {
  id: string;
  brandId: string;
  name: string;
  /** Its place in the address bar, unique within the brand. */
  slug: string;
  createdAt: string;
  updatedAt: string;
}

/** The whole brand in one answer: its shots, its sets, and who is in what. */
export interface Workspace {
  project: Project;
  nodes: TreeNode[];
  sets: ShotSet[];
  membership: Record<string, string[]>;
}

export interface TextLayer {
  id: string;
  text: string;
  x: number; // % of image width (top-left)
  y: number; // % of image height
  width: number; // % of image width
  fontId: string;
  size: number; // px at 1024-wide base
  weight: number;
  color: string;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  opacity: number;
  shadow: { x: number; y: number; blur: number; color: string } | null;
  letterSpacing?: number; // px at 1024 base
  uppercase?: boolean;
  background?: { color: string; paddingX: number; paddingY: number; radius: number } | null;
  stroke?: { color: string; width: number } | null;
}
/** Which setup step would make an engine ready, when the engine knows. */
export type UnavailableCode = 'not-installed' | 'not-authenticated' | 'update-needed' | 'unverified';

export type CodexSetupState = 'not-installed' | 'not-authenticated' | 'update-needed' | 'unverified' | 'ready';

/** The server's own platform, so setup copy says PowerShell where it should. */
export type SetupPlatform = 'windows' | 'mac' | 'linux';

export interface CodexSetupResult {
  ok: boolean;
  state: CodexSetupState;
  /** What to run by hand when the automatic path could not work. */
  fallbackCommand?: string;
  docsUrl?: string;
  detail?: string;
}

export interface EngineInfo {
  id: string;
  displayName: string;
  localOnly: boolean;
  supportsEdit: boolean;
  /**
   * True when the engine can paint a margin around a picture rather than
   * re-render the whole frame from a sentence. Only these can grow a shot into
   * a new shape; the rest are offered the crop instead.
   */
  supportsOutpaint?: boolean;
  available: boolean;
  reason: string | null;
  code: UnavailableCode | null;
  monthlySpend: number;
  cap: number | null;
  /** Not billed per image through Scenri. Not a claim that it costs nothing. */
  free: boolean;
  perGeneration: number;
  generationsLeft: number | null;
  generationsTotal: number | null;
}

/**
 * A failed request, with the parts a bare Error threw away.
 *
 * Every call below funnels through `req`, and it used to flatten the status,
 * the method and the URL into a message string -- so all ~35 call sites that
 * surface an error could say *what* went wrong but never *which* request, or
 * with what code. Carrying them costs nothing and makes a failure diagnosable.
 */
export interface ApiError extends Error {
  status: number;
  method: string;
  url: string;
}

export type VersionInfo = {
  name: string;
  version: string;
  schema: number;
  /** How this build was installed; decides which update path the UI offers. */
  installKind: 'npx' | 'global' | 'managed' | 'dev' | 'unknown';
  supervised: boolean;
  home: string;
};

export type UpdateStatus = {
  enabled: boolean;
  current: string;
  latest: string | null;
  available: boolean;
  kind: 'major' | 'minor' | 'patch' | null;
  /** True only for a major step: pre-1.0 breaking changes ride minors and stay quiet. */
  attention: boolean;
  checkedAt: number | null;
  notesUrl: string | null;
  error: string | null;
  /** One-click is possible here; when false, blockReason names why and the manual command remains. */
  canApply: boolean;
  blockReason: 'dev' | 'unsupervised' | 'launcher-too-old' | 'no-npm' | null;
  phase: 'idle' | 'staging' | 'ready' | 'error';
  stagedVersion: string | null;
};

/**
 * What changed in the version this app IS — authored prose shipped inside the
 * build, not the update check's business. `entry` is null when a version went
 * out without notes; the dialog still names the version and links out.
 */
export type ReleaseSection = { heading: string; body: string };
export type ReleaseEntry = {
  version: string;
  date: string;
  title?: string;
  sections: ReleaseSection[];
  image?: string;
};
export type ReleaseNotesResponse = {
  version: string;
  entry: ReleaseEntry | null;
  /** The last version whose What's New was acknowledged on this machine. */
  seen: string | null;
  /** This exact release's page. Null on a build that was never released. */
  changelogUrl: string | null;
  /** The releases index — the archive behind "All releases". */
  releasesUrl: string | null;
};

export interface AssetBuildCapabilities {
  canAnalyze: boolean;
  analyzeReason: string | null;
  canGenerate: boolean;
  engineId: string | null;
  engineName: string | null;
  /** Not billed per image through Scenri. Codex still spends a ChatGPT plan. */
  free: boolean;
}

export interface AssetBuild {
  id: string;
  brandId: string;
  kind: 'presenter' | 'scene';
  name: string;
  stage: 'queued' | 'analyzing' | 'building' | 'saving' | 'done' | 'failed' | 'cancelled';
  step: number;
  steps: number;
  message: string | null;
  /** The finished asset's id, once it exists in the brand. */
  assetId: string | null;
  /** Something to look at while the rest is still being drawn. */
  previewHash: string | null;
  warnings: string[];
  /** Non-blocking notes on which further reference would buy consistency. */
  coverage: string[];
  facets: string[];
  error: string | null;
  startedAt: string;
  finished: boolean;
}

export interface PresenterPatch {
  name?: string;
  descriptor?: string;
  ageRange?: string;
  hair?: string;
  identityNotes?: string;
  negativeConstraints?: string[];
  /** Ordered. The first two are the views a brief attaches. */
  shotHashes?: string[];
  sourceHashes?: string[];
}

export interface ScenePatch {
  name?: string;
  lighting?: string;
  description?: string;
  subject?: 'product' | 'person' | 'either';
  prompt?: string;
  camera?: string;
  collections?: string[];
  verticals?: string[];
  keywords?: string[];
  instruction?: string;
  figure?: string;
  figureTreatment?: string;
  refHashes?: string[];
}

export interface SceneField {
  key: string;
  label: string;
  placeholder?: string;
}
/**
 * A scene is the photographic setup: light, ground, mood. It never names a
 * product — that arrives as its own ingredient and brings its own photo.
 */
export interface Scene {
  id: string;
  /** What humans read. Free to change: nothing resolves by it. */
  name: string;
  /**
   * The frozen descriptive phrase the compiler sends the engine. Server-side
   * concern — never render this; it is deliberately longer than `name`.
   */
  promptName?: string;
  description: string;
  /** Short phrase naming the light. Scenes relate to each other by this. */
  lighting: string;
  subject: 'product' | 'person' | 'either';
  collections: string[];
  verticals: string[];
  /** Vibrant colour pulled from the preview, for tinting the chip. */
  previewUrl?: string | null;
  previewColor?: string | null;
  /** Display names this scene used to carry. Searchable; never rendered. */
  legacyNames?: string[];
  /** Search vocabulary. Never rendered — this is what pays for a short `name`. */
  keywords?: string[];
  fields?: SceneField[];
  prompt: string;
  width: number;
  height: number;
  textZones?: {
    fieldKey: string;
    x: number;
    y: number;
    width: number;
    size: number;
    align: 'left' | 'center' | 'right';
    weightHint?: number;
  }[];
}
/**
 * A curated presenter: a fixed identity from the global catalog, browsable
 * and attachable straight into a brief the same way a Scene is — no per-brand
 * roster copy. `Product.presenterId`/`characters[]` still exist for brands
 * with entries from before this catalog existed.
 */
export interface Presenter {
  id: string;
  name: string;
  /**
   * The frozen phrase the compiler sends the engine, for a person built here
   * from their own photos. Never render it. A curated presenter has none and
   * is named to the engine by `name`, which is why a curated one cannot be
   * renamed without moving its generations.
   */
  promptName?: string;
  presentation: 'woman' | 'man';
  /** The casting-sheet caption, e.g. "Warm editorial · dark waves · confident, understated". */
  descriptor: string;
  ageRange: string;
  facial: string;
  skin: string;
  hair: string;
  build: string;
  wardrobeDefault: string;
  suitableCategories: string[];
  suitableStyles: string[];
  identityNotes: string;
  negativeConstraints: string[];
  width: number;
  height: number;
  /** The 4:5 waist-up casting thumbnail. Used by the /presenters grid cards. */
  previewUrl?: string | null;
  /**
   * Square head-and-shoulders portrait. Preferred wherever a presenter renders
   * small or square, because a 1:1 box crops the head off the 4:5 thumbnail.
   * Null when the presenter has no avatar yet — always fall back to previewUrl.
   */
  avatarUrl?: string | null;
}

/**
 * A curated, fictional-but-premium product from the global catalog — attaches
 * straight into a brief the same way a Presenter does, standing in for a real
 * uploaded product until the user swaps it for their own.
 */
export interface DemoProduct {
  id: string;
  /** What humans read. Free to change: nothing resolves by it. */
  name: string;
  /**
   * The frozen descriptive noun phrase the compiler sends the engine.
   * Server-side concern — never render this; it is deliberately longer than
   * `name` and exists so `name` can shrink without moving a generation.
   */
  promptName?: string;
  /** Lowercase key from productCategories.ts's PRODUCT_CATEGORIES. */
  category: string;
  description: string;
  width: number;
  height: number;
  previewUrl?: string | null;
  /** Fictional house name. Shown alongside `name` on cards and tooltips, not in chips. */
  brand?: string;
  /** Long descriptive form of the physical format. */
  subcategory?: string;
  /** Short physical format for tooltips, e.g. "330ml can". */
  format?: string;
  /** Display names this product used to carry. Searchable; never rendered. */
  legacyNames?: string[];
  /** Search vocabulary. Never rendered. */
  keywords?: string[];
}

/**
 * One curated homepage example: a real generated shot's exact recipe (same
 * shape as `TreeNode.brief`), so opening it reproduces the identical chips
 * that made the image, ready to remix.
 */
export interface ShowcaseEntry {
  id: string;
  title: string;
  category: string;
  brief: { tokens: any[]; templateFields?: Record<string, string> };
  /** Settings the example was shot with, applied on "Recreate this". */
  variants?: number;
  quality?: 'draft' | 'standard' | 'high';
  /** Curated homepage position; the server already returns entries sorted by it. */
  order?: number;
  /** Creative-family key — the visual mechanism behind the campaign. */
  family?: string;
  width: number;
  height: number;
  previewUrl?: string | null;
}

/** Products and cast are the same shape: a named thing with locked photos. */
export interface Product {
  id: string;
  name: string;
  shots?: { file: string; angle?: string; locked?: boolean; alt?: string | null; local?: boolean }[];
  /**
   * Store images taken out of the reference set. Never compiled into a shot.
   * Catalog products only — kept so a re-import does not fetch them back.
   * An image you uploaded yourself is deleted rather than excluded.
   */
  hiddenShots?: { file: string; angle?: string; locked?: boolean; alt?: string | null; local?: boolean }[];
  origin?: 'manual' | 'catalog';
  url?: string | null;
  price?: number | null;
  compareAtPrice?: number | null;
  currency?: string | null;
  vendor?: string | null;
  status?: string;
  /** Character only: set when adopted from the curated Presenter catalog. */
  presenterId?: string;
  /** One of PRODUCT_CATEGORIES's keys (see productCategories.ts) — drives the reference-angle checklist. Manually set, or suggested from a catalog import's productType/tags. */
  category?: string | null;
  /** Color/size/etc — free text, e.g. "Midnight Black, 42mm". */
  variant?: string | null;
  material?: string | null;
  dimensions?: string | null;
  /** Catalog-origin only, straight from the store's own taxonomy (see packages/core's catalogStore). */
  productType?: string | null;
  tags?: string[];
  descriptionHtml?: string | null;
  variants?: {
    id: string;
    title: string;
    sku?: string | null;
    price?: number | null;
    compareAtPrice?: number | null;
    currency?: string | null;
    available?: boolean | null;
    options?: Record<string, string>;
  }[];
}
export type Character = Product;

export type CatalogImportStage =
  | 'queued'
  | 'discovering'
  | 'fetching_products'
  | 'processing_assets'
  | 'completed'
  | 'partial'
  | 'failed';

export interface CatalogImportJob {
  id: string;
  brandId: string;
  sourceId: string | null;
  url: string;
  platform: string;
  stage: CatalogImportStage;
  discovered: number;
  fetched: number;
  upserted: number;
  imagesDone: number;
  imagesTotal: number;
  errors: { code: string; message: string; url?: string }[];
  warnings: string[];
  message: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface CatalogSource {
  id: string;
  brandId: string;
  url: string;
  platform: string;
  status: string;
  lastImportAt: string | null;
}

/** Manual upload into a brand's product library. */

export interface BriefPreview {
  prompt: string;
  width: number;
  height: number;
  // Mirrors the server's Attachment (packages/cli/src/brief.ts). 'character'
  // was missing here, so the client could not reason about presenter
  // references at all — including noticing when one had been dropped.
  attachments: {
    role: 'product' | 'character' | 'brand' | 'reference';
    /** Catalog id of the product/presenter this came from. Correlate on this, not `label`. */
    id?: string;
    label: string;
    hash: string;
    essential?: boolean;
    /** Carried from the shot being refined (preview with a parentId). */
    inherited?: boolean;
  }[];
  warnings: string[];
  productId: string | null;
  referenceCount: number;
  /**
   * Attachments the engine's reference budget left out (the kept ones are
   * `attachments`). The server has always sent this; declaring it lets the
   * composer state a loss structurally instead of prose-matching `warnings`.
   */
  dropped: {
    role: 'product' | 'character' | 'brand' | 'scene' | 'reference';
    id?: string;
    label: string;
    hash: string;
    essential?: boolean;
    inherited?: boolean;
  }[];
}
