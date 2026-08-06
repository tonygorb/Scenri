import { useCallback } from 'react';
import { api, type TreeNode } from './api.js';
import { useToasts } from './toasts.js';

/**
 * Archive is a real, restorable put-away — not the old client-only Dismiss,
 * which never came back. One implementation, called from every surface that
 * can act on a node (feed tile, its context menu, the detail overlay, the
 * Info tab), so "archive this shot" only ever means one thing.
 */
export function useArchiveNode(onChanged: () => Promise<void> | void) {
  const { push } = useToasts();

  const archive = useCallback(
    (node: TreeNode) =>
      api
        .archiveNode(node.id, true)
        .then(() => onChanged())
        .then(() => {
          push({
            kind: 'success',
            title: 'Archived',
            action: {
              label: 'Undo',
              onClick: () => void api.archiveNode(node.id, false).then(onChanged),
            },
          });
        })
        .catch((e: any) =>
          push({ kind: 'error', title: 'Could not archive this shot', detail: String(e.message ?? e) }),
        ),
    [onChanged, push],
  );

  const unarchive = useCallback(
    (node: TreeNode) =>
      api
        .archiveNode(node.id, false)
        .then(() => onChanged())
        .catch((e: any) =>
          push({ kind: 'error', title: 'Could not restore this shot', detail: String(e.message ?? e) }),
        ),
    [onChanged, push],
  );

  const unarchiveBatch = useCallback(
    (ids: string[]) =>
      Promise.all(ids.map((id) => api.archiveNode(id, false)))
        .then(() => onChanged())
        .catch((e: any) =>
          push({ kind: 'error', title: 'Could not restore these shots', detail: String(e.message ?? e) }),
        ),
    [onChanged, push],
  );

  return { archive, unarchive, unarchiveBatch };
}
