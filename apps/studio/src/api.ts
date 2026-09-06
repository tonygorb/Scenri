/**
 * The studio's one API surface. Types live in api.types.ts, the fetch helper
 * in api.req.ts, multipart/upload helpers in api.uploads.ts, and the scene
 * name-alias labeller in api.labels.ts — all re-exported here so every
 * existing `from '../api.js'` import keeps working unchanged.
 */
export type * from './apiTypes.js';
export * from './apiUploads.js';
export * from './apiLabels.js';
import { req } from './apiReq.js';
import { feedSearchParams } from './feedRules.js';
import type {
  ActivityNode,
  AssetBuild,
  AssetBuildCapabilities,
  Brand,
  BriefPreview,
  CatalogImportJob,
  CatalogSource,
  CodexSetupResult,
  CodexSetupState,
  DemoProduct,
  EngineInfo,
  FeedNode,
  FeedPage,
  FeedQuery,
  Lineage,
  Presenter,
  PresenterPatch,
  Product,
  Project,
  ReleaseNotesResponse,
  Scene,
  ScenePatch,
  SetupPlatform,
  ShotSet,
  ShowcaseEntry,
  TreeNode,
  DesktopStatus,
  UpdateStatus,
  UsageDay,
  VersionInfo,
  Workspace,
} from './apiTypes.js';

