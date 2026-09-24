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
export interface FeedNode {
  id: string;
  projectId: string;
  parentId: string | null;
  kind: 'root' | 'generation' | 'edit';
  engineId: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  images: string[];
  costUsd: number;
  /** Wall time of the run in milliseconds; null for legacy and unfinished shots. */
  durationMs: number | null;
  kept: boolean;
  error: string | null;
  createdAt: string;
  /** When this run began. Same as createdAt on a first send; a same-card retry restamps it. Older payloads omit it. */
  startedAt?: string;
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
  /**
   * The head of the compiled prompt (240 code points): enough for a title
   * (the leading [Scene] tag or the first six words) and alt text. The whole
   * prompt averages 3 KB and was 80% of every feed payload, read by nothing a
   * list shows; GET /api/nodes/:id carries it.
   */
  promptHead: string;
  /** How many live (non-archived) refinements hang off this shot: the versions pip. */
  childCount: number;
}

/** The whole record, as GET /api/nodes/:id answers it. Structurally a FeedNode, so it can sit in any list. */
export interface TreeNode extends FeedNode {
  prompt: string;
  /**
   * Captions once laid over a shot. Scenri makes the picture; composing type
   * onto it was a different product. Nothing writes this any more, and the
   * field stays only because shots already carry it.
   */
  overlays: Record<string, TextLayer[]>;
}

