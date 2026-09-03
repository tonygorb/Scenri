import { useCallback } from 'react';
import { api, type FeedNode } from './api.js';
import { useToasts } from './toasts.js';
import { failureToast } from './failure.js';

/**
 * Permanent. No Undo here — the confirm dialog at the call site is the
 * safety net, not a toast, since there is nothing to undo to. Only ever
 * called on an already-archived node; the server enforces that too.
 */
export function useDeleteNode(onDrop: (ids: string[]) => void) {
  const { push } = useToasts();

  const remove = useCallback(
    (node: FeedNode) =>
      api
        .deleteNode(node.id)
        .then(() => onDrop([node.id]))
        .catch((e: any) => push(failureToast(e, 'Could not delete this shot'))),
    [onDrop, push],
  );

  const removeBatch = useCallback(
    (ids: string[]) =>
      api
        .deleteNodesBatch(ids)
        .then(() => onDrop(ids))
        .catch((e: any) => push(failureToast(e, 'Could not delete these shots'))),
    [onDrop, push],
  );

  return { remove, removeBatch };
}
