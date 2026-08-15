import { clip, sanitiseUrl, scrubDeep } from './scrub.js';
import type { Environment, ErrorEntry, Report, ReportKind, ScenriIds, RouteContext, TargetIdentity } from './types.js';

/**
 * Assemble one report. Takes plain values rather than reading hooks, so it is
 * a `.ts` module with no React import and can be tested in jsdom — which is
 * also the only kind of file apps/studio/vitest.config.ts will pick up.
 *
 * Everything goes through `scrubDeep` on the way out. Not because any one
 * field is expected to hold a secret, but because the cost of being wrong once
 * is a key or a customer's name sitting in a GitHub issue forever.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Curated catalog ids are filenames in templates/; brand-local ones are UUIDs. */
export const isCurated = (id: string, known: ReadonlySet<string>): boolean =>
  known.has(id) || (!UUID.test(id) && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(id));

export interface BuildInput {
  comment: string;
  target: TargetIdentity;
  route: RouteContext;
  ids: ScenriIds;
  env: Environment;
  errors: ErrorEntry[];
  /** Injected so the id is stable in tests. */
  id: string;
}

/**
 * UI or generation, decided by whether the click resolved to a shot. Inferring
 * it from the same value that fills `ids.local.nodeId` means the two can never
 * disagree, which asking the tester could not guarantee.
 */
export const kindOf = (nodeId: string | null): ReportKind => (nodeId ? 'generation' : 'ui');

export function buildReport(input: BuildInput): Report {
  const nodeId = input.ids.local.nodeId;
  const report: Report = {
    v: 1,
    id: input.id,
    kind: kindOf(nodeId),
    comment: clip(input.comment.trim(), 2000),
    target: input.target,
    route: { ...input.route, path: sanitiseUrl(input.route.path) },
    ids: {
      ...input.ids,
      // the prompt is the point of a generation report and useless noise on a
      // UI one, and it is the field most likely to hold the tester's own copy
      prompt: kindOf(nodeId) === 'generation' ? input.ids.prompt : null,
    },
    env: input.env,
    errors: input.errors.map((e) => ({ ...e, url: e.url ? sanitiseUrl(e.url) : undefined })),
  };
  return scrubDeep(report);
}