export const api = {
  brands: () => req<Brand[]>('GET', '/api/brands'),
  /** Every brand as the switcher and the route resolver need it, never the document. */
  /** One brand's whole document. */
  createBrand: (brand: any) => req<Brand>('POST', '/api/brands', { brand }),
  brandFromUrl: (url: string) => req<Brand & { warnings: string[] }>('POST', '/api/brands/from-url', { url }),
  updateBrand: (id: string, brand: any) => req<Brand>('PUT', `/api/brands/${id}`, { brand }),
  deleteBrand: (id: string) => req<{ ok: true }>('DELETE', `/api/brands/${id}`),
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
  /** The brand's frame: project, root, sets, memberships and the newest shots. Never every shot. */
  workspace: (brandId: string) => req<Workspace>('GET', `/api/brands/${brandId}/workspace`),
  /** One page of the brand's shots for a place, lens, search and sort. */
  feed: (brandId: string, query: FeedQuery, signal?: AbortSignal) =>
    req<FeedPage>('GET', `/api/brands/${brandId}/feed${feedSearchParams(query)}`, undefined, signal),
  /** One shot, whole: the prompt and everything else a list leaves out. */
  node: (id: string) => req<TreeNode>('GET', `/api/nodes/${id}`),
  /** Where one shot sits in its tree. */
  lineage: (id: string) => req<Lineage>('GET', `/api/nodes/${id}/lineage`),
  /** A year of runs by day. */
  usage: (brandId: string) => req<{ days: UsageDay[] }>('GET', `/api/brands/${brandId}/usage`),
  sets: (brandId: string) => req<ShotSet[]>('GET', `/api/brands/${brandId}/sets`),
  createSet: (brandId: string, name: string) => req<ShotSet>('POST', `/api/brands/${brandId}/sets`, { name }),
  renameSet: (id: string, name: string) => req<ShotSet>('PATCH', `/api/sets/${id}`, { name }),
  /** The set goes; every shot that was in it stays where it was. */
  deleteSet: (id: string) => req<{ ok: true }>('DELETE', `/api/sets/${id}`),
  addToSet: (id: string, nodeIds: string[]) =>
    req<{ ok: true; added: number; nodeIds: string[] }>('POST', `/api/sets/${id}/nodes`, { nodeIds }),
  removeFromSet: (id: string, nodeId: string) => req<{ ok: true }>('DELETE', `/api/sets/${id}/nodes/${nodeId}`),
  engines: () => req<EngineInfo[]>('GET', '/api/engines'),
  codexStatus: () =>
    req<{ state: CodexSetupState; reason?: string; platform?: SetupPlatform }>('GET', '/api/engines/codex/status'),
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
    /** Edit with a new shape: cut down to it, or build out to it. Explicit,
     * because the two ops preserve pixels in opposite ways. */
    reshape?: 'crop' | 'extend';
    templateId?: string;
    templateFields?: Record<string, string>;
    productId?: string;
    /**
     * The accepted shot, plus whatever the compiler wanted said about the
     * brief that made it: a scene built around a product with none attached,
     * an asset that has gone, a reference this engine could not carry. The
     * server has always sent these; nothing used to read them.
     */
  }) =>
    // the first node is spread into the response so `.id` readers keep
    // working; `siblings` is the whole batch, slot 0 first
    req<TreeNode & { warnings?: string[]; siblings: TreeNode[] }>('POST', '/api/nodes', p),
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
  previewBrief: (brief: unknown, engineId: string, brandId: string, parentId?: string) =>
    // a parentId makes it a REFINE preview: the server runs the same
    // inheritance and budget path the send will run
    req<BriefPreview>('POST', '/api/brief/preview', { brief, engineId, brandId, ...(parentId ? { parentId } : {}) }),
  keep: (nodeId: string, kept: boolean) => req<FeedNode>('POST', `/api/nodes/${nodeId}/keep`, { kept }),
  archiveNode: (nodeId: string, archived: boolean) =>
    req<FeedNode>('POST', `/api/nodes/${nodeId}/archive`, { archived }),
  deleteNode: (nodeId: string) => req<{ ok: true }>('DELETE', `/api/nodes/${nodeId}`),
  deleteNodesBatch: (nodeIds: string[]) =>
    req<{ ok: true; deleted: number }>('POST', '/api/nodes/delete-batch', { nodeIds }),
  settings: () => req<Record<string, boolean>>('GET', '/api/settings'),
  saveSettings: (s: Record<string, string | boolean>) => req<{ ok: true }>('PUT', '/api/settings', s),
  costs: () => req<{ byEngine: Record<string, number>; caps: Record<string, number> }>('GET', '/api/costs/summary'),
  /** Where the library lives on this machine, and how big it has grown. */
  home: () => req<{ dir: string; dbPath: string; images: number; bytes: number }>('GET', '/api/home'),
  reveal: () => req<{ ok: true }>('POST', '/api/system/reveal'),
  version: () => req<VersionInfo>('GET', '/api/version'),
  updateStatus: () => req<UpdateStatus>('GET', '/api/update/status'),
  updateCheck: () => req<UpdateStatus>('POST', '/api/update/check'),
  updateApply: () => req<{ ok: true; staging: string }>('POST', '/api/update/apply'),
  updateRestart: () => req<{ ok: true }>('POST', '/api/update/restart'),
  desktop: () => req<DesktopStatus>('GET', '/api/desktop'),
  desktopInstall: () => req<{ ok: true; path: string }>('POST', '/api/desktop/install'),
  /** Drain and stop the server; the overlay says how to come back. */
  quit: () => req<{ ok: true }>('POST', '/api/system/quit'),
  releaseNotes: () => req<ReleaseNotesResponse>('GET', '/api/release/notes'),
  releaseSeen: (version: string) => req<{ ok: true }>('POST', '/api/release/seen', { version }),
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
  /** Catalog products only — the fields this app invents; the store owns the rest. */
  updateCatalogProduct: (
    brandId: string,
    productId: string,
    patch: Partial<Pick<Product, 'category' | 'variant' | 'material' | 'dimensions'>>,
  ) => req<{ product: unknown }>('PATCH', `/api/brands/${brandId}/catalog/products/${productId}`, patch),
  /**
   * The product's reference set, in the order it should be read: `files` is
   * the whole list, so leaving one out removes it and moving one to the front
   * makes it the reference every shot is built from. Works for both kinds.
   */
  setProductShots: (brandId: string, productId: string, files: string[]) =>
    req<Brand>('PUT', `/api/brands/${brandId}/products/${productId}/shots`, { files }),

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
  /** Read a scene's own references again, in place. One analysis, asked for out loud. */
  rereadScene: (brandId: string, sceneId: string, correction?: string) =>
    req<{ jobId: string }>('POST', `/api/brands/${brandId}/scenes/${sceneId}/reread`, { correction }),
};

/**
 * Whether this machine can read references and draw from them.
 *
 * Both are accelerators, not gates: without them a person is still made from
 * the photos as they arrive, and a place from a sentence. The creation flow
 * reads this so it can say which of those is about to happen.
 */
