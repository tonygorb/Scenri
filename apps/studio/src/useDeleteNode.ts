import { useCallback } from 'react';
import { api, type TreeNode } from './api.js';
import { useToasts } from './toasts.js';

/**
 * Permanent. No Undo here — the confirm dialog at the call site is the
 * safety net, not a toast, since there is nothing to undo to. Only ever
 * called on an already-archived node; the server enforces that too.
 */
export function useDeleteNode(onChanged: () => Promise<void> | void) {
  const { push } = useToasts();

  const remove = useCallback(
    (node: TreeNode) =>
      api
        .deleteNode(node.id)
        .then(() => onChanged())
        .catch((e: any) =>
          push({ kind: 'error', title: 'Could not delete this shot', detail: String(e.message ?? e) }),
        ),
    [onChanged, push],
  );

  const removeBatch = useCallback(
    (ids: string[]) =>
      api
        .deleteNodesBatch(ids)
        .then(() => onChanged())
        .catch((e: any) =>
          push({ kind: 'error', title: 'Could not delete these shots', detail: String(e.message ?? e) }),
        ),
    [onChanged, push],
  );

  return { remove, removeBatch };
}
