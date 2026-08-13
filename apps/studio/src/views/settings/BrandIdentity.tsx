import { useState } from 'react';
import { Plus, TrashSimple, UploadSimple } from '@phosphor-icons/react';
import { api, imgUrl, uploadLogo, type Brand } from '../../api.js';
import { MARK_BACKGROUNDS, MARK_ROLES, MARK_ROLE_LABEL, marksOf, type Mark } from '../../brand/marks.js';
import { EditableText } from '../../layout/EditableText.js';
import { useFileDrop } from '../../layout/Dropzone.js';
import { useToasts } from '../../toasts.js';
import type { BrandDoc } from './useBrandDoc.js';

/**
 * Who this brand is: mark, name, tagline.
 *
 * An ordinary Settings row — same 32px well, same `b`/`small` text block as the
 * engine rows next door. Two earlier versions painted this in the brand's own
 * primary; both read as a foreign object dropped into the dialog, and the
 * palette immediately below already states those colours anyway.
 *
 * Name and tagline are edited in place. The row is a drop target, because "drag
 * your logo onto your brand" needs no instructions.
 */
export function BrandIdentity({ brand, doc }: { brand: Brand; doc: BrandDoc }) {
  const { push } = useToasts();
  const [busy, setBusy] = useState(false);
  const json = doc.json ?? {};
  const meta = json.meta ?? {};
  const name: string = meta.name ?? brand.slug;
  const marks = marksOf(json);
  const primary = marks.find((m) => m.role === 'primary') ?? marks[0];
  const rest = marks.filter((m) => m !== primary);

  const writeMeta = (fields: Record<string, string>) => {
    const next: Record<string, unknown> = { ...meta };
    for (const [k, raw] of Object.entries(fields)) {
      const v = raw.trim();
      if (v) next[k] = v;
      else delete next[k];
    }
    // A nameless brand is not a valid document; keep the stored one.
    if (!next.name) next.name = meta.name;
    doc.patch({ meta: next });
  };

  const run = async (what: string, fn: () => Promise<any>) => {
    setBusy(true);
    try {
      // Marks go through their own endpoints and come back as a whole row, so
      // anything pending here has to land first or it is overwritten by it.
      await doc.flush();
      doc.applyRow(await fn());
    } catch (e: any) {
      push({ kind: 'error', title: what, detail: String(e?.message ?? e) });
    } finally {
      setBusy(false);
    }
  };

  const upload = (files: File[]) => void run('Could not upload that mark', () => uploadLogo(brand.id, files[0]));
  const { dropProps } = useFileDrop({
    onFiles: upload,
    onReject: () => push({ kind: 'error', title: 'That is not an image', detail: 'Drop a PNG, SVG or JPG.' }),
    disabled: busy,
  });

  return (
    <div className="sc-ident" {...dropProps}>
      <div className="sc-set-row">
        <MarkWell
          mark={primary}
          name={name}
          busy={busy}
          onUpload={upload}
          onBackground={(background) =>
            void run('Could not update that mark', () => api.updateLogo(brand.id, primary?.hash ?? '', { background }))
          }
          onRemove={() => void run('Could not remove that mark', () => api.deleteLogo(brand.id, primary?.hash ?? ''))}
        />
        <span className="txt">
          <EditableText
            label="Brand name"
            variant="name"
            value={meta.name ?? ''}
            placeholder={brand.slug}
            maxLength={120}
            onCommit={(next) => writeMeta({ name: next })}
          />
          <EditableText
            label="Tagline"
            variant="lede"
            /* Wraps rather than scrolls: a scraped tagline is often a whole
               sentence, and a single-line field shows the middle of it. */
            multiline
            value={meta.tagline ?? ''}
            placeholder="Add a tagline"
            maxLength={200}
            onCommit={(next) => writeMeta({ tagline: next })}
          />
        </span>
      </div>

      {primary && rest.length > 0 && (
        <div className="sc-marks">
          {/* Only the alternates: the primary is the well above, and showing it
              here as well read as the same logo twice. */}
          {rest.map((m) => (
            <MarkChip
              key={m.hash ?? m.file}
              mark={m}
              busy={busy}
              onRole={(role) =>
                void run('Could not retag that mark', () => api.updateLogo(brand.id, m.hash ?? '', { role }))
              }
              onBackground={(background) =>
                void run('Could not update that mark', () => api.updateLogo(brand.id, m.hash ?? '', { background }))
              }
              onRemove={() => void run('Could not remove that mark', () => api.deleteLogo(brand.id, m.hash ?? ''))}
            />
          ))}
          <label className="sc-marks-add">
            <Plus size={12} />
            <span>Variant</span>
            <input
              type="file"
              accept="image/*"
              hidden
              disabled={busy}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';
                if (files.length) upload(files);
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}

function MarkWell({
  mark,
  name,
  busy,
  onUpload,
  onBackground,
  onRemove,
}: {
  mark?: Mark;
  name: string;
  busy: boolean;
  onUpload: (files: File[]) => void;
  onBackground: (background: string) => void;
  onRemove: () => void;
}) {
  if (mark) {
    const src = mark.hash ? imgUrl(mark.hash) : mark.file;
    return (
      <span className="sc-well-wrap">
        <span className="sc-well" data-bg={mark.background}>
          <img src={src} alt={`${name} logo`} />
        </span>
        {mark.attachable && (
          <span className="sc-well-acts">
            <select
              value={mark.background}
              disabled={busy}
              onChange={(e) => onBackground(e.target.value)}
              aria-label="Sits on"
            >
              {MARK_BACKGROUNDS.map((b) => (
                <option value={b} key={b}>
                  {b === 'any' ? 'Any background' : `On ${b}`}
                </option>
              ))}
            </select>
            <button type="button" disabled={busy} onClick={onRemove} aria-label="Remove logo">
              <TrashSimple size={11} />
            </button>
          </span>
        )}
      </span>
    );
  }
  return (
    <label className="sc-well" data-empty="" title="Add your logo">
      <UploadSimple size={16} />
      <input
        type="file"
        accept="image/*"
        hidden
        disabled={busy}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onUpload(files);
        }}
      />
    </label>
  );
}

function MarkChip({
  mark,
  busy,
  onRole,
  onBackground,
  onRemove,
}: {
  mark: Mark;
  busy: boolean;
  onRole: (role: string) => void;
  onBackground: (background: string) => void;
  onRemove: () => void;
}) {
  const src = mark.hash ? imgUrl(mark.hash) : mark.file;
  return (
    <span className="sc-mark" data-bg={mark.background} title={MARK_ROLE_LABEL[mark.role]}>
      <img src={src} alt={MARK_ROLE_LABEL[mark.role]} />
      <span className="sc-mark-edit">
        <select
          value={mark.role}
          disabled={busy || !mark.attachable}
          onChange={(e) => onRole(e.target.value)}
          aria-label="Mark role"
        >
          {MARK_ROLES.map((r) => (
            <option value={r} key={r}>
              {MARK_ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <select
          value={mark.background}
          disabled={busy || !mark.attachable}
          onChange={(e) => onBackground(e.target.value)}
          aria-label="Sits on"
        >
          {MARK_BACKGROUNDS.map((b) => (
            <option value={b} key={b}>
              {b === 'any' ? 'Any background' : `On ${b}`}
            </option>
          ))}
        </select>
        {mark.attachable && (
          <button type="button" disabled={busy} onClick={onRemove} aria-label={`Remove ${MARK_ROLE_LABEL[mark.role]}`}>
            <TrashSimple size={11} />
          </button>
        )}
      </span>
    </span>
  );
}
