import { ArrowRight, Check, X } from '@phosphor-icons/react';
import { useBrand } from '../../app/BrandLayout.js';
import type { GuideTaskId } from '../../api.js';
import { guideIntent, useGuide } from '../../guide.js';
import { firstSteps, nextStep } from '../../guidedTasks.js';
import { Tip } from '../../layout/Tip.js';
import { useLaunchTask } from '../../layout/useLaunchTask.js';
import { useToasts } from '../../toasts.js';

export interface StepPictures {
  compose: string | null;
  product: string | null;
  presenter: string | null;
  scene: string | null;
}

/**
 * First steps, on Home (DESIGN.md, "First use"): the one next thing to do,
 * with a picture of it, a sentence on what it gives and a way to start, and
 * every step in a quiet row under it to take in any order. Each step is a
 * guided task done in the product itself; a step is ticked by what the library
 * holds, once, and stays ticked. A count, never a percentage; it leaves once
 * everything is done and hides on request, and Help brings it back.
 */
export function FirstSteps({ pictures }: { pictures: StepPictures }) {
  const guide = useGuide();
  const { brand } = useBrand();
  const launch = useLaunchTask();
  const { push } = useToasts();
  // A task in hand for another brand is that brand's: here it is only a step to take.
  const rows = firstSteps({ ...guide, active: guide.active?.brandId === brand.id ? guide.active : null });
  if (!rows) return null;
  const done = rows.filter((r) => r.state === 'done').length;
  const next = nextStep(rows);
  const picture: Record<GuideTaskId, string | null> = {
    'first-shot': pictures.compose,
    refine: pictures.compose,
    product: pictures.product,
    presenter: pictures.presenter,
    scene: pictures.scene,
  };
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
      <div className="sc-steps-next">
        {next && picture[next.task] && (
          <img className="sc-steps-art" src={picture[next.task] as string} alt="" aria-hidden="true" />
        )}
        <div className="sc-steps-copy">
          <p className="sc-steps-eyebrow">
            <span id="sc-steps-title">First steps</span>
            <span aria-hidden="true"> · </span>
            <span className="sc-steps-count">
              {done} of {rows.length} done
            </span>
          </p>
          <h2 className="sc-steps-title">{next ? next.title : 'Every first step is done'}</h2>
          <p className="sc-steps-why">{next ? next.why : 'Any of them can be done again from the row below.'}</p>
        </div>
        {next && (
          <button type="button" className="sc-btn sc-btn-primary sc-steps-go" onClick={() => void launch(next.task)}>
            {next.state === 'active' ? 'Continue' : 'Start'}
            <ArrowRight size={14} weight="bold" />
          </button>
        )}
        <Tip label="Hide first steps">
          <button type="button" className="sc-coach-x sc-steps-x" aria-label="Hide first steps" onClick={hide}>
            <X size={15} />
          </button>
        </Tip>
      </div>
      <ol className="sc-steps-row" aria-label="Every first step">
        {rows.map((r) => (
          <li key={r.task}>
            <button
              type="button"
              className="sc-steps-item"
              data-state={r.state}
              data-next={r.task === next?.task || undefined}
              aria-current={r.task === next?.task ? 'step' : undefined}
              onClick={() => void launch(r.task)}
            >
              <span className="sc-steps-mark" aria-hidden="true">
                {r.state === 'done' && <Check size={10} weight="bold" />}
              </span>
              {r.label}
              {r.state === 'done' && <span className="sc-vh">, done</span>}
              {r.state === 'active' && <span className="sc-vh">, in progress</span>}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
