import { useCallback } from 'react';
import { api, nodeLabel, type FeedNode } from './api.js';
import { useToasts } from './toasts.js';
import { failureToast } from './failure.js';

/**
 * Archive is a real, restorable put-away — not the old client-only Dismiss,
 * which never came back. One implementation, called from every surface that
 * can act on a node (feed tile, its context menu, the detail overlay, the
 * Info tab), so "archive this shot" only ever means one thing.
 */
export function useArchiveNode(onNode: (node: FeedNode) => void) {
  const { push } = useToasts();

  // Both answer whether it happened. The overlay closes after an archive,
  // and used to close after a refused one too: the failure was caught and
  // toasted in here, so the caller's `.then` ran either way.
  const archive = useCallback(
    (node: FeedNode): Promise<boolean> =>
      api
        .archiveNode(node.id, true)
        .then((next) => {
          onNode(next);
          push({
            kind: 'success',
            // which shot: archiving four in a row produced four identical
            // toasts, and no way to tell which Undo restored which
            title: 'Archived',
            detail: nodeLabel(node),
            action: {
              label: 'Undo',
              onClick: () => void api.archiveNode(node.id, false).then(onNode),
            },
          });
          return true;
        })
        .catch((e: any) => {
          push(failureToast(e, 'Could not archive this shot'));
          return false;
        }),
    [onNode, push],
  );

  const unarchive = useCallback(
    (node: FeedNode): Promise<boolean> =>
      api
        .archiveNode(node.id, false)
        .then((next) => {
          onNode(next);
          return true;
        })
        .catch((e: any) => {
          push(failureToast(e, 'Could not restore this shot'));
          return false;
        }),
    [onNode, push],
  );

  const unarchiveBatch = useCallback(
    (ids: string[]) =>
      Promise.all(ids.map((id) => api.archiveNode(id, false)))
        .then((results) => {
          for (const n of results) onNode(n);
        })
        .catch((e: any) => push(failureToast(e, 'Could not restore these shots'))),
    [onNode, push],
  );

  return { archive, unarchive, unarchiveBatch };
}
