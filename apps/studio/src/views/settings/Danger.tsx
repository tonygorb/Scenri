import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../../api.js';
import { useAppData } from '../../app/AppShell.js';
import { useBrand } from '../../app/BrandLayout.js';
import { brandName } from '../../layout/nav.js';
import { Confirm } from '../../Confirm.js';
import { Group } from './Group.js';

export function Danger({ onDone }: { onDone: () => void }) {
  const { brand, resetShots } = useBrand();
  const { refresh } = useAppData();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (scope: 'shots' | 'all') => {
      setBusy(true);
      try {
        await api.deleteData(scope);
        onDone();
        // the feed and the shot pages behind this dialog hold their own pages
        if (scope === 'shots') resetShots();
        // wiping everything means starting at the wizard, not reloading back
        // into this dialog on a brand that no longer exists
        if (scope === 'all') window.location.replace('/');
      } finally {
        setBusy(false);
      }
    },
    [onDone, resetShots],
  );

  return (
    <>
      {/* Deleting one brand belongs beside deleting all of them, not at the
          bottom of the pane where that brand is edited. Two cards, so which
          deletes reach every brand is plain without a badge. */}
      <Group title="This brand">
        <div className="sc-set-row">
          <span className="txt">
            <b>Delete this brand</b>
            <small data-prose="">Removes {brandName(brand)}, its sets and every shot. Other brands stay.</small>
          </span>
          <Confirm
            label="Delete brand"
            title={`Delete ${brandName(brand)}?`}
            body="The kit, its sets and every shot go with it. Exports you already downloaded stay yours."
            busy={busy}
            onConfirm={() => {
              setBusy(true);
              void api
                .deleteBrand(brand.id)
                // The list first, then the move: navigating while the deleted
                // brand was still listed mounted it again for a round trip, and
                // every read it started for itself failed.
                .then(() => refresh())
                // The row this dialog is rendered inside is gone; land somewhere
                // that still exists rather than re-resolving a dead slug.
                .then(() => navigate('/', { replace: true }))
                .finally(() => setBusy(false));
            }}
          />
        </div>
      </Group>
      <Group title="Every brand">
        <div className="sc-set-row">
          <span className="txt">
            <b>Delete generated shots</b>
            <small data-prose="">
              Removes every set and every generated shot, in every brand. Brands, cast and scenes stay.
            </small>
          </span>
          <Confirm
            label="Delete shots"
            title="Delete every generated shot?"
            body="Brands, cast and scenes stay. Every set and every generated shot goes."
            busy={busy}
            onConfirm={() => void run('shots')}
          />
        </div>
        <div className="sc-set-row">
          <span className="txt">
            <b>Delete all local data</b>
            <small data-prose="">Brands, cast, sets, shots and saved keys, in one go.</small>
          </span>
          <Confirm
            label="Delete everything"
            title="Delete everything on this machine?"
            body="The whole library folder is removed: brands, cast, sets, shots and your saved keys. There is no undo."
            busy={busy}
            onConfirm={() => void run('all')}
          />
        </div>
      </Group>
    </>
  );
}
