import { toIssueUrl, toMarkdown } from './markdown.js';
import type { Report } from './types.js';

/**
 * Where a report goes: the tester's clipboard, then a prefilled GitHub issue.
 *
 * There is no server to post to. scenri is a local-first CLI with no accounts
 * and no hosted anything, and it is open source, so an artifact cannot carry a
 * key to authenticate with one. GitHub is the server: the private feedback
 * repo is the access control, and because the tester is signed in as
 * themselves, GitHub records who filed it — which is the identity scenri
 * cannot supply on its own.
 *
 * A GitHub issue URL breaks somewhere past 8KB, so the link carries a short
 * summary and the clipboard carries the whole report.
 */

export interface SendResult {
  ok: boolean;
  /** Set when the clipboard was refused, so the UI can offer the text instead. */
  markdown: string;
  reason?: string;
  /** False when no feedback repo is configured, so nothing was opened. */
  opened: boolean;
}

/**
 * `navigator.clipboard.writeText` needs transient user activation, so this has
 * to be the first await inside the Send handler — anything awaited before it
 * spends the activation and the write is rejected.
 */
export async function send(report: Report): Promise<SendResult> {
  const markdown = toMarkdown(report);
  let ok = true;
  let reason: string | undefined;

  try {
    await navigator.clipboard.writeText(markdown);
  } catch (e) {
    ok = false;
    reason = e instanceof Error ? e.message : 'clipboard refused';
  }

  // No repo configured (SC_ISSUE_URL unset at build time) means there is
  // nowhere to send: copy and say so, rather than opening a tab at a URL
  // nobody owns.
  const url = toIssueUrl(report, __SC_ISSUE_URL__);
  if (url) window.open(url, '_blank', 'noopener,noreferrer');

  return { ok, markdown, reason, opened: Boolean(url) };
}
