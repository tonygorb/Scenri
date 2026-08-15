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
  kept: boolean;
  error: string | null;
  createdAt: string;
  /**
   * Captions once laid over a shot. scenri makes the picture; composing type
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
  } | null;
  archived: boolean;
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
export type UnavailableCode = 'not-installed' | 'not-authenticated';

export type CodexSetupState = 'not-installed' | 'not-authenticated' | 'ready';

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
  available: boolean;
  reason: string | null;
  code: UnavailableCode | null;
  monthlySpend: number;
  cap: number | null;
  /** Not billed per image through scenri. Not a claim that it costs nothing. */
  free: boolean;
  perGeneration: number;
  generationsLeft: number | null;
  generationsTotal: number | null;
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j.error ?? msg;
      if (j.details) msg += `: ${j.details.join('; ')}`;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  brands: () => req<Brand[]>('GET', '/api/brands'),
  createBrand: (brand: any) => req<Brand>('POST', '/api/brands', { brand }),
  brandFromUrl: (url: string) => req<Brand & { warnings: string[] }>('POST', '/api/brands/from-url', { url }),
  updateBrand: (id: string, brand: any) => req<Brand>('PUT', `/api/brands/${id}`, { brand }),
  deleteBrand: (id: string) => req<{ ok: true }>('DELETE', `/api/brands/${id}`),
  /** The brand rules the compiler appends to every shot in this brand. */
  brandRules: (id: string) => req<{ directives: string[] }>('GET', `/api/brands/${id}/directives`),
  /**
   * Re-read the brand's own website. Merges: hand-edited fields survive, and
   * scraped colours come back as `suggestions` rather than being applied.
   */
  refreshBrandFromUrl: (id: string, url?: string) =>
    req<Brand & { warnings: string[]; suggestions: { palette: { hex: string }[] } }>(
      'POST',
      `/api/brands/${id}/refresh-from-url`,
      url ? { url } : {},
    ),
  updateLogo: (brandId: string, hash: string, patch: { role?: string; background?: string; clearSpace?: string }) =>
    req<Brand>('PATCH', `/api/brands/${brandId}/logos/${hash}`, patch),
  deleteLogo: (brandId: string, hash: string) => req<Brand>('DELETE', `/api/brands/${brandId}/logos/${hash}`),
  projects: (brandId: string) => req<Project[]>('GET', `/api/projects?brandId=${encodeURIComponent(brandId)}`),
  createProject: (brandId: string, name: string) =>
    req<{ project: Project; root: TreeNode }>('POST', '/api/projects', { brandId, name }),
  tree: (projectId: string) => req<{ project: Project; nodes: TreeNode[] }>('GET', `/api/projects/${projectId}/tree`),
  /** Everything running or lately finished in a brand, generations and imports together. */
  activity: (brandId: string) =>
    req<{ nodes: ActivityNode[]; jobs: CatalogImportJob[] }>('GET', `/api/brands/${brandId}/activity`),
  /** The brand's shots, sets and memberships in one request. */
  workspace: (brandId: string) => req<Workspace>('GET', `/api/brands/${brandId}/workspace`),
  sets: (brandId: string) => req<ShotSet[]>('GET', `/api/brands/${brandId}/sets`),
  createSet: (brandId: string, name: string) => req<ShotSet>('POST', `/api/brands/${brandId}/sets`, { name }),
  renameSet: (id: string, name: string) => req<ShotSet>('PATCH', `/api/sets/${id}`, { name }),
  /** The set goes; every shot that was in it stays where it was. */
  deleteSet: (id: string) => req<{ ok: true }>('DELETE', `/api/sets/${id}`),
  addToSet: (id: string, nodeIds: string[]) =>
    req<{ ok: true; added: number }>('POST', `/api/sets/${id}/nodes`, { nodeIds }),
  removeFromSet: (id: string, nodeId: string) => req<{ ok: true }>('DELETE', `/api/sets/${id}/nodes/${nodeId}`),
  engines: () => req<EngineInfo[]>('GET', '/api/engines'),
  codexStatus: () => req<{ state: CodexSetupState; reason?: string }>('GET', '/api/engines/codex/status'),
  installCodex: () => req<CodexSetupResult>('POST', '/api/engines/codex/install'),
  /** Resolves when the browser sign-in finishes; poll codexStatus alongside it. */
  loginCodex: () => req<CodexSetupResult>('POST', '/api/engines/codex/login'),
  setCap: (engineId: string, capUsd: number | null) => req<{ ok: true }>('PUT', '/api/caps', { engineId, capUsd }),
  addNode: (p: {
    projectId: string;
    parentId?: string | null;
    kind: 'generation' | 'edit';
    prompt?: string;
    engineId: string;
    brief?: unknown;
    count?: number;
    width?: number;
    height?: number;
    sourceImage?: string;
    templateId?: string;
    templateFields?: Record<string, string>;
    productId?: string;
    /**
     * The accepted shot, plus whatever the compiler wanted said about the
     * brief that made it: a scene built around a product with none attached,
     * an asset that has gone, a reference this engine could not carry. The
     * server has always sent these; nothing used to read them.
     */
  }) => req<TreeNode & { warnings?: string[] }>('POST', '/api/nodes', p),
  cancelNode: (nodeId: string) => req<{ ok: true }>('POST', `/api/nodes/${nodeId}/cancel`),
  scenes: () => req<{ scenes: Scene[]; collections: string[]; verticals: string[] }>('GET', '/api/scenes'),
  presenters: () => req<{ presenters: Presenter[]; categories: string[]; styles: string[] }>('GET', '/api/presenters'),
  /** The reference frames a presenter has on disk, if any. */
  presenterFrames: (id: string) => req<{ frames: string[] }>('GET', `/api/presenter-previews/${id}`),
  demoProducts: () => req<{ demoProducts: DemoProduct[]; categories: string[] }>('GET', '/api/demo-products'),
  /** A demo product's full angle set. Unlike a presenter's positional ref-0N slots,
   *  a product's angles are semantic, so each frame carries its key for labelling. */
  demoProductFrames: (id: string) =>
    req<{ frames: { angle: string; url: string }[] }>('GET', `/api/demo-product-previews/${id}`),
  showcase: () => req<{ showcase: ShowcaseEntry[]; categories: string[] }>('GET', '/api/showcase'),
  exportPresets: () => req<ExportPreset[]>('GET', '/api/export/presets'),
  previewBrief: (brief: unknown, engineId: string, brandId: string) =>
    req<BriefPreview>('POST', '/api/brief/preview', { brief, engineId, brandId }),
  keep: (nodeId: string, kept: boolean) => req<TreeNode>('POST', `/api/nodes/${nodeId}/keep`, { kept }),
  archiveNode: (nodeId: string, archived: boolean) =>
    req<TreeNode>('POST', `/api/nodes/${nodeId}/archive`, { archived }),
  deleteNode: (nodeId: string) => req<{ ok: true }>('DELETE', `/api/nodes/${nodeId}`),
  deleteNodesBatch: (nodeIds: string[]) =>
    req<{ ok: true; deleted: number }>('POST', '/api/nodes/delete-batch', { nodeIds }),
  diff: (imageA: string, imageB: string) =>
    req<{ score: number; heatmapHash: string }>('POST', '/api/diff', { imageA, imageB }),
  settings: () => req<Record<string, boolean>>('GET', '/api/settings'),
  saveSettings: (s: Record<string, string>) => req<{ ok: true }>('PUT', '/api/settings', s),
  costs: () => req<{ byEngine: Record<string, number>; caps: Record<string, number> }>('GET', '/api/costs/summary'),
  /** Where the library lives on this machine, and how big it has grown. */
  home: () => req<{ dir: string; dbPath: string; images: number; bytes: number }>('GET', '/api/home'),
  reveal: () => req<{ ok: true }>('POST', '/api/system/reveal'),
  /** The reference frames a scene has on disk, if any. */
  sceneFrames: (id: string) => req<{ frames: string[] }>('GET', `/api/scene-previews/${id}`),
  deleteData: (scope: 'shots' | 'all') => req<{ ok: true; scope: string }>('DELETE', `/api/data?scope=${scope}`),
  productsLibrary: (brandId: string) =>
    req<{ products: Product[]; source: CatalogSource | null }>('GET', `/api/brands/${brandId}/products-library`),
  catalogImport: (brandId: string, url: string) =>
    req<{ jobId: string }>('POST', `/api/brands/${brandId}/catalog/import`, { url }),
  catalogJob: (brandId: string, jobId: string) =>
    req<CatalogImportJob>('GET', `/api/brands/${brandId}/catalog/jobs/${jobId}`),
  catalogJobs: (brandId: string) => req<{ jobs: CatalogImportJob[] }>('GET', `/api/brands/${brandId}/catalog/jobs`),
  cancelCatalogJob: (brandId: string, jobId: string) =>
    req<{ ok: true }>('POST', `/api/brands/${brandId}/catalog/jobs/${jobId}/cancel`),
  deleteCatalogProduct: (brandId: string, productId: string) =>
    req<{ ok: true }>('DELETE', `/api/brands/${brandId}/catalog/products/${productId}`),
  /** Manual products only — name/category/variant/material/dimensions. */
  updateProduct: (
    brandId: string,
    productId: string,
    patch: Partial<Pick<Product, 'name' | 'category' | 'variant' | 'material' | 'dimensions'>>,
  ) => req<Brand>('PATCH', `/api/brands/${brandId}/products/${productId}`, patch),
  /** Catalog products only — a category override, the one field this app invents. */
  updateCatalogProductCategory: (brandId: string, productId: string, category: string | null) =>
    req<{ product: unknown }>('PATCH', `/api/brands/${brandId}/catalog/products/${productId}`, { category }),

  // ---- presenters and scenes a brand builds for itself
  /** What this machine can actually do, asked before anything is promised. */
  assetBuildCapabilities: () => req<AssetBuildCapabilities>('GET', '/api/asset-builds/capabilities'),
  startAssetBuild: (
    brandId: string,
    p: {
      kind: 'presenter' | 'scene';
      name: string;
      instruction?: string;
      imageHashes: string[];
      /** Where it files: a presenter's industries, a scene's verticals. */
      facets?: string[];
    },
  ) => req<{ jobId: string }>('POST', `/api/brands/${brandId}/asset-builds`, p),
  assetBuild: (brandId: string, jobId: string) =>
    req<AssetBuild>('GET', `/api/brands/${brandId}/asset-builds/${jobId}`),
  assetBuilds: (brandId: string) => req<{ builds: AssetBuild[] }>('GET', `/api/brands/${brandId}/asset-builds`),
  cancelAssetBuild: (brandId: string, jobId: string) =>
    req<{ ok: true }>('POST', `/api/brands/${brandId}/asset-builds/${jobId}/cancel`),
  /** Dismiss a build that is over. Cancelling stops work; this only forgets it. */
  deleteAssetBuild: (brandId: string, jobId: string) =>
    req<{ ok: true }>('DELETE', `/api/brands/${brandId}/asset-builds/${jobId}`),
  /**
   * A product from images already in the store, in one write.
   *
   * The multipart sibling (`uploadProduct`) takes one file and answers with the
   * whole brand, which left the caller diffing the library to work out what it
   * had just made. This one says.
   */
  createProduct: (brandId: string, p: { name: string; imageHashes: string[]; category?: string }) =>
    req<Brand & { productId: string }>('POST', `/api/brands/${brandId}/products`, p),
  /** Write a presenter with no build behind it: the photos become the references. */
  createPresenter: (brandId: string, p: { name: string; shotHashes: string[]; sourceHashes?: string[] }) =>
    req<{ presenter: unknown; brand: Brand }>('POST', `/api/brands/${brandId}/presenters`, p),
  updatePresenter: (brandId: string, presenterId: string, patch: PresenterPatch) =>
    req<{ presenter: unknown; brand: Brand }>('PATCH', `/api/brands/${brandId}/presenters/${presenterId}`, patch),
  deletePresenter: (brandId: string, presenterId: string) =>
    req<{ ok: true }>('DELETE', `/api/brands/${brandId}/presenters/${presenterId}`),
  createScene: (brandId: string, p: ScenePatch) =>
    req<{ scene: unknown; warnings: string[]; brand: Brand }>('POST', `/api/brands/${brandId}/scenes`, p),
  updateScene: (brandId: string, sceneId: string, patch: ScenePatch) =>
    req<{ scene: unknown; warnings: string[]; brand: Brand }>(
      'PATCH',
      `/api/brands/${brandId}/scenes/${sceneId}`,
      patch,
    ),
  deleteScene: (brandId: string, sceneId: string) =>
    req<{ ok: true }>('DELETE', `/api/brands/${brandId}/scenes/${sceneId}`),
  /** Redraw a scene's example. One generation, always asked for out loud. */
  generateScenePreview: (brandId: string, sceneId: string) =>
    req<{ preview: string; brand: Brand }>('POST', `/api/brands/${brandId}/scenes/${sceneId}/preview`),
};

