import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../../api.js';
import { useBrand } from '../../app/BrandLayout.js';
import { brandName } from '../../layout/nav.js';
import { Confirm } from '../../Confirm.js';
import { Group } from './Group.js';

export function Danger({ onDone }: { onDone: () => void }) {
  const { brand } = useBrand();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (scope: 'shots' | 'all') => {
      setBusy(true);
      try {
        await api.deleteData(scope);
        onDone();
        // wiping everything means starting at the wizard, not reloading back
        // into this dialog on a brand that no longer exists
        if (scope === 'all') window.location.replace('/');
      } finally {
        setBusy(false);
      }
    },
    [onDone],
  );

  return (
    <Group sub="These do not come back. Export from Library first if you are not certain.">
      {/* Deleting one brand belongs beside deleting all of them, not at the
          bottom of the pane where that brand is edited. */}
      <div className="sc-set-row">
        <span className="txt">
          <b>Delete this brand</b>
          <small>Removes {brandName(brand)}, its projects and every shot. Other brands stay.</small>
        </span>
        <Confirm
          label="Delete brand"
          title={`Delete ${brandName(brand)}?`}
          body="The kit, its projects and every shot go with it. Exports you already downloaded stay yours."
          busy={busy}
          onConfirm={() => {
            setBusy(true);
            void api
              .deleteBrand(brand.id)
              .then(onDone)
              // The row this dialog is rendered inside is gone; land somewhere
              // that still exists rather than re-resolving a dead slug.
              .then(() => navigate('/', { replace: true }))
              .finally(() => setBusy(false));
          }}
        />
      </div>
      <div className="sc-set-row">
        <span className="txt">
          <b>Delete generated shots</b>
          <small>Keeps brands, cast and scenes. Removes every project and its tree.</small>
        </span>
        <Confirm
          label="Delete shots"
          title="Delete every generated shot?"
          body="Brands, cast and scenes stay. Every project and everything generated inside it goes."
          busy={busy}
          onConfirm={() => void run('shots')}
        />
      </div>
      <div className="sc-set-row">
        <span className="txt">
          <b>Delete all local data</b>
          <small>Brands, cast, projects, shots and saved keys, in one go.</small>
        </span>
        <Confirm
          label="Delete everything"
          title="Delete everything on this machine?"
          body="The whole library folder is removed: brands, cast, projects, shots and your saved keys. There is no undo."
          busy={busy}
          onConfirm={() => void run('all')}
        />
      </div>
    </Group>
  );
}
