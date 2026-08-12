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
  overlays: Record<string, TextLayer[]>;
  brief: { tokens: any[]; templateId?: string; templateFields?: Record<string, string> } | null;
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
export interface EngineInfo {
  id: string;
  displayName: string;
  localOnly: boolean;
  supportsEdit: boolean;
  available: boolean;
  reason: string | null;
  monthlySpend: number;
  cap: number | null;
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
  }) => req<TreeNode>('POST', '/api/nodes', p),
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
  saveOverlays: (nodeId: string, overlays: Record<string, TextLayer[]>) =>
    req<TreeNode>('PUT', `/api/nodes/${nodeId}/overlays`, { overlays }),
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
};

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
  name: string;
  description: string;
  /** Short phrase naming the light. Scenes relate to each other by this. */
  lighting: string;
  subject: 'product' | 'person' | 'either';
  collections: string[];
  verticals: string[];
  /** Vibrant colour pulled from the preview, for tinting the chip. */
  previewUrl?: string | null;
  previewColor?: string | null;
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
  name: string;
  /** Lowercase key from productCategories.ts's PRODUCT_CATEGORIES. */
  category: string;
  description: string;
  width: number;
  height: number;
  previewUrl?: string | null;
  brand?: string;
  subcategory?: string;
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
 * A last-gasp overlay save for a page that is going away.
 *
 * `beforeunload` cannot await anything: the normal request is abandoned the
 * moment the document is torn down, which is how a headline typed in the last
 * fraction of a second before a reload was lost. `keepalive` hands the request
 * to the browser to finish on its own, and it is the only reason this is not
 * simply `api.saveOverlays`. Nothing can be reported back, so nothing tries.
 */
export function saveOverlaysOnUnload(nodeId: string, overlays: Record<string, TextLayer[]>): void {
  try {
    void fetch(`/api/nodes/${nodeId}/overlays`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ overlays }),
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

/** Human title for a node: template name, lift shorthand, or first words of the prompt. */
export function nodeLabel(n: TreeNode): string {
  const tag = /^\[([^\]]+)\]/.exec(n.prompt)?.[1];
  if (tag) return tag;
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
    role: 'product' | 'character' | 'reference';
    label: string;
    hash: string;
    essential?: boolean;
  }[];
  warnings: string[];
  productId: string | null;
  referenceCount: number;
}
