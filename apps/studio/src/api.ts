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
import { brandKit } from './apiUploads.js';
import { feedSearchParams } from './feedRules.js';
import type {
  ActivityNode,
  AssetBuild,
  AssetBuildCapabilities,
  Brand,
  BriefPreview,
  HeroWith,
  SceneView,
  CatalogImportJob,
  CatalogSource,
  CodexSetupResult,
  CodexStatus,
  CatalogCandidate,
  CommerceScanState,
  ScrapeReport,
  DemoProduct,
  EngineInfo,
  FeedNode,
  FeedPage,
  FeedQuery,
  Lineage,
  Presenter,
  PresenterPatch,
  Product,
  ProductSize,
  Project,
  ReleaseNotesResponse,
  Scene,
  SceneExampleJob,
  SceneExampleRole,
  ScenePatch,
  SceneReading,
  SceneSetup,
  SceneStudioJob,
  SceneStudioJobKind,
  StudioWork,
  ShotSet,
  ShowcaseEntry,
  TreeNode,
  DesktopStatus,
  AllowResult,
  FirewallVerdict,
  PhoneStatus,
  UpdateStatus,
  UsageDay,
  VersionInfo,
  Workspace,
  PresenterDraft,
  PresenterDraftSummary,
  PresenterDraftView,
  GuideIntent,
  GuideView,
} from './apiTypes.js';

