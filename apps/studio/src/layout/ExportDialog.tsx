import { useEffect, useState } from 'react';
import { Dialog, Spinner } from '@radix-ui/themes';
import { api, downloadExport, imgUrl, type ExportPreset, type TextLayer } from '../api.js';
import { flattenToBlob } from '../editor/flatten.js';

const FLAT = 'flat';

/** "1080 x 1920", or what the preset actually leaves alone. */
function sizeOf(p: ExportPreset): string {
  return p.width && p.height ? `${p.width} x ${p.height}` : 'untouched render';
}

/**
 * Export this shot. The flattened option is offered only when there are text
 * layers to flatten; otherwise it would promise something that is not there.
 */
export function ExportDialog({
  open,
  onOpenChange,
  hash,
  baseName,
  layers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hash: string;
  baseName: string;
  layers: TextLayer[];
}) {
  const [presets, setPresets] = useState<ExportPreset[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setPicked(layers.length > 0 ? [FLAT] : ['original']);
    void api
      .exportPresets()
      .then(setPresets)
      .catch(() => setPresets([]));
  }, [open, layers.length]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const serverPresets = picked.filter((id) => id !== FLAT);
  const wantsFlat = picked.includes(FLAT);
  const files = serverPresets.length > 0 ? (wantsFlat ? 2 : 1) : wantsFlat ? 1 : 0;

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (wantsFlat) {
        const blob = await flattenToBlob(imgUrl(hash), layers);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${baseName}-with-text.png`;
        a.click();
        URL.revokeObjectURL(a.href);
      }
      if (serverPresets.length > 0) await downloadExport(hash, serverPresets, baseName);
      onOpenChange(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  const rows: { id: string; label: string; note: string }[] = [
    ...(layers.length > 0
      ? [
          {
            id: FLAT,
            label: 'PNG with text',
            note: `${layers.length} layer${layers.length === 1 ? '' : 's'} flattened into the pixels`,
          },
        ]
      : []),
    ...presets.map((p) => ({ id: p.id, label: p.label.replace(/\s*\d+×\d+$/, ''), note: sizeOf(p) })),
  ];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="360px" aria-describedby={undefined}>
        <Dialog.Title>Export this shot</Dialog.Title>
        <p className="sc-dlg-sub">
          {layers.length > 0
            ? 'Text layers render into the pixels exactly as shown.'
            : 'Pick the sizes you need. Several downloads one zip.'}
        </p>
        <div className="sc-opts">
          {rows.map((r) => (
            <button
              type="button"
              key={r.id}
              className="sc-opt"
              data-active={picked.includes(r.id)}
              onClick={() => toggle(r.id)}
              aria-pressed={picked.includes(r.id)}
            >
              <span className="sc-cb" />
              <span>
                {r.label}
                <small>{r.note}</small>
              </span>
            </button>
          ))}
        </div>
        {err && <p className="sc-dlg-err">{err}</p>}
        <button
          type="button"
          className="sc-btn sc-btn-primary sc-dlg-go"
          disabled={files === 0 || busy}
          onClick={() => void run()}
        >
          {busy ? (
            <Spinner size="1" />
          ) : files === 0 ? (
            'Download'
          ) : files > 1 ? (
            'Download both'
          ) : serverPresets.length > 0 ? (
            'Download zip'
          ) : (
            'Download PNG'
          )}
        </button>
      </Dialog.Content>
    </Dialog.Root>
  );
}
