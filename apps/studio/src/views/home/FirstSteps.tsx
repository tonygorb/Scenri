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
 * step is ticked by what the library holds, once, and stays ticked. It shows
 * no count and no percentage, leaves once everything is done, and hides on
 * request; Help brings it back.
 */
export function FirstSteps() {
  const guide = useGuide();
  const { brand } = useBrand();
  const launch = useLaunchTask();
  const { push } = useToasts();
  // A task in hand for another brand is that brand's: here it is only a step to take.
  const rows = firstSteps({ ...guide, active: guide.active?.brandId === brand.id ? guide.active : null });
  if (!rows) return null;
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
    <nav className="sc-steps" aria-label="First steps">
      <span className="sc-steps-lb" aria-hidden="true">
        First steps
      </span>
      <ol className="sc-steps-list">
        {rows.map((r) => (
          <li key={r.task}>
            <button type="button" className="sc-steps-item" data-state={r.state} onClick={() => void launch(r.task)}>
              <span className="sc-steps-mark" aria-hidden="true">
                {r.state === 'done' && <Check size={9} weight="bold" />}
              </span>
              {r.label}
              {r.state !== 'todo' && <span className="sc-vh">{r.state === 'done' ? ', done' : ', in progress'}</span>}
            </button>
          </li>
        ))}
      </ol>
      <Tip label="Hide first steps">
        <button type="button" className="sc-coach-x sc-steps-x" aria-label="Hide first steps" onClick={hide}>
          <X size={14} />
        </button>
      </Tip>
    </nav>
  );
}