/**
 * Whether this machine can read references and draw from them.
 *
 * Both are accelerators, not gates: without them a person is still made from
 * the photos as they arrive, and a place from a sentence. The creation flow
 * reads this so it can say which of those is about to happen.
 */
export interface AssetBuildCapabilities {
  canAnalyze: boolean;
  analyzeReason: string | null;
  canGenerate: boolean;
  engineId: string | null;
  engineName: string | null;
  /** Not billed per image through scenri. Codex still spends a ChatGPT plan. */
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
  shots?: { file: string; angle?: string; locked?: boolean; alt?: string | null }[];
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
export async function uploadAsset(brandId: string, kind: 'products', file: File, name: string): Promise<Brand> {
  const fd = new FormData();
  fd.append('name', name);
  fd.append('file', file);
  const res = await fetch(`/api/brands/${brandId}/${kind}`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as any).error ?? `HTTP ${res.status}`);
  return res.json();
}
export const uploadProduct = (brandId: string, file: File, name: string) =>
  uploadAsset(brandId, 'products', file, name);
export const deleteAsset = (brandId: string, kind: 'products', assetId: string) =>
  req<Brand>('DELETE', `/api/brands/${brandId}/${kind}/${assetId}`);
export const deleteProduct = (brandId: string, productId: string) => deleteAsset(brandId, 'products', productId);