/** A node carrying the sets it has been put in, for lists that span the brand. */
export interface ActivityNode extends FeedNode {
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

/**
 * The brand's frame in one answer: its one project and root, its sets, who is
 * in what, and the newest shots for the rail and the attach panel. The shots
 * themselves are a paged query (FeedPage), never carried here: a workspace
 * with twenty thousand of them costs the same to open as one with twenty.
 */
export interface Workspace {
  project: Project;
  /** The project's root node id: every shot hangs off it. */
  root: string;
  sets: ShotSet[];
  membership: Record<string, string[]>;
  /** The newest done shots, newest first, for surfaces that show a handful. */
  recent: FeedNode[];
}

/** Which shots a feed page is about. Every field is optional; absent means all. */
export interface FeedQuery {
  lens?: 'all' | 'keepers' | 'archived';
  /** Only shots in this set. */
  set?: string;
  /** Only shots in no set. */
  ungrouped?: boolean;
  /** This shot and everything descended from it. */
  lineage?: string;
  /** Only shots whose brief carries this product, presenter or scene id. */
  token?: string;
  q?: string;
  sort?: 'newest' | 'oldest' | 'cost' | 'keepers';
  limit?: number;
  cursor?: string;
}

/** What each lens would show from the same place and search. */
export interface FeedCounts {
  /** Every shot the brand has ever made, whatever the place, lens or search: zero means a first run. */
  total: number;
  all: number;
  keepers: number;
  archived: number;
  /** Live shots in no set at all, unscoped: the ungrouped place's own count. */
  ungrouped: number;
}

export interface FeedPage {
  items: FeedNode[];
  /** Opaque keyset cursor for the next page; null at the end. */
  next: string | null;
  /** The lens counts of the place: on a first page only, never on a continuation. */
  counts?: FeedCounts;
}

/** Where a shot sits in its tree, as the overlay and the keyboard walk need it. */
export interface Lineage {
  /** Root-most first, the parent last; never the root itself. */
  ancestors: FeedNode[];
  /** Every shot sharing the parent, the shot itself included, in feed order. */
  siblings: FeedNode[];
  /** Live refinements of the shot, in feed order. */
  children: FeedNode[];
  /**
   * The root of the shot's tree first, then every live descendant of it in
   * creation order, the shot itself always included. Absent from a server
   * older than the strip that reads it, which then composes the old way.
   */
  history?: FeedNode[];
}

/** One day of runs, for the usage heat map. */
export interface UsageDay {
  day: string;
  generations: number;
  edits: number;
}

/** What the brand switcher and the route resolver need, never the document. */
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
/**
 * Which setup step would make an engine ready, when the engine knows.
 * `env-conflict` is the odd one: the engine is installed and signed in, and a
 * credential in this computer's environment is outranking that sign-in.
 */
export type UnavailableCode = 'not-installed' | 'not-authenticated' | 'update-needed' | 'unverified' | 'env-conflict';

export type CodexSetupState =
  | 'not-installed'
  | 'not-authenticated'
  | 'update-needed'
  | 'unverified'
  | 'env-conflict'
  | 'ready';

export interface CodexStatus {
  state: CodexSetupState;
  reason?: string;
  platform?: SetupPlatform;
  /** Variables overriding the sign-in. Empty unless the state is env-conflict. */
  conflictKeys?: string[];
  /** Variables Scenri is already keeping out of codex's environment. */
  ignoredKeys?: string[];
}

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

/** What a website gave up, as facts rather than prose. Mirrors @scenri/brand. */
export interface ScrapeReport {
  url: string;
  host: string;
  /** False when the site answered and refused us, so the kit is the address alone. */
  read: boolean;
  name: { value: string; source: 'json-ld' | 'og:site_name' | 'title' | 'hostname' };
  tagline: string | null;
  logo: { status: 'primary' | 'alternate' | 'none'; source: string | null; note?: string };
  colors: { count: number };
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
  /** Whether this tab is on the computer running Scenri, not a phone on the Wi-Fi. */
  thisComputer?: boolean;
};

/** Why a phone might not open Scenri, as this computer's firewall answers. */
export type FirewallVerdict = 'blocked' | 'blocks-all' | 'ok' | 'unknown';

/** How a press of Allow Scenri ended: the OS prompt was approved, declined, or could not run. */
export type AllowResult = 'done' | 'cancelled' | 'failed' | 'unsupported';

/** Settings' "Open on your phone" row (GET /api/phone). */
export type PhoneStatus = {
  /** `this-computer`: started with SCENRI_HOST=127.0.0.1, so no phone can open it. */
  reach: 'network' | 'this-computer';
  /** Whether this tab is on the computer running Scenri. */
  thisComputer: boolean;
  platform: string;
  /** `http://192.168.1.42:4747`, the address to type. */
  address: string | null;
  /** The address with the code in it: the QR code and the copied link. */
  url: string | null;
  code: string;
  others: string[];
  problem: 'no-network' | 'blocked' | null;
  lastVisit: { at: number; device: string } | null;
};

/** The desktop launcher's state on this machine, from GET /api/desktop. */
export type DesktopStatus = {
  supported: boolean;
  platform: string;
  installed: boolean;
  path: string | null;
  /** The first-run question was answered Not now; About offers the icon regardless. */
  declined: boolean;
  installKind: VersionInfo['installKind'];
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

/**
 * The views a presenter is cast in, in save order: three core views built by
 * default (face, full body, three-quarter) and three built on request (back,
 * left, right).
 */
export type PresenterDraftView = 'portrait' | 'front' | 'three-quarter' | 'back' | 'left' | 'right';
export type PresenterDraftSlotStatus = 'empty' | 'generating' | 'candidate' | 'approved' | 'stale';
export interface PresenterDraftSlot {
  status: PresenterDraftSlotStatus;
  hash?: string;
  /** The approved picture a revised candidate would replace, until Use or Keep previous. */
  prior?: string;
  origin?: 'generated' | 'photo';
  attempts: number;
  rejected: string[];
  adjustment?: string;
  conditionedOn?: string[];
  error?: string;
  /** When the step now running began: the clock measures the step, not the row. */
  startedAt?: string;
}
/** A presenter being cast: the server's row, whole, on every answer. */
/**
 * An unfinished person, as a card needs them.
 *
 * Not the whole row: that carries every ask, result and decision of the
 * conversation, and a library page drawing ten cards has no use for any of it.
 */
export interface PresenterDraftSummary {
  id: string;
  name: string;
  source: 'synthetic' | 'photos';
  updatedAt: string;
  /** When it was started. The wall is ordered by this, so choosing one never moves it. */
  createdAt: string;
  stage: 'idle' | 'analyzing' | 'drawing';
  /** Set when this is an edit of somebody already saved, which is not unfinished work. */
  presenterId?: string;
  /** The best picture it has: the face, else a photograph it was given. */
  hash?: string;
  approved: number;
  of: number;
  drawing: boolean;
  /** Pictures drawn for it, decided or not: what a discard would throw away. */
  drawn: boolean;
}

export interface PresenterDraft {
  id: string;
  brandId: string;
  source: 'synthetic' | 'photos';
  direction?: string;
  /** What the person said should stay the same whenever this presenter appears. */
  keep?: string;
  /** The same, one thing at a time, which is the form the draft stores. */
  keepItems?: { id: string; words: string; refs?: string[] }[];
  /** The conversation's own answers, as the studio holds them. Opaque to the server. */
  setup?: string;
  /** Pictures of the details themselves, by detail. Derived from the items. */
  detailRefs?: Record<string, string[]>;
  name: string;
  facets: string[];
  attestation?: { attestedAt: string; version: string };
  sources: string[];
  analysis?: {
    promptName?: string;
    descriptor?: string;
    /** The analyzer's one line when the photographs seem to show more than one person. */
    conflict?: string;
    /** What the engine read this person as being cast for; the user's own picks override it. */
    suitableCategories?: string[];
    photos?: { index: number; view: string; usable: boolean; note: string }[];
  } | null;
  /** Why the photos could not be read; the face is drawn from them regardless. */
  readError?: string;
  views: Record<PresenterDraftView, PresenterDraftSlot>;
  /** Whether the extra views may be drawn. Off until asked for. */
  extras: boolean;
  generations: number;
  activeView: PresenterDraftView | null;
  stage: 'idle' | 'analyzing' | 'drawing';
  /** The presenter an edit session works on, the head when it was opened. Absent on a creation. */
  presenterId?: string;
  /** The head's id when the session opened; the save answers 409 when it has moved since. */
  baseId?: string;
  /** Identity-wide instructions accepted in this session, newest last. */
  identityEdits: string[];
  /** Every sentence sent to redraw a view, oldest first. The conversation is read off these. */
  asks: { view: PresenterDraftView; text: string; at: string }[];
  /** Every picture that landed on a view, oldest first: the record's restore points while the draft lives. */
  results: { view: PresenterDraftView; hash: string; at: string; ask?: string; how: 'drawn' | 'restored' }[];
  /** Every decision taken on a view, oldest first. */
  decisions: { view: PresenterDraftView; what: 'use' | 'again' | 'keep'; at: string }[];
  /** Shots the record holds under an angle the studio has no slot for. Written back untouched on save. */
  keptShots?: { file: string; angle?: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface PresenterPatch {
  name?: string;
  descriptor?: string;
  /** Where they are filed in the library: the verticals they suit. */
  suitableCategories?: string[];
  ageRange?: string;
  hair?: string;
  identityNotes?: string;
  negativeConstraints?: string[];
  /** Ordered. The first two are the views a brief attaches. */
  shotHashes?: string[];
  sourceHashes?: string[];
}

/** One way to shoot a scene: the camera moves, the world does not. */
export interface SceneSetup {
  id: string;
  label: string;
  camera: string;
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
  /** The scene's picture: its card, and what a shot is given as the world's picture when it is an anchor. */
  previewHash?: string;
  /** Said with `previewHash`: that picture is an anchor (drawn beside the references, then made nobody's). */
  anchor?: boolean;
  /** The hero the studio drew with that picture: saved as its `hero` example, and its cover unless one was chosen. */
  heroHash?: string;
  heroWith?: HeroWith;
  /** Which picture stands for the scene on its card. Presentation only. */
  cover?: SceneView;
  promptName?: string;
  /** Ways to shoot this same world, four at most. */
  setups?: SceneSetup[];
}

/**
 * What the scene studio read a place into: the words a saved scene is, and
 * the only thing about a scene a shot is ever told (the plate aside).
 */
export interface SceneReading {
  name: string;
  promptName?: string;
  /** The place itself. */
  prompt: string;
  lighting: string;
  camera?: string;
  /** The position a person takes in this world. A role, never a person. */
  figure?: string;
  figureTreatment?: string;
  subject: 'product' | 'person' | 'either';
  description: string;
  keywords?: string[];
  collections?: string[];
  verticals?: string[];
  /** What the pictures it was read from show. Carried back to the server on Try again; never saved. */
  holds?: ('person' | 'product' | 'lettering')[];
  /** What the hero shows, read with the words. Carried back on Try again; never saved. */
  hero?: 'product' | 'presenter' | 'both' | 'place';
}

/** Who stands in a scene's hero: a Scenri demo product, a demo presenter, or both. */
export interface HeroWith {
  product?: string;
  presenter?: string;
}

/**
 * One picture of a scene by what it shows: the place, or the place in use.
 * A made scene's examples and a catalog scene's frames share these names, and
 * a cover is one of them, never a position.
 */
export type SceneView = 'place' | SceneExampleRole;

export type SceneStudioJobKind = 'make' | 'again' | 'change';

/** One piece of studio work: read, draw, or change. Never writes the brand. */
export interface SceneStudioJob {
  id: string;
  brandId: string;
  kind: SceneStudioJobKind;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  phase: 'reading' | 'changing' | 'drawing' | null;
  startedAt: string;
  phaseAt: string;
  finishedAt: string | null;
  reading: SceneReading | null;
  coverage: string[];
  hash: string | null;
  /** The picture is an anchor, which is what a saved scene may send with a shot. */
  anchor?: boolean;
  /** The hero: the place in use, drawn from that picture, and the first one shown. */
  hero?: string | null;
  heroWith?: HeroWith | null;
  error: string | null;
  warnings: string[];
  attachTo: string | null;
  /** The picture the scene wore when the attach was asked for; the landed one goes on only over that. */
  attachFrom?: string | null;
  /** The studio conversation this work belongs to. */
  conversation?: string | null;
  /** The saved scene the conversation edits, if any. */
  sceneId?: string | null;
  /** What Activity calls it. */
  label?: string;
}

/**
 * A studio's work as Activity shows it: a scene studio job, a presenter
 * draft's run (a set that goes on view after view is one run), or a scene's
 * examples being drawn.
 */
export interface StudioWork {
  /** `scene:<job>`, `examples:<job>` or `presenter:<draft>:<run>`. */
  id: string;
  kind: 'scene' | 'presenter' | 'examples';
  status: 'running' | 'done' | 'failed' | 'cancelled';
  /** `reading`, `changing`, `drawing`, or a presenter view. */
  step: string | null;
  job?: SceneStudioJobKind;
  name: string;
  thumb: string | null;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  conversation?: string | null;
  sceneId?: string | null;
  attachTo?: string | null;
  draftId?: string;
  presenterId?: string | null;
  done?: number;
  total?: number;
  awaiting?: boolean;
}

/** What one of a scene's examples shows: the place in use, with a Scenri demo product or presenter. */
export type SceneExampleRole = 'hero' | 'close' | 'hands' | 'angle' | 'bold';

/** A scene's examples being drawn, or the last run that drew them. */
export interface SceneExampleJob {
  id: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  /** Asked for, in order; the queue grows when more are asked for while it runs. */
  roles: SceneExampleRole[];
  done: SceneExampleRole[];
  failed: { role: SceneExampleRole; error: string }[];
  current: SceneExampleRole | null;
  /** The place picture they are drawn from, as `asset:<hash>`. */
  from: string;
  subject: { kind: 'product' | 'presenter'; id: string };
  error: string | null;
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
  /**
   * The scene's cover: the picture its card, the pickers and its chips show.
   * Presentation only; never what a shot is given.
   */
  previewUrl?: string | null;
  /** Vibrant colour pulled from the preview, for tinting the chip. */
  previewColor?: string | null;
  /** Display names this scene used to carry. Searchable; never rendered. */
  legacyNames?: string[];
  /** Search vocabulary. Never rendered — this is what pays for a short `name`. */
  keywords?: string[];
  fields?: SceneField[];
  prompt: string;
  width: number;
  height: number;
  /** Which view the cover shows; absent means the place. */
  cover?: SceneView;
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

/**
 * How large a product really is. Read from its photograph when nobody said
 * (`estimate`), taken from what the store listed (`record`), or the person's
 * own correction on its page (`person`), which wins over both.
 */
export interface ProductSize {
  text: string;
  largestCm: number;
  by: 'estimate' | 'record' | 'person';
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
  /** Read fine, no shop on it. A fact about the site, not a fault. */
  | 'no_catalog'
  /** Stopped by the person who started it. Not a fault, and not red. */
  | 'cancelled'
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
   * How many photo groups the engine carries for this request, the source
   * frame already subtracted on a refine. 0 means the engine reads no images
   * at all, in which case chips ride as words and nothing is refused.
   */
  cap?: number;
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
    /** Why it did not ride: lost the budget, or never had a usable photo. */
    reason?: 'budget' | 'missing';
  }[];
}

/**
 * What a bounded look at a website concluded about commerce.
 *
 * Four words rather than a boolean, because "no shop here" and "a shop we
 * could not read" need different sentences on screen. Reporting the second as
 * the first is how a working store came to ring a red bell on a first run.
 */
export type CommerceVerdict = 'none' | 'found' | 'likely' | 'blocked';

export interface CommerceScan {
  verdict: CommerceVerdict;
  /** How many products the site appears to have, which is not how many were read. */
  count: number;
  countSource: 'api' | 'sitemap' | 'listing' | 'preview' | 'none';
  /** A preview, read and parsed. Nothing here is saved until someone says so. */
  candidates: CatalogCandidate[];
  /**
   * Every product the store's own listing already described.
   *
   * Present whenever the store has a bulk API, covering the whole catalogue
   * rather than a preview of it, so the chooser draws without asking for
   * anything. Empty for a store readable only one page at a time.
   */
  cards?: CatalogCard[];
  candidateUrls: string[];
  truncated: boolean;
  warnings: string[];
}

/** A product as the chooser needs it: a name, an address and one picture. */
export interface CatalogCard {
  externalKey: string;
  title: string;
  url: string;
  handle?: string | null;
  image?: string | null;
}

/** A product that has been read but not saved. */
export interface CatalogCandidate {
  externalKey: string;
  title: string;
  url?: string | null;
  price?: number | null;
  currency?: string | null;
  category?: string | null;
  images?: { url: string }[];
  variants?: unknown[];
}

export interface CommerceScanState {
  id: string;
  brandId: string;
  url: string;
  status: 'running' | 'done' | 'error';
  result?: CommerceScan;
  error?: string;
}

/** First use (packages/cli/src/routes/guide.ts): the install's record and what the active task has made. */
export type GuideTaskId = 'first-shot' | 'refine' | 'product' | 'presenter' | 'scene' | 'reuse';
export type GuideMilestone = 'shot' | 'refine' | 'product' | 'presenter' | 'scene';

export interface GuideCounts {
  products: number;
  presenters: number;
  scenes: number;
}

export interface GuideActiveTask {
  task: GuideTaskId;
  brandId: string;
  since: string;
  baseline: GuideCounts;
  /** Its guide was closed part way: still in hand, shown nothing, continued as it was. */
  paused?: boolean;
}

export interface GuideTaskNode {
  id: string;
  kind: string;
  status: string;
  images: number;
  createdAt: string;
}

export interface GuideView {
  eligible: boolean;
  welcome: 'taken' | 'declined' | null;
  hidden: boolean;
  done: Partial<Record<GuideMilestone, string>>;
  /** Which lessons have been walked to the end, and when. */
  lessons: Partial<Record<GuideTaskId, string>>;
  /** Every lesson begun and not finished, each with its own milestones. */
  progress: Partial<Record<GuideTaskId, GuideLessonProgress>>;
  dismissed: GuideTaskId[];
  active: GuideActiveTask | null;
  activeNodes: GuideTaskNode[];
  activeDraftId: string | null;
  counts: GuideCounts | null;
}

/** One lesson's own progress: the brand its work is in, and what it has reached. */
export interface GuideLessonProgress {
  brandId: string;
  since: string;
  /** The moments it has shown, by their own ids. Never an index: steps resolve against what the product holds. */
  reached: string[];
  paused?: boolean;
}

export type GuideIntent =
  | { welcome: 'taken' | 'declined' }
  | { start: { task: GuideTaskId; brandId: string } }
  | { finish: GuideTaskId }
  | { reached: { task: GuideTaskId; moment: string } }
  | { dismiss: GuideTaskId }
  | { hidden: boolean };
