import { Dialog, Spinner, Callout } from '@radix-ui/themes';
import { CheckCircle, WarningCircle, XCircle } from '@phosphor-icons/react';
import type { CatalogImportJob } from '../api.js';
import { catalogPercent } from '../tasks.js';

const _STAGE_LABEL: Record<string, string> = {
  queued: 'Queued',
  discovering: 'Discovering catalog',
  fetching_products: 'Fetching products',
  processing_assets: 'Processing assets',
  completed: 'Completed',
  partial: 'Partially completed',
  failed: 'Failed',
};

export function CatalogImportDialog({
  open,
  job,
  productCount,
  onClose,
  onContinue,
  continueLabel = 'Continue',
}: {
  open: boolean;
  job: CatalogImportJob | null;
  productCount: number;
  onClose: () => void;
  onContinue?: () => void;
  continueLabel?: string;
}) {
  const stage = job?.stage ?? 'queued';
  const running =
    stage === 'queued' || stage === 'discovering' || stage === 'fetching_products' || stage === 'processing_assets';
  const usable = productCount > 0 || (job?.upserted ?? 0) > 0;
  const done = stage === 'completed' || stage === 'partial' || stage === 'failed';

  // the notifications bell draws the same import; one formula, not two
  const pct = catalogPercent(job);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <Dialog.Content
        maxWidth="440px"
        onPointerDownOutside={(e) => {
          if (running) e.preventDefault();
        }}
      >
        <Dialog.Title>Importing catalog</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="3">
          {job?.url ? `From ${job.url.replace(/^https?:\/\//, '')}` : 'Reading the store catalog'}
          {job?.platform && job.platform !== 'unknown' ? ` · ${job.platform}` : ''}
        </Dialog.Description>

        <div
          style={{ height: 6, borderRadius: 99, background: 'var(--sc-line)', overflow: 'hidden', marginBottom: 14 }}
        >
          <div
            style={{
              height: '100%',
              width: `${pct}%`,
              background: stage === 'failed' ? 'var(--red-9)' : 'var(--sc-fg)',
              transition: 'width 0.35s ease',
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, marginBottom: 14 }}>
          <Row
            state={
              stage === 'discovering'
                ? 'active'
                : ['fetching_products', 'processing_assets', 'completed', 'partial'].includes(stage)
                  ? 'done'
                  : stage === 'failed' && !job?.discovered
                    ? 'fail'
                    : 'idle'
            }
            label="Discovering catalog"
            detail={job?.discovered ? `${job.discovered} found` : undefined}
          />
          <Row
            state={
              stage === 'fetching_products'
                ? 'active'
                : ['processing_assets', 'completed', 'partial'].includes(stage)
                  ? 'done'
                  : stage === 'failed' && job?.fetched
                    ? 'fail'
                    : 'idle'
            }
            label="Fetching products"
            detail={job ? `${job.fetched || job.upserted} saved` : undefined}
          />
          <Row
            state={
              stage === 'processing_assets'
                ? 'active'
                : stage === 'completed' || stage === 'partial'
                  ? job?.errors?.length
                    ? 'warn'
                    : 'done'
                  : 'idle'
            }
            label="Processing assets"
            detail={job?.imagesTotal ? `${job.imagesDone}/${job.imagesTotal}` : undefined}
          />
        </div>

        {job?.message && <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--sc-fg2)' }}>{job.message}</p>}

        {productCount > 0 && (
          <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--sc-fg3)' }}>
            {productCount} product{productCount === 1 ? '' : 's'} in your library
          </p>
        )}

        {done && stage === 'failed' && (
          <Callout.Root color="red" size="1" mb="3">
            <Callout.Text>{job?.message || job?.errors?.[0]?.message || 'Import failed'}</Callout.Text>
          </Callout.Root>
        )}
        {stage === 'partial' && (
          <Callout.Root color="amber" size="1" mb="3">
            <Callout.Text>
              {job?.errors?.length
                ? `${job.errors.length} item${job.errors.length === 1 ? '' : 's'} could not be imported. Everything else is ready.`
                : 'Import finished with some gaps.'}
            </Callout.Text>
          </Callout.Root>
        )}
        {job?.errors?.length && job.errors.length <= 5 && stage !== 'failed' ? (
          <ul style={{ margin: '0 0 12px', paddingLeft: 18, fontSize: 11.5, color: 'var(--sc-fg3)' }}>
            {job.errors.slice(0, 5).map((e) => (
              <li key={`${e.url ?? ''}:${e.message}`}>
                {e.message}
                {e.url ? ` (${e.url})` : ''}
              </li>
            ))}
          </ul>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {running && usable && onContinue && (
            <button type="button" className="sc-btn sc-btn-ghost" onClick={onContinue}>
              {continueLabel}
            </button>
          )}
          {running && !usable && (
            <button type="button" className="sc-btn sc-btn-ghost" onClick={onClose}>
              Hide
            </button>
          )}
          {done && (
            <button type="button" className="sc-wiz-cta" style={{ margin: 0 }} onClick={onContinue ?? onClose}>
              {stage === 'failed' && !usable ? 'Close' : continueLabel}
            </button>
          )}
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function Row({
  state,
  label,
  detail,
}: {
  state: 'idle' | 'active' | 'done' | 'warn' | 'fail';
  label: string;
  detail?: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        color: state === 'idle' ? 'var(--sc-fg3)' : 'var(--sc-fg)',
      }}
    >
      {state === 'active' && <Spinner size="1" />}
      {state === 'done' && <CheckCircle size={14} weight="fill" />}
      {state === 'warn' && <WarningCircle size={14} weight="fill" color="var(--amber-9)" />}
      {state === 'fail' && <XCircle size={14} weight="fill" color="var(--red-9)" />}
      {state === 'idle' && (
        <span
          style={{
            width: 14,
            height: 14,
            borderRadius: 99,
            border: '1px solid var(--sc-line)',
            display: 'inline-block',
          }}
        />
      )}
      <span style={{ flex: 1 }}>{label}</span>
      {detail && <span style={{ fontSize: 11.5, color: 'var(--sc-fg3)' }}>{detail}</span>}
    </div>
  );
}
