import { useEffect, useState } from 'react';
import { Dialog, Spinner } from '@radix-ui/themes';
import { Plus } from '@phosphor-icons/react';
import { api, imgUrl, type Project, type TreeNode } from '../api.js';

/** Recent work, not an inventory: the count below says what is not shown. */
const RECENT = 6;

/** "today", "yesterday", "3 days ago" — enough to recognise your own work. */
function ago(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months === 1 ? 'a month ago' : `${months} months ago`;
}

/**
 * Create with nothing open used to jump silently into whichever project came
 * back first. This asks instead, the way states.html draws it.
 */
export function ProjectPicker({
  open,
  onClose,
  brandId,
  onPick,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  brandId: string | null;
  onPick: (id: string) => void;
  onCreate: () => void;
}) {
  const [rows, setRows] = useState<{ project: Project; shots: number; cover: string | null }[] | null>(null);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!open || !brandId) return;
    let alive = true;
    setRows(null);
    void api
      .projects(brandId)
      // newest first, then cap: capping an unsorted list hides the newest work
      .then((ps) => {
        setTotal(ps.length);
        return [...ps].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, RECENT);
      })
      .then(async (ps) =>
        Promise.all(
          ps.map(async (project) => {
            const tree = await api.tree(project.id).catch(() => null);
            const done = (tree?.nodes ?? []).filter((n: TreeNode) => n.kind !== 'root' && n.images.length > 0);
            return { project, shots: done.length, cover: done[done.length - 1]?.images[0] ?? null };
          }),
        ),
      )
      .then((r) => {
        if (alive) setRows(r);
      })
      .catch(() => {
        if (alive) setRows([]);
      });
    return () => {
      alive = false;
    };
  }, [open, brandId]);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Content maxWidth="470px" aria-describedby={undefined}>
        <Dialog.Title>Pick up where you left off</Dialog.Title>
        {rows === null ? (
          <div className="bt-pickload">
            <Spinner />
          </div>
        ) : (
          <div className="bt-pgrid">
            {rows.map(({ project, shots, cover }) => (
              <button
                type="button"
                key={project.id}
                className="bt-pcard"
                onClick={() => {
                  onPick(project.id);
                  onClose();
                }}
              >
                {cover ? <img src={imgUrl(cover)} alt="" loading="lazy" /> : <span className="bt-pcard-blank" />}
                <span className="bt-pcard-m">
                  <b>{project.name}</b>
                  <small>
                    {shots === 0 ? 'nothing yet' : `${shots} shot${shots === 1 ? '' : 's'}`} · {ago(project.createdAt)}
                  </small>
                </span>
              </button>
            ))}
            <button
              type="button"
              className="bt-pcard bt-pcard-new"
              onClick={() => {
                onCreate();
                onClose();
              }}
            >
              <Plus size={18} />
              New project
            </button>
          </div>
        )}
        {total > RECENT && (
          <p className="bt-dlg-foot">
            Your {RECENT} most recent, of {total}.
          </p>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
