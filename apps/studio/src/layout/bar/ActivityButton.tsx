import { useEffect, useRef, useState } from 'react';
import { Popover } from '@radix-ui/themes';
import { ActivityFace, type ActivityMode } from './ActivityFace.js';
import { ActivityPanel } from './ActivityPanel.js';
import { BarSheet } from './BarSheet.js';
import { useBarPanel } from './useBarPanel.js';
import { Tip } from '../Tip.js';
import { ImportProgress } from '../../views/ImportProgress.js';
import { useBrand } from '../../app/BrandLayout.js';
import { useTaskCenter } from '../../app/TaskCenter.js';
import { elapsedLabel } from '../../tasks.js';
import { PHONE, useMediaQuery } from '../../useMediaQuery.js';

/**
 * Activity: what is happening, and what happened while you were elsewhere.
 *
 * The control says which of those it has for you rather than always drawing the
 * same bell: work in flight puts the picture being rendered in the bar, inside a
 * ring that fills. It is the most specific thing the chrome can say, and it says
 * it in the space a bell was using anyway.
 *
 * Above 768px the lists open in a popover under the control; below, a sheet off
 * the bottom edge, because the top right corner of a phone is the furthest point
 * from a thumb.
 */
export function ActivityButton() {
  const { tasks, running, unread, panelOpen, setPanelOpen, markSeen } = useTaskCenter();
  const { brand } = useBrand();
  const phone = useMediaQuery(PHONE);
  const settled = useSettled();
  /**
   * The import someone opened, held HERE rather than in the panel.
   *
   * The panel closes when a dialog opens, and this dialog is one. Owned by the
   * panel, it unmounted with the surface that had just opened it: the import
   * dialog flashed and vanished on every click. It has to outlive the panel, so
   * it lives beside it.
   */
  const [detailJob, setDetailJob] = useState<string | null>(null);

  // A job belongs to the brand it was started for. Switching brands with this
  // open used to ask the new brand about the old brand's job: a 404 the dialog
  // reads as "not yet", so it retried every 900 ms for ever.
  useEffect(() => setDetailJob(null), [brand.id]);
  useBarPanel(panelOpen, () => setPanelOpen(false));

  const lead = tasks.find((t) => t.state === 'running') ?? null;
  const mode: ActivityMode = running > 0 ? 'busy' : unread > 0 ? 'new' : 'quiet';
  const label =
    'Activity' +
    (unread ? `, ${unread} unread` : '') +
    (running ? `, ${running} task${running === 1 ? '' : 's'} running` : '');
  // The bar carries no clock: a readout that changes width every second never
  // settles. The elapsed time is here, and in the panel.
  const tip = mode === 'busy' && lead ? `Rendering, ${elapsedLabel(lead.startedAt, Date.now())}` : 'Activity';

  const face = <ActivityFace mode={mode} lead={lead} running={running} unread={unread} animate={settled} />;

  if (phone) {
    return (
      <>
        <button
          type="button"
          className="sc-act-btn sc-notif-btn"
          data-mode={mode}
          data-on={panelOpen || undefined}
          aria-label={label}
          aria-expanded={panelOpen}
          onClick={() => setPanelOpen(!panelOpen)}
        >
          {face}
        </button>
        {panelOpen ? (
          <BarSheet label="Activity" onClose={() => setPanelOpen(false)}>
            <ActivityPanel onClose={() => setPanelOpen(false)} onSeen={markSeen} onOpenDetail={setDetailJob} />
          </BarSheet>
        ) : null}
        {detailJob ? (
          <ImportProgress brandId={brand.id} jobId={detailJob} onDismiss={() => setDetailJob(null)} />
        ) : null}
      </>
    );
  }

  return (
    <>
      <Popover.Root open={panelOpen} onOpenChange={setPanelOpen}>
        <Tip label={tip}>
          <Popover.Trigger>
            <button type="button" className="sc-act-btn sc-notif-btn" data-mode={mode} aria-label={label}>
              {face}
            </button>
          </Popover.Trigger>
        </Tip>
        {/* 36px control in a 60px row: 12 of air, so 20 lands the card 8 below
          the bar, on the same line as every other panel. */}
        <Popover.Content align="end" sideOffset={20} className="sc-notif-pop" aria-label="Activity">
          <ActivityPanel onClose={() => setPanelOpen(false)} onSeen={markSeen} onOpenDetail={setDetailJob} />
        </Popover.Content>
      </Popover.Root>
      {detailJob ? <ImportProgress brandId={brand.id} jobId={detailJob} onDismiss={() => setDetailJob(null)} /> : null}
    </>
  );
}

/**
 * False on the first paint, true ever after. The bar simply is there when the
 * page arrives; a lone control fading in while nothing else does reads as a
 * glitch, and the faces animate only once they are replacing one another.
 */
function useSettled(): boolean {
  const [settled, setSettled] = useState(false);
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    setSettled(true);
  }, []);
  return settled;
}
