import type { Brand, EngineInfo, FeedNode, ShotSet } from '../../api.js';
import type { TokenNames } from '../../feedRules.js';

/**
 * What the shot overlay needs from the canvas behind it. The overlay is a child
 * route, so this travels through the Outlet rather than through props.
 */
export interface ShotContext {
  /** The shots the feed holds right now, by id: the pages scrolled to, never the whole brand. */
  byId: ReadonlyMap<string, FeedNode>;
  /** The project's root, which every new shot hangs off. */
  rootId: string | null;
  /** The newest done shots, for the overlay composer's attach panel. */
  recent: FeedNode[];
  loaded: boolean;
  /** The sets a shot is filed in, by name rather than by count. */
  setsFor: (id: string) => ShotSet[];
  brand: Brand;
  engines: EngineInfo[];
  projectId: string;
  close: () => void;
  select: (id: string) => void;
  retry: (node: FeedNode) => void;
  cancel: (node: FeedNode) => void;
  keep: (node: FeedNode) => void;
  /** Re-read the frame and the first page: the fallback when a change cannot be folded in. */
  reload: () => Promise<void>;
  remix: (node: FeedNode) => void;
  branch: (node: FeedNode) => void;
  /** Settles once the record has moved, or the refusal has been said, so a control can stop waiting. */
  archive: (node: FeedNode) => Promise<void>;
  unarchive: (node: FeedNode) => Promise<void>;
  delete: (node: FeedNode) => void;
  /** Shots that did not exist a moment ago were made from inside the overlay. */
  landed: (nodes: FeedNode[]) => void;
  /** A shot was made from inside the overlay: keep one refine thread. */
  refined: (nodeId: string, kind?: 'generation' | 'edit') => void;
  /** The bell's poll, for a shot the pages do not hold. */
  subscribeActivity: (fn: (nodes: FeedNode[]) => void) => () => void;
  /** Ids to display names, so a shot can say which ingredient moved. */
  tokenNames: TokenNames;
}