/** Upload a brand mark. Re-uploading the same artwork retags it rather than adding a twin. */
export async function uploadLogo(
  brandId: string,
  file: File,
  opts: { role?: string; background?: string } = {},
): Promise<Brand> {
  const fd = new FormData();
  if (opts.role) fd.append('role', opts.role);
  if (opts.background) fd.append('background', opts.background);
  fd.append('file', file);
  const res = await fetch(`/api/brands/${brandId}/logos`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as any).error ?? `HTTP ${res.status}`);
  return res.json();
}

/** Where the browser fetches a `.brand` bundle from — a plain link, so no blob juggling. */
export const brandExportUrl = (brandId: string) => `/api/brands/${brandId}/export`;

/** One more reference angle onto an existing manual product (not a new product). */
export async function addProductShot(brandId: string, productId: string, file: File, angle?: string): Promise<Brand> {
  const fd = new FormData();
  if (angle) fd.append('angle', angle);
  fd.append('file', file);
  const res = await fetch(`/api/brands/${brandId}/products/${productId}/shots`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as any).error ?? `HTTP ${res.status}`);
  return res.json();
}

/** Put any image in the content store and get its hash back (reference uploads). */
export async function uploadImage(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/images', { method: 'POST', body: fd });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as any).error ?? `HTTP ${res.status}`);
  return (await res.json()).hash as string;
}

