/** The shape of one report. Everything here is derived, except `comment`. */

export type ReportKind = 'ui' | 'generation';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TargetIdentity {
  /** Nearest recognised surface, e.g. "Shot tile". */
  area: string | null;
  /** Every recognised surface from the target outwards — the grep trail. */
  areaChain: string[];
  /** `data-fb` on the nearest tagged ancestor, e.g. "catalog-card". */
  fb: string | null;
  /** `data-fb-id` — a catalog entry's stable id. */
  fbId: string | null;
  /** `data-fb-node` — the shot this pixel belongs to. */
  nodeId: string | null;
  /** `data-fb-variant` — which image of that shot. */
  variant: number | null;
  /** Content hash from an `/api/images/<hash>` src, when the target is one. */
  imageHash: string | null;
  role: string | null;
  accessibleName: string | null;
  text: string | null;
  tag: string;
  rect: Rect;
}

export interface RouteContext {
  /** A pattern from routes.ts `P`, never a parsed pathname. */
  pattern: string | null;
  params: Record<string, string>;
  path: string;
  /** Whitelisted query only; `?t=` can never appear here. */
  search: Record<string, string>;
  /** Which dialog is open, from `?settings=<pane>`. */
  dialog: string | null;
}

/**
 * The split that decides whether the owner can act on an id alone.
 *
 * `curated` ids are filenames in templates/ and exist on every machine, so they
 * can be opened directly. `local` ids are UUIDs minted on the tester's machine
 * and mean nothing anywhere else — they are there so the owner can ask a
 * precise question, not so they can look something up.
 */
export interface ScenriIds {
  curated: {
    sceneIds: string[];
    presenterIds: string[];
    demoProductIds: string[];
    engineId: string | null;
    engineAvailable: boolean | null;
    engineReason: string | null;
    quality: string | null;
    format: string | null;
    count: number | null;
  };
  local: {
    brandId: string | null;
    brandSlug: string | null;
    projectId: string | null;
    nodeId: string | null;
    variant: number | null;
    imageHash: string | null;
    productIds: string[];
    customSceneIds: string[];
    customPresenterIds: string[];
    setSlug: string | null;
  };
  /** The compiled prompt. Generation reports only, and shown before sending. */
  prompt: string | null;
  /** Status and error of the shot being reported, when there is one. */
  nodeStatus: string | null;
  nodeError: string | null;
}

export interface Environment {
  build: string;
  browser: string;
  os: string;
  device: 'phone' | 'tablet' | 'desktop';
  viewport: { w: number; h: number };
  dpr: number;
  theme: string;
  online: boolean;
  language: string;
  at: string;
}

export interface ErrorEntry {
  at: string;
  kind: 'api' | 'window' | 'promise';
  message: string;
  status?: number;
  method?: string;
  url?: string;
}

export interface Report {
  v: 1;
  id: string;
  kind: ReportKind;
  comment: string;
  target: TargetIdentity;
  route: RouteContext;
  ids: ScenriIds;
  env: Environment;
  errors: ErrorEntry[];
}
