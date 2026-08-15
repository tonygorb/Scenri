import type { ReactNode } from 'react';
import { FeedbackProvider } from './FeedbackProvider.js';
import type { Brand, TreeNode } from '../api.js';

/**
 * The one seam between the app and the feedback layer.
 *
 * `__SC_ALPHA__` is the literal `false` in the public build, so this returns
 * its children unchanged and the bundler drops everything below it — the
 * provider, the picker, the composer and the stylesheet. Keeping that check in
 * a single file means no other component has to carry it, and there is exactly
 * one place to look to be sure the public build is clean.
 */
export function FeedbackHost({
  children,
  brand,
  workspace,
  nodes,
}: {
  children: ReactNode;
  brand: Brand;
  workspace: { id: string } | null;
  nodes: TreeNode[];
}) {
  if (!__SC_ALPHA__) return <>{children}</>;
  return (
    <FeedbackProvider
      brandId={brand.id}
      brandSlug={brand.slug}
      projectId={workspace?.id ?? null}
      nodes={nodes}
      curatedSceneIds={EMPTY}
      curatedPresenterIds={EMPTY}
    >
      {children}
    </FeedbackProvider>
  );
}

const EMPTY: ReadonlySet<string> = new Set();