export interface ExportPreset {
  id: string;
  label: string;
  width: number | null;
  height: number | null;
}

/**
 * A last-gasp brand save for a page that is going away.
 *
 * `beforeunload` cannot await anything: the normal request is abandoned the
 * moment the document is torn down, which is how a headline typed in the last
 * fraction of a second before a reload was lost. `keepalive` hands the request
 * to the browser to finish on its own. Nothing can be reported back, so
 * nothing tries.
 */
export function saveBrandOnUnload(brandId: string, brand: unknown): void {
  try {
    void fetch(`/api/brands/${brandId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brand }),
      keepalive: true,
    });
  } catch {
    /* the page is leaving and there is no one left to tell */
  }
}

export const imgUrl = (hash: string) => `/api/images/${hash}`;
/** Renders an `asset:<hash>` brand ref as an image URL, or null. */
export const assetUrl = (ref?: string) => (ref?.startsWith('asset:') ? imgUrl(ref.slice(6)) : null);

export async function downloadExport(imageHash: string, presets: string[], baseName: string) {
  const res = await fetch('/api/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ imageHash, presets, baseName }),
  });
  if (!res.ok) throw new Error(`export failed: HTTP ${res.status}`);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${baseName || 'scenri-export'}.zip`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** True when a brand has made nothing at all yet — any status, not just done-and-imaged. Every caller pairs this with `loaded`: check `loaded` first so a cold fetch isn't mistaken for a genuinely empty brand. */
export function hasNoShots(nodes: TreeNode[]): boolean {
  return nodes.every((n) => n.kind === 'root');
}

/**
 * Legacy scene display names mapped to the name that scene answers to now.
 *
 * A node's prompt is written once and never rewritten, so a shot made before a
 * scene was renamed carries the old name inside its `[Scene Name]` bracket
 * forever. That is right as a record of the text actually sent to the engine,
 * and wrong as a title in today's UI. `nodeLabel` consults this to show the
 * current name without rewriting a single stored prompt.
 *
 * A registry rather than a parameter on purpose: all thirteen `nodeLabel` call
 * sites want the same answer, most are deep in leaf components, and none of
 * them owns the scene catalog. Populated once from `useScenes`.
 */
let sceneNameAliases: ReadonlyMap<string, string> = new Map();

/** Rebuild the legacy-name map from the scene catalog. Called by `useScenes`. */
export function registerSceneNameAliases(scenes: Pick<Scene, 'name' | 'legacyNames'>[]): void {
  const m = new Map<string, string>();
  for (const s of scenes) {
    for (const legacy of s.legacyNames ?? []) if (legacy !== s.name) m.set(legacy, s.name);
  }
  sceneNameAliases = m;
}

/** Human title for a node: scene name, lift shorthand, or first words of the prompt. */
export function nodeLabel(n: TreeNode): string {
  const tag = /^\[([^\]]+)\]/.exec(n.prompt)?.[1];
  if (tag) return sceneNameAliases.get(tag) ?? tag;
  if (n.prompt.startsWith('Remove all overlaid marketing text') || n.prompt.startsWith('Remove ALL text'))
    return 'Text lift';
  const words = n.prompt.trim().split(/\s+/).slice(0, 6).join(' ');
  return words || (n.kind === 'edit' ? 'Edit' : 'Generation');
}

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
  }[];
  warnings: string[];
  productId: string | null;
  referenceCount: number;
}
