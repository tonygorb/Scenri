import { useEffect, useState } from 'react';
import { Plus, TrashSimple, UploadSimple } from '@phosphor-icons/react';
import { api, imgUrl, uploadLogo, type Brand } from '../../api.js';
import { MARK_BACKGROUNDS, MARK_ROLES, MARK_ROLE_LABEL, marksOf, type Mark } from '../../brand/marks.js';
import { useFileDrop } from '../../layout/Dropzone.js';
import { useToasts } from '../../toasts.js';
import type { BrandDoc } from './useBrandDoc.js';
import { failureToast } from '../../failure.js';

/**
 * Who this brand is: mark, name, tagline.
 *
 * Same Settings rows as Engines and Budget — a label, a control. An earlier
 * version sat a well beside two ghost fields and read as a different product
 * dropped into the dialog. Variants used the well as the row label, so a phone
 * got a 56px square next to two selects instead of a stacked pair.
 *
 * The card is a drop target, because "drag your logo onto your brand" needs no
 * instructions. Mark actions sit in the open: hover-only chrome is unreachable
 * on a phone. A filled well is the mark, not a second upload — uploadLogo
 * appends, so tapping it would quietly add a variant.
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
      push(failureToast(e, what));
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
        <span className="txt">
          <b>Logo</b>
          <small>Drop an image, or tap to add.</small>
        </span>
        <div className="sc-set-controls">
          <MarkWell mark={primary} name={name} busy={busy} onUpload={upload} />
          {primary?.attachable && (
            <button
              type="button"
              className="sc-btn sc-btn-ghost"
              disabled={busy}
              onClick={() => void run('Could not remove that mark', () => api.deleteLogo(brand.id, primary.hash ?? ''))}
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {primary && (
        <div className="sc-set-row">
          <span className="txt">
            <b>Sits on</b>
            <small>So a dark mark is not shown on a dark ground.</small>
          </span>
          <select
            className="sc-in"
            value={primary.background}
            disabled={busy || !primary.attachable}
            onChange={(e) =>
              void run('Could not update that mark', () =>
                api.updateLogo(brand.id, primary.hash ?? '', { background: e.target.value }),
              )
            }
            aria-label="Sits on"
          >
            {MARK_BACKGROUNDS.map((b) => (
              <option value={b} key={b}>
                {b === 'any' ? 'Any background' : `On ${b}`}
              </option>
            ))}
          </select>
        </div>
      )}

      <KitField
        label="Name"
        value={meta.name ?? ''}
        placeholder={brand.slug}
        maxLength={120}
        onCommit={(next) => writeMeta({ name: next })}
      />
      <KitField
        label="Tagline"
        value={meta.tagline ?? ''}
        placeholder="Add a tagline"
        maxLength={200}
        onCommit={(next) => writeMeta({ tagline: next })}
      />

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

      {primary && (
        <div className="sc-set-row">
          <span className="txt">
            <b>Variant</b>
            <small>A second mark for dark or light grounds.</small>
          </span>
          <label className="sc-btn sc-btn-ghost">
            <Plus size={12} />
            Add
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

function KitField({
  label,
  value,
  placeholder,
  maxLength,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  maxLength?: number;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div className="sc-set-row">
      <span className="txt">
        <b>{label}</b>
      </span>
      <input
        className="sc-in"
        value={draft}
        placeholder={placeholder}
        aria-label={label}
        maxLength={maxLength}
        dir="auto"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const next = draft.trim();
          if (next !== value) onCommit(next);
          setDraft(next);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft(value);
            e.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

function MarkWell({
  mark,
  name,
  busy,
  onUpload,
}: {
  mark?: Mark;
  name: string;
  busy: boolean;
  onUpload: (files: File[]) => void;
}) {
  if (mark) {
    const src = mark.hash ? imgUrl(mark.hash) : mark.file;
    return (
      <span className="sc-well" data-bg={mark.background}>
        <img src={src} alt={`${name} logo`} />
      </span>
    );
  }
  return (
    <label className="sc-well" data-empty="" aria-label="Add logo">
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
    <div className="sc-set-row">
      <span className="txt">
        <b>{MARK_ROLE_LABEL[mark.role]}</b>
      </span>
      <div className="sc-set-controls">
        <span className="sc-well" data-bg={mark.background}>
          <img src={src} alt={MARK_ROLE_LABEL[mark.role]} />
        </span>
        <select
          className="sc-in"
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
          className="sc-in"
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
            <TrashSimple size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
