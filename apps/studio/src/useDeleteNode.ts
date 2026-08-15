import { useCallback } from 'react';
import { api, type TreeNode } from './api.js';
import { useToasts } from './toasts.js';
import { failureToast } from './failure.js';

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
        .catch((e: any) => push(failureToast(e, 'Could not delete this shot'))),
    [onChanged, push],
  );

  const removeBatch = useCallback(
    (ids: string[]) =>
      api
        .deleteNodesBatch(ids)
        .then(() => onChanged())
        .catch((e: any) => push(failureToast(e, 'Could not delete these shots'))),
    [onChanged, push],
  );

  return { remove, removeBatch };
}
