import { useEffect, useState } from 'react';
import { Dialog, Spinner } from '@radix-ui/themes';
import { X } from '@phosphor-icons/react';
import { api, imgUrl, nodeLabel, type TreeNode } from '../api.js';

/**
 * Two shots, side by side, with the drift between them.
 *
 * The heatmap already existed and was reachable only from a tab called Info
 * inside the shot overlay, which meant the one feature that answers "what did
 * the model change that I did not ask it to" could only be used against a
 * shot's own parent. Any two shots is the question people actually have.
 *
 * The score is stated as a plain percentage of pixels and then in words,
 * because a number on its own does not say whether it is good news.
 */
export function CompareDialog({
  a,
  b,
  imageA,
  imageB,
  open,
  onOpenChange,
}: {
  a: TreeNode;
  b: TreeNode;
  /** The variant of each that is on screen, so it compares what you were looking at. */
  imageA: string;
  imageB: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [diff, setDiff] = useState<{ score: number; heatmapHash: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (!open) return;
    setDiff(null);
    setErr(null);
    let alive = true;
    void api
      .diff(imageA, imageB)
      .then((d) => {
        if (alive) setDiff(d);
      })
      .catch((e: any) => {
        if (alive) setErr(String(e?.message ?? e));
      });
    return () => {
      alive = false;
    };
  }, [open, imageA, imageB, retryTick]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="860px" aria-describedby={undefined}>
        <Dialog.Close>
          <button type="button" className="sc-set-close sc-dlg-close" aria-label="Close">
            <X size={16} />
          </button>
        </Dialog.Close>
        <Dialog.Title>Compare</Dialog.Title>
        <div className="sc-cmp">
          <figure className="sc-cmp-side">
            <img src={imgUrl(imageA)} alt="" />
            <figcaption dir="auto">{nodeLabel(a)}</figcaption>
          </figure>
          <figure className="sc-cmp-side">
            <img src={imgUrl(imageB)} alt="" />
            <figcaption dir="auto">{nodeLabel(b)}</figcaption>
          </figure>
          <figure className="sc-cmp-side">
            {err ? (
              <div className="sc-cmp-err">
                {err}
                <button type="button" className="sc-cell-retry" onClick={() => setRetryTick((t) => t + 1)}>
                  Try again
                </button>
              </div>
            ) : diff ? (
              <img src={imgUrl(diff.heatmapHash)} alt="Heatmap of the pixels that differ" />
            ) : (
              <div className="sc-cmp-wait">
                <Spinner />
              </div>
            )}
            <figcaption>drift</figcaption>
          </figure>
        </div>
        {diff && (
          <p className="sc-cmp-note">
            <b>{(diff.score * 100).toFixed(1)}% of pixels changed.</b>{' '}
            {diff.score > 0.35
              ? 'A different photograph, not a variation of the same one.'
              : diff.score > 0.12
                ? 'The frame moved. Check the product is still exactly itself.'
                : 'Close enough to read as the same setup.'}
          </p>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