export const api = {
  brands: () => req<Brand[]>('GET', '/api/brands'),
  /** Every brand as the switcher and the route resolver need it, never the document. */
  /** One brand's whole document. */
  createBrand: (brand: any) => req<Brand>('POST', '/api/brands', { brand }),
  brandFromUrl: (url: string) =>
    req<Brand & { warnings: string[]; report: ScrapeReport }>('POST', '/api/brands/from-url', { url }),
  /**
   * A save from the brand kit: name, palette, logos, imagery, rules. It is
   * built from the brand the studio holds, so it asks the server to keep the
   * products, scenes and presenters as stored rather than as that copy saw them.
   */
  updateBrand: (id: string, brand: any) =>
    req<Brand>('PUT', `/api/brands/${id}`, { brand: brandKit(brand), keepAssets: true }),
  deleteBrand: (id: string) => req<{ ok: true }>('DELETE', `/api/brands/${id}`),
  /** The install's first-use record: who is new, what is done, and the task in hand with what it has made. */
  guide: () => req<GuideView>('GET', '/api/guide'),
  /** One change to it: answer the welcome, start, finish or dismiss a task, or hide the guidance. */
  // A lesson's step is written the moment it shows; a reload in that instant
  // must not lose it, so the browser finishes the write on its own.
  guideIntent: (intent: GuideIntent) => req<GuideView>('POST', '/api/guide', intent, undefined, { keepalive: true }),
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
    req<{ nodes: ActivityNode[]; jobs: CatalogImportJob[]; studio?: StudioWork[]; boot?: string }>(
      'GET',
      `/api/brands/${brandId}/activity`,
    ),
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
  removeFromSet: (id: string, nodeIds: string[]) =>
    req<{ ok: true; nodeIds: string[] }>('POST', `/api/sets/${id}/nodes/remove`, { nodeIds }),
  engines: () => req<EngineInfo[]>('GET', '/api/engines'),
  /** `force` pays for a real `codex exec` rather than reading the last verdict. */
  codexStatus: (o: { force?: boolean } = {}) =>
    req<CodexStatus>('GET', `/api/engines/codex/status${o.force ? '?force=1' : ''}`),
  /** Stop passing named credentials to codex. Nothing on the machine changes. */
  repairCodexEnv: (keys: string[]) =>
    req<CodexStatus & { ok: true }>('POST', '/api/engines/codex/repair-env', { keys }),
  restoreCodexEnv: () => req<CodexStatus & { ok: true }>('POST', '/api/engines/codex/restore-env'),
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
  retryNode: (nodeId: string) => req<TreeNode & { siblings: TreeNode[] }>('POST', `/api/nodes/${nodeId}/retry`),
  scenes: () => req<{ scenes: Scene[]; collections: string[]; verticals: string[] }>('GET', '/api/scenes'),
  presenters: () => req<{ presenters: Presenter[]; categories: string[]; styles: string[] }>('GET', '/api/presenters'),
  /** The reference frames a presenter has on disk, if any. */
  presenterFrames: (id: string) =>
    req<{ frames: { url: string; angle: string }[] }>('GET', `/api/presenter-previews/${id}`),
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
  /** `dir` and `dbPath` are answered only to the computer running Scenri, never to a phone. */
  home: () => req<{ dir?: string; dbPath?: string; images: number; bytes: number }>('GET', '/api/home'),
  reveal: () => req<{ ok: true }>('POST', '/api/system/reveal'),
  version: () => req<VersionInfo>('GET', '/api/version'),
  updateStatus: () => req<UpdateStatus>('GET', '/api/update/status'),
  updateCheck: () => req<UpdateStatus>('POST', '/api/update/check'),
  updateApply: () => req<{ ok: true; staging: string }>('POST', '/api/update/apply'),
  updateRestart: () => req<{ ok: true }>('POST', '/api/update/restart'),
  desktop: () => req<DesktopStatus>('GET', '/api/desktop'),
  phone: (fresh = false) => req<PhoneStatus>('GET', fresh ? '/api/phone?fresh=1' : '/api/phone'),
  phoneNewCode: () => req<PhoneStatus>('POST', '/api/phone/code'),
  phoneHelp: () => req<{ firewall: FirewallVerdict }>('GET', '/api/phone/help'),
  phoneAllow: () => req<{ result: AllowResult; firewall: FirewallVerdict }>('POST', '/api/phone/allow'),
  desktopInstall: () => req<{ ok: true; path: string }>('POST', '/api/desktop/install'),
  /** Drain and stop the server; the overlay says how to come back. */
  quit: () => req<{ ok: true }>('POST', '/api/system/quit'),
  releaseNotes: () => req<ReleaseNotesResponse>('GET', '/api/release/notes'),
  releaseSeen: (version: string) => req<{ ok: true }>('POST', '/api/release/seen', { version }),
  /** The reference frames a scene has on disk, if any. */
  sceneFrames: (id: string) =>
    req<{ frames: string[]; views: { view: SceneView; url: string }[] }>('GET', `/api/scene-previews/${id}`),
  /** One of a catalog scene's views, copied into the image store so a shot can be handed it (Use this view). */
  pickSceneView: (sceneId: string, view: SceneView) =>
    req<{ hash: string }>('POST', `/api/scenes/${sceneId}/views/${view}/pick`),
  deleteData: (scope: 'shots' | 'all') => req<{ ok: true; scope: string }>('DELETE', `/api/data?scope=${scope}`),
  /** One product with all of its pictures; the library list carries only the first. */
  libraryProduct: (brandId: string, productId: string) =>
    req<{ product: Product }>('GET', `/api/brands/${brandId}/products-library/${encodeURIComponent(productId)}`),
  productsLibrary: (brandId: string) =>
    req<{ products: Product[]; source: CatalogSource | null }>('GET', `/api/brands/${brandId}/products-library`),
  catalogImport: (brandId: string, url: string, urls?: string[]) =>
    req<{ jobId: string }>('POST', `/api/brands/${brandId}/catalog/import`, urls ? { url, urls } : { url }),
  catalogScan: (brandId: string, url?: string) =>
    req<{ scanId: string }>('POST', `/api/brands/${brandId}/catalog/scan`, url ? { url } : {}),
  catalogDetails: (brandId: string, urls: string[]) =>
    req<{ products: CatalogCandidate[] }>('POST', `/api/brands/${brandId}/catalog/details`, { urls }),
  catalogScanState: (brandId: string, scanId: string, signal?: AbortSignal) =>
    req<CommerceScanState>('GET', `/api/brands/${brandId}/catalog/scans/${scanId}`, undefined, signal),
  cancelCatalogScan: (brandId: string, scanId: string) =>
    req<{ ok: boolean }>('POST', `/api/brands/${brandId}/catalog/scans/${scanId}/cancel`),
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
   * How large the product really is. Read from its photograph the first time
   * anyone asks, so the answer can take a few seconds once; null when nothing
   * can read it and nobody has said.
   */
  productSize: (brandId: string, productId: string) =>
    req<{ size: ProductSize | null }>('GET', `/api/brands/${brandId}/products/${productId}/size`),
  /** The person's own size, in words with a unit; an empty string takes it back. */
  setProductSize: (brandId: string, productId: string, size: string) =>
    req<{ size: ProductSize | null }>('PUT', `/api/brands/${brandId}/products/${productId}/size`, { size }),
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
      /** Only scenes build here; a presenter is cast in the create dialog (createPresenterDraft). */
      kind: 'scene';
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
  // ---- a presenter being cast: one person, one approved view at a time
  createPresenterDraft: (
    brandId: string,
    p: {
      source: 'synthetic' | 'photos';
      direction?: string;
      /** What should stay the same about them, one thing at a time. */
      keepItems?: { id: string; words: string; refs?: string[] }[];
      imageHashes?: string[];
      attestation?: boolean;
      name?: string;
      facets?: string[];
      extras?: boolean;
    },
  ) => req<PresenterDraft>('POST', `/api/brands/${brandId}/presenter-drafts`, p),
  presenterDrafts: (brandId: string) =>
    req<{ drafts: PresenterDraftSummary[] }>('GET', `/api/brands/${brandId}/presenter-drafts`),
  presenterDraft: (brandId: string, draftId: string) =>
    req<PresenterDraft>('GET', `/api/brands/${brandId}/presenter-drafts/${draftId}`),
  updatePresenterDraft: (
    brandId: string,
    draftId: string,
    p: {
      name?: string;
      facets?: string[];
      direction?: string;
      keepItems?: { id: string; words: string; refs?: string[] }[];
      /** The conversation's own answers, kept so another tab can pick it up. */
      setup?: string;
      extras?: boolean;
    },
  ) => req<PresenterDraft>('PATCH', `/api/brands/${brandId}/presenter-drafts/${draftId}`, p),
  /** With `decide: 'auto'` the view lands approved; the face never does. */
  generateDraftView: (
    brandId: string,
    draftId: string,
    view: PresenterDraftView,
    p: { adjustment?: string; decide?: 'auto' } = {},
  ) =>
    req<{ draft: PresenterDraft }>(
      'POST',
      `/api/brands/${brandId}/presenter-drafts/${draftId}/views/${view}/generate`,
      p,
    ),
  approveDraftView: (brandId: string, draftId: string, view: PresenterDraftView) =>
    req<PresenterDraft>('POST', `/api/brands/${brandId}/presenter-drafts/${draftId}/views/${view}/approve`),
  redoDraftView: (brandId: string, draftId: string, view: PresenterDraftView) =>
    req<PresenterDraft>('POST', `/api/brands/${brandId}/presenter-drafts/${draftId}/views/${view}/redo`),
  /** Keep the previous approved picture; the revision goes. */
  revertDraftView: (brandId: string, draftId: string, view: PresenterDraftView) =>
    req<PresenterDraft>('POST', `/api/brands/${brandId}/presenter-drafts/${draftId}/views/${view}/revert`),
  stopDraft: (brandId: string, draftId: string) =>
    req<PresenterDraft>('POST', `/api/brands/${brandId}/presenter-drafts/${draftId}/stop`),
  restoreDraftView: (brandId: string, draftId: string, view: PresenterDraftView, hash: string) =>
    req<PresenterDraft>('POST', `/api/brands/${brandId}/presenter-drafts/${draftId}/views/${view}/restore`, { hash }),
  placeDraftPhoto: (brandId: string, draftId: string, view: PresenterDraftView, hash: string) =>
    req<PresenterDraft>('POST', `/api/brands/${brandId}/presenter-drafts/${draftId}/views/${view}/use-photo`, { hash }),
  savePresenterDraft: (brandId: string, draftId: string) =>
    req<{ presenter: { id: string; name: string }; brand: Brand }>(
      'POST',
      `/api/brands/${brandId}/presenter-drafts/${draftId}/save`,
    ),
  deletePresenterDraft: (brandId: string, draftId: string) =>
    req<{ ok: true }>('DELETE', `/api/brands/${brandId}/presenter-drafts/${draftId}`),
  /** Write a presenter with no build behind it: the photos become the references. */
  createPresenter: (brandId: string, p: { name: string; shotHashes: string[]; sourceHashes?: string[] }) =>
    req<{ presenter: unknown; brand: Brand }>('POST', `/api/brands/${brandId}/presenters`, p),
  updatePresenter: (brandId: string, presenterId: string, patch: PresenterPatch) =>
    req<{ presenter: unknown; brand: Brand }>('PATCH', `/api/brands/${brandId}/presenters/${presenterId}`, patch),
  /** The brand comes back so every surface stops showing them in one commit. */
  deletePresenter: (brandId: string, presenterId: string) =>
    req<{ ok: true; brand: Brand }>('DELETE', `/api/brands/${brandId}/presenters/${presenterId}`),
  /** A new saved person from the current accepted record. Same pictures, a new id. */
  duplicatePresenter: (brandId: string, presenterId: string, name: string) =>
    req<{ presenter: { id: string; name: string }; brand: Brand }>(
      'POST',
      `/api/brands/${brandId}/presenters/${presenterId}/duplicate`,
      { name },
    ),
  /**
   * Edit a saved person: the session already open on them, else one seeded
   * from the record. Any id in their history opens the head. The save on the
   * returned draft answers the head: a new record when a picture or the
   * identity prose changed, the same record patched in place otherwise.
   */
  editPresenter: (brandId: string, presenterId: string) =>
    req<PresenterDraft>('POST', `/api/brands/${brandId}/presenters/${presenterId}/edit`),
  /** Revert last change: the record this one replaced becomes the head again. 400 when nothing is older. */
  revertPresenter: (brandId: string, presenterId: string) =>
    req<{ presenter: { id: string; name: string }; brand: Brand }>(
      'POST',
      `/api/brands/${brandId}/presenters/${presenterId}/revert`,
    ),
  /**
   * `conversation` is the studio conversation saving it: the server answers a
   * second create from the same conversation with the scene it already made.
   */
  createScene: (brandId: string, p: ScenePatch & { conversation?: string }) =>
    req<{ scene: unknown; warnings: string[]; brand: Brand }>('POST', `/api/brands/${brandId}/scenes`, p),
  updateScene: (brandId: string, sceneId: string, patch: ScenePatch) =>
    req<{ scene: unknown; warnings: string[]; brand: Brand }>(
      'PATCH',
      `/api/brands/${brandId}/scenes/${sceneId}`,
      patch,
    ),
  /** The brand comes back so every surface stops showing the scene in one commit. */
  deleteScene: (brandId: string, sceneId: string) =>
    req<{ ok: true; brand: Brand }>('DELETE', `/api/brands/${brandId}/scenes/${sceneId}`),
  /**
   * What a scene's examples are drawing, and what each offer would draw: the
   * first press (`first`) and Add more (`more`). Both are counted before
   * anything is spent, so a button can say what it costs.
   */
  sceneExamples: (brandId: string, sceneId: string) =>
    req<{ job: SceneExampleJob | null; first: SceneExampleRole[]; more: SceneExampleRole[] }>(
      'GET',
      `/api/brands/${brandId}/scenes/${sceneId}/examples`,
    ),
  /** Draw the place in use, the rest of the set, or these roles again. Joins a run already drawing. */
  drawSceneExamples: (
    brandId: string,
    sceneId: string,
    ask: { first: true } | { more: true } | { roles: SceneExampleRole[] },
  ) => req<{ job: SceneExampleJob }>('POST', `/api/brands/${brandId}/scenes/${sceneId}/examples`, ask),
  /** Stop drawing; what already landed stays. */
  stopSceneExamples: (brandId: string, sceneId: string) =>
    req<{ ok: boolean }>('POST', `/api/brands/${brandId}/scenes/${sceneId}/examples/stop`),
  removeSceneExample: (brandId: string, sceneId: string, role: SceneExampleRole) =>
    req<{ ok: boolean; brand: Brand }>('DELETE', `/api/brands/${brandId}/scenes/${sceneId}/examples/${role}`),
  /** Redraw a scene's example. One generation, always asked for out loud. */
  generateScenePreview: (brandId: string, sceneId: string) =>
    req<{ preview: string; brand: Brand }>('POST', `/api/brands/${brandId}/scenes/${sceneId}/preview`),
  /** Read a scene's own references again, in place. One analysis, asked for out loud. */
  rereadScene: (brandId: string, sceneId: string, correction?: string) =>
    req<{ jobId: string }>('POST', `/api/brands/${brandId}/scenes/${sceneId}/reread`, { correction }),

  // ---- the scene studio: work that answers words and a picture, and writes nothing
  startSceneStudioJob: (
    brandId: string,
    p: {
      kind: SceneStudioJobKind;
      instruction?: string;
      imageHashes?: string[];
      reading?: SceneReading;
      from?: string;
      /** The picture being changed is an anchor. */
      fromAnchor?: boolean;
      /** Its hero, changed by the same sentence, and who stands in it. */
      fromHero?: string;
      heroWith?: HeroWith;
      ask?: string;
      draw?: boolean;
      reread?: boolean;
      /** The picture is one of the brand's own shots: only the place in it is read. */
      shot?: boolean;
      /** The studio conversation asking; one job runs per conversation. */
      conversation?: string;
      sceneId?: string;
      /** What Activity calls the work. */
      label?: string;
    },
  ) =>
    req<{ jobId: string; job: SceneStudioJob; existing?: true }>('POST', `/api/brands/${brandId}/scene-studio/jobs`, p),
  sceneStudioJob: (brandId: string, jobId: string) =>
    req<SceneStudioJob>('GET', `/api/brands/${brandId}/scene-studio/jobs/${jobId}`),
  cancelSceneStudioJob: (brandId: string, jobId: string) =>
    req<{ ok: boolean }>('POST', `/api/brands/${brandId}/scene-studio/jobs/${jobId}/cancel`),
  /** The scene was named while this job ran: Activity says the name. */
  labelSceneStudioJob: (brandId: string, jobId: string, label: string) =>
    req<{ ok: boolean }>('POST', `/api/brands/${brandId}/scene-studio/jobs/${jobId}/label`, { label }),
  /** A scene was saved while this job drew its picture: put the picture on it when it lands. */
  attachSceneStudioJob: (brandId: string, jobId: string, sceneId: string) =>
    req<{ state: 'landed' | 'pending' | 'none'; brand: Brand }>(
      'POST',
      `/api/brands/${brandId}/scene-studio/jobs/${jobId}/attach`,
      { sceneId },
    ),
};

/**
 * Whether this machine can read references and draw from them.
 *
 * Both are accelerators, not gates: without them a person is still made from
 * the photos as they arrive, and a place from a sentence. The creation flow
 * reads this so it can say which of those is about to happen.
 */

export type { CommerceScan, CatalogCandidate } from './apiTypes.js';
