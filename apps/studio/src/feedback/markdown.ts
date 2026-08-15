import type { Report } from './types.js';

/**
 * A report, as the issue body a human reads.
 *
 * The curated/local split is the reason this is not a JSON dump. A scene id
 * like `interiors-marble-kitchen-counter` is a file the owner can open; a
 * brand UUID exists only on the tester's laptop. Printing them in one list
 * wastes the owner's time on ids they cannot look up, so they get separate
 * headings that say which is which.
 */

const line = (k: string, v: unknown): string =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)
    ? ''
    : `- **${k}:** ${Array.isArray(v) ? v.join(', ') : v}\n`;

export function toMarkdown(r: Report): string {
  const t = r.target;
  const out: string[] = [];

  out.push(`${r.comment || '_(no comment)_'}\n`);
  out.push('\n---\n\n');
  out.push('<!-- paste your screenshot above this line -->\n\n');

  out.push('### Where\n');
  out.push(line('Area', t.areaChain.length ? t.areaChain.join(' ← ') : t.area));
  out.push(line('Route', r.route.pattern ?? r.route.path));
  out.push(line('Path', r.route.path));
  out.push(line('Dialog', r.route.dialog));
  out.push(line('Element', `\`${t.tag}\`${t.fb ? ` [data-fb=${t.fb}]` : ''}${t.role ? ` role=${t.role}` : ''}`));
  out.push(line('Label', t.accessibleName ?? t.text));
  out.push(line('Target box', `${t.rect.w}×${t.rect.h} at ${t.rect.x},${t.rect.y}`));

  const c = r.ids.curated;
  out.push('\n### Reproduce (these exist on your machine)\n');
  out.push(line('Engine', c.engineId));
  out.push(
    line(
      'Engine available',
      c.engineAvailable === null ? null : `${c.engineAvailable}${c.engineReason ? ` (${c.engineReason})` : ''}`,
    ),
  );
  out.push(line('Quality', c.quality));
  out.push(line('Format', c.format));
  out.push(line('Variants', c.count));
  out.push(line('Scenes', c.sceneIds));
  out.push(line('Presenters', c.presenterIds));
  out.push(line('Demo products', c.demoProductIds));

  const l = r.ids.local;
  const localBody = [
    line('Brand', l.brandSlug ? `${l.brandSlug} (${l.brandId})` : l.brandId),
    line('Project', l.projectId),
    line('Set', l.setSlug),
    line('Shot', l.nodeId),
    line('Variant', l.variant),
    line('Image hash', l.imageHash),
    line('Products', l.productIds),
    line('Custom scenes', l.customSceneIds),
    line('Custom presenters', l.customPresenterIds),
    line('Shot status', r.ids.nodeStatus),
    line('Shot error', r.ids.nodeError ? `\`${r.ids.nodeError}\`` : null),
  ].join('');
  if (localBody.trim()) {
    out.push('\n### Only on the tester’s machine (ask, do not look up)\n');
    out.push(localBody);
  }

  if (r.ids.prompt) {
    out.push('\n### Compiled prompt\n\n```\n');
    out.push(r.ids.prompt);
    out.push('\n```\n');
  }

  if (r.errors.length) {
    out.push('\n### Recent errors\n');
    for (const e of r.errors) {
      out.push(`- \`${e.kind}\` ${e.method ?? ''} ${e.url ?? ''}${e.status ? ` → ${e.status}` : ''} — ${e.message}\n`);
    }
  }

  const e = r.env;
  out.push('\n### Environment\n');
  out.push(line('Build', e.build));
  out.push(line('Browser', `${e.browser} on ${e.os}`));
  out.push(line('Device', `${e.device}, ${e.viewport.w}×${e.viewport.h} @${e.dpr}x`));
  out.push(line('Theme', e.theme));
  out.push(line('Online', e.online));
  out.push(line('When', e.at));
  out.push(line('Report id', r.id));

  return out.join('');
}

/** GitHub truncates long URLs, so the link carries a summary and the clipboard carries the rest. */
export function toIssueUrl(r: Report, base: string): string {
  if (!base) return '';
  const title = r.comment
    ? `[${r.kind}] ${r.comment.split('\n')[0].slice(0, 70)}`
    : `[${r.kind}] ${r.target.area ?? 'report'}`;
  const body = [
    '<!-- 1. paste the full report:  ⌘V -->',
    '<!-- 2. paste a screenshot too, if it is visual:  ⌘⇧5 then ⌘V -->',
    '',
    `**${r.comment || '(no comment)'}**`,
    '',
    `${r.target.area ?? 'unknown area'} · ${r.route.pattern ?? r.route.path} · ${r.env.build} · ${r.env.device}`,
  ].join('\n');
  return `${base}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}
