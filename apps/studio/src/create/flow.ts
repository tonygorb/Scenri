import type { ReactNode } from 'react';
import type { AssetBuildCapabilities } from '../api.js';
import type { PendingState } from '../createDraft.js';

/** What the host just made, for whoever asked for it. */
export type Created =
  | { kind: 'product'; id: string; name: string }
  | { kind: 'presenter' | 'scene'; jobId: string; name: string };

/**
 * Everything the host hands a flow. Deliberately small: a flow owns its own
 * fields, its own readiness rule and its own words, and borrows only the four
 * things it cannot know by itself.
 */
export interface FlowProps {
  /** Present only when a chooser is behind this. Renders the back arrow. */
  onBack?: () => void;
  /** The flow is done with itself; the host closes, toasts and refreshes. */
  onStarted: (made: Created) => void;
  /** What this machine can actually do, or null while it is still being asked. */
  caps: AssetBuildCapabilities | null;
  /** Wraps a flow's cost sentence, or replaces it when the probe never answered. */
  capsNote: (whenKnown: string) => ReactNode;
  /** How a build the draft was submitted as is doing, for the Try-again refill. */
  pendingState: (jobId: string) => PendingState;
}
