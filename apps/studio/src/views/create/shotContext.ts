import type { Brand, EngineInfo, ShotSet, TreeNode } from '../../api.js';
import type { TokenNames } from '../../feedRules.js';

/**
 * What the shot overlay needs from the canvas behind it. The overlay is a child
 * route, so this travels through the Outlet rather than through props.
 */
export interface ShotContext {
  nodes: TreeNode[];
  loaded: boolean;
  /** The sets a shot is filed in, by name rather than by count. */
  setsFor: (id: string) => ShotSet[];
  brand: Brand;
  engines: EngineInfo[];
  projectId: string;
  imageIndex: number;
  setImageIndex: (i: number) => void;
  close: () => void;
  select: (id: string) => void;
  retry: (node: TreeNode) => void;
  cancel: (node: TreeNode) => void;
  reload: () => Promise<void>;
  remix: (node: TreeNode) => void;
  branch: (node: TreeNode) => void;
  archive: (node: TreeNode) => void;
  unarchive: (node: TreeNode) => void;
  delete: (node: TreeNode) => void;
  /** A shot was made from inside the overlay: keep one refine thread. */
  refined: (nodeId: string, kind?: 'generation' | 'edit') => void;
  /** Ids to display names, so a shot can say which ingredient moved. */
  tokenNames: TokenNames;
}
