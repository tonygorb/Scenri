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
  createdAt: string;
}
export interface TreeNode {
  id: string;
  projectId: string;
  parentId: string | null;
  kind: 'root' | 'generation' | 'edit';
  prompt: string;
  engineId: string;
  status: 'running' | 'done' | 'error';
  images: string[];
  costUsd: number;
  kept: boolean;
  error: string | null;
  createdAt: string;
  overlays: Record<string, TextLayer[]>;
  brief: { tokens: any[]; templateId?: string; templateFields?: Record<string, string> } | null;
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
  looks: () => req<{ looks: Look[]; collections: string[]; verticals: string[] }>('GET', '/api/looks'),
  exportPresets: () => req<ExportPreset[]>('GET', '/api/export/presets'),
  previewBrief: (brief: unknown, engineId: string, brandId: string) =>
    req<BriefPreview>('POST', '/api/brief/preview', { brief, engineId, brandId }),
  saveOverlays: (nodeId: string, overlays: Record<string, TextLayer[]>) =>
    req<TreeNode>('PUT', `/api/nodes/${nodeId}/overlays`, { overlays }),
  keep: (nodeId: string, kept: boolean) => req<TreeNode>('POST', `/api/nodes/${nodeId}/keep`, { kept }),
  diff: (imageA: string, imageB: string) =>
    req<{ score: number; heatmapHash: string }>('POST', '/api/diff', { imageA, imageB }),
  settings: () => req<Record<string, boolean>>('GET', '/api/settings'),
  saveSettings: (s: Record<string, string>) => req<{ ok: true }>('PUT', '/api/settings', s),
  costs: () => req<{ byEngine: Record<string, number>; caps: Record<string, number> }>('GET', '/api/costs/summary'),
  /** Where the library lives on this machine, and how big it has grown. */
  home: () => req<{ dir: string; dbPath: string; images: number; bytes: number }>('GET', '/api/home'),
  reveal: () => req<{ ok: true }>('POST', '/api/system/reveal'),
  /** The reference frames a look has on disk, if any. */
  lookFrames: (id: string) => req<{ frames: string[] }>('GET', `/api/look-previews/${id}`),
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
};

export interface LookField {
  key: string;
  label: string;
  placeholder?: string;
}
/**
 * A look is the photographic setup: light, ground, mood. It never names a
 * product — that arrives as its own ingredient and brings its own photo.
 */
export interface Look {
  id: string;
  name: string;
  description: string;
  /** Short phrase naming the light. Looks relate to each other by this. */
  lighting: string;
  subject: 'product' | 'person' | 'either';
  collections: string[];
  verticals: string[];
  /** Vibrant colour pulled from the preview, for tinting the chip. */
  previewUrl?: string | null;
  previewColor?: string | null;
  fields?: LookField[];
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
/** Products and cast are the same shape: a named thing with locked photos. */
export interface Product {
  id: string;
  name: string;
  shots?: { file: string; locked?: boolean; alt?: string | null }[];
  origin?: 'manual' | 'catalog';
  url?: string | null;
  price?: number | null;
  compareAtPrice?: number | null;
  currency?: string | null;
  vendor?: string | null;
  status?: string;
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

/** Products and cast upload through one path; only the collection differs. */
export async function uploadAsset(
  brandId: string,
  kind: 'products' | 'characters',
  file: File,
  name: string,
): Promise<Brand> {
  const fd = new FormData();
  fd.append('name', name);
  fd.append('file', file);
  const res = await fetch(`/api/brands/${brandId}/${kind}`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as any).error ?? `HTTP ${res.status}`);
  return res.json();
}
export const uploadProduct = (brandId: string, file: File, name: string) =>
  uploadAsset(brandId, 'products', file, name);
export const uploadCharacter = (brandId: string, file: File, name: string) =>
  uploadAsset(brandId, 'characters', file, name);
export const deleteAsset = (brandId: string, kind: 'products' | 'characters', assetId: string) =>
  req<Brand>('DELETE', `/api/brands/${brandId}/${kind}/${assetId}`);
export const deleteProduct = (brandId: string, productId: string) => deleteAsset(brandId, 'products', productId);

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
  attachments: { role: 'product' | 'reference'; label: string; hash: string }[];
  warnings: string[];
  productId: string | null;
  referenceCount: number;
}
