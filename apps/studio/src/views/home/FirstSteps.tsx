import { Check, X } from '@phosphor-icons/react';
import { useBrand } from '../../app/BrandLayout.js';
import { guideIntent, useGuide } from '../../guide.js';
import { firstSteps } from '../../guidedTasks.js';
import { Tip } from '../../layout/Tip.js';
import { useLaunchTask } from '../../layout/useLaunchTask.js';
import { useToasts } from '../../toasts.js';

/**
 * First steps, on Home (DESIGN.md, "First use"): the few real things Scenri
 * is for, each one a guided task done in the product itself, in any order. A
 * step is ticked by what the library holds, once, and stays ticked. Quiet by
 * design: a count, never a percentage; it leaves once everything is done and
 * hides on request, and Help brings it back.
 */
export function FirstSteps() {
  const guide = useGuide();
  const { brand } = useBrand();
  const launch = useLaunchTask();
  const { push } = useToasts();
  // A task in hand for another brand is that brand's: here it is only a step to take.
  const rows = firstSteps({ ...guide, active: guide.active?.brandId === brand.id ? guide.active : null });
  if (!rows) return null;
  const done = rows.filter((r) => r.state === 'done').length;
  const hide = () => {
    void guideIntent({ hidden: true });
    push({
      kind: 'success',
      title: 'First steps hidden',
      detail: 'Bring them back from Help.',
      action: { label: 'Undo', onClick: () => void guideIntent({ hidden: false }) },
    });
  };
  return (
    <section className="sc-steps" aria-labelledby="sc-steps-title">
      <div className="sc-steps-head">
        <h2 id="sc-steps-title" className="sc-steps-title">
          First steps
        </h2>
        <span className="sc-steps-count">
          {done} of {rows.length}
        </span>
        <Tip label="Hide first steps">
          <button type="button" className="sc-coach-x sc-steps-x" aria-label="Hide first steps" onClick={hide}>
            <X size={15} />
          </button>
        </Tip>
      </div>
      <ol className="sc-steps-list">
        {rows.map((r) => (
          <li key={r.task}>
            <button type="button" className="sc-steps-item" data-state={r.state} onClick={() => void launch(r.task)}>
              <span className="sc-steps-mark" aria-hidden="true">
                {r.state === 'done' && <Check size={11} weight="bold" />}
              </span>
              <span className="sc-steps-text">
                <span className="sc-steps-name">
                  {r.title}
                  {r.state === 'done' && <span className="sc-vh">, done</span>}
                </span>
                <span className="sc-steps-why">{r.why}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
