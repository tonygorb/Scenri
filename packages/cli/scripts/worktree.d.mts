/**
 * Types for worktree.mjs, which stays plain JavaScript on purpose: builtins
 * only, no build step, runnable before `pnpm install` has finished. This file
 * exists so the TypeScript test beside it and the Playwright configs can import
 * the script under the CLI tsconfig.
 */

/** What a lane forces on `pnpm dev`, `pnpm dev:ui` and Playwright in a linked worktree. */
export interface LaneEnv {
  SCENRI_PORT: string;
  SCENRI_API: string;
  SCENRI_UI_PORT: string;
  SCENRI_HOME: string;
  SCENRI_E2E_PORT: string;
  SCENRI_NO_DESKTOP: '1';
  SCENRI_NO_OPEN: '1';
}

/** Where a checkout's git state lives; `linked` is false in the primary. */
export interface GitDirs {
  linked: boolean;
  gitDir: string;
  commonDir: string;
}

export const LANES: number;
export function laneEnvFor(lane: number, home: string): LaneEnv;
export function slugOf(branch: string): string;
export function assertSlug(slug: string): string;
export function gitDirs(root: string): GitDirs | null;
export function readLane(gitDir: string): number | null;
export function usedLanes(commonDir: string): Set<number>;
export function lowestFreeLane(used: Set<number>): number;
export function ensureLane(root: string): number | null;
/** The lane's variables, or an empty object in the primary and on any error. */
export function laneEnv(root?: string): Partial<LaneEnv>;
