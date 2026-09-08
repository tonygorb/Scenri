import { Check, Image, Plus, TextAa, X } from '@phosphor-icons/react';
import { type KeyboardEvent, type ReactNode, useEffect, useRef } from 'react';
import { thumbUrl } from '../../api.js';
import { CategoryMenu } from './CategoryMenu.js';
import { useFileDrop } from '../../layout/Dropzone.js';
import { OpenAIMark } from '../../layout/OpenAIMark.js';
import { MAX_PHOTOS, photosHint } from './presenterStudioRules.js';

/**
 * The setup rail, as the Figma frames lay it out: the Aa / Image toggle in
 * the head, then Name, Gender, the sentence or the four photo places,
 * Optional notes and Categories, with Cancel and Create presenter in the
 * foot. Name and gender are offered, never required: a person can be cast
 * from the sentence alone and named at the end.
 */
export type Mode = 'scratch' | 'photos';
export type Gender = 'woman' | 'man';

const MODES: { value: Mode; label: string; icon: ReactNode }[] = [
  { value: 'scratch', label: 'From scratch', icon: <TextAa size={18} /> },
  { value: 'photos', label: 'From photos', icon: <Image size={18} /> },
];

/** The two ways to start, as the frame's icon toggle: a tab list of two, arrows move between them. */
export function ModeToggle({ mode, onMode }: { mode: Mode; onMode: (next: Mode) => void }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el?.contains(document.activeElement)) return;
    el.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  }, [mode]);
  return (
    <div
      ref={root}
      className="sc-pstudio-toggle"
      role="tablist"
      aria-label="How to start"
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        onMode(mode === 'scratch' ? 'photos' : 'scratch');
      }}
    >
      {MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          role="tab"
          aria-selected={mode === m.value}
          aria-label={m.label}
          title={m.label}
          tabIndex={mode === m.value ? 0 : -1}
          onClick={() => onMode(m.value)}
        >
          {m.icon}
        </button>
      ))}
    </div>
  );
}

/** Nothing here can draw a person: the same card the composer shows, and the same door out of it. */
export function SetupCard({ onSetup }: { onSetup: () => void }) {
  return (
    <div className="sc-pstudio-card">
      <OpenAIMark />
      <b>Image generation is not set up yet</b>
      <p>
        About a minute, using the ChatGPT account you already have. A person from a description needs it; photos do not.
      </p>
      <button type="button" className="sc-btn sc-btn-primary" onClick={onSetup}>
        Set up
      </button>
    </div>
  );
}

function Field({ id, label, children }: { id?: string; label: string; children: ReactNode }) {
  return (
    <div className="sc-pstudio-field">
      {id ? (
        <label className="sc-newdlg-seclabel" htmlFor={id}>
          {label}
        </label>
      ) : (
        <span className="sc-newdlg-seclabel">{label}</span>
      )}
      {children}
    </div>
  );
}

/** The two mannequins the frames use, in `public/presenter/`: a form, never a face. */
const GENDERS: { value: Gender; label: string; src: string }[] = [
  { value: 'man', label: 'Male', src: '/presenter/male.webp' },
  { value: 'woman', label: 'Female', src: '/presenter/female.webp' },
];

/** Two cards, either or neither, wearing the same ring the upload slots wear. */
function GenderCards({ value, onChange }: { value: Gender | null; onChange: (next: Gender | null) => void }) {
  return (
    <fieldset className="sc-pstudio-field sc-pstudio-fieldset">
      <legend className="sc-newdlg-seclabel">Gender</legend>
      <div className="sc-pstudio-gender">
        {GENDERS.map((g) => (
          <button
            key={g.value}
            type="button"
            className="sc-pstudio-gcard"
            aria-pressed={value === g.value}
            onClick={() => onChange(value === g.value ? null : g.value)}
          >
            <span className="sc-pstudio-gcard-frame">
              <span className="sc-pstudio-gcard-inner">
                <img src={g.src} alt="" decoding="async" />
                {value === g.value && (
                  <span className="sc-pstudio-slot-mark" aria-hidden>
                    <Check size={11} weight="bold" />
                  </span>
                )}
              </span>
            </span>
            <span className="sc-pstudio-gcard-lb">{g.label}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** The four places, named as the frame names them. A hint, not a requirement: one photo is enough. */
const SLOT_HINTS = ['Front', 'Left', 'Back', 'Right'];

/**
 * Four places for one to four photographs: a slot is a drop target and a
 * picker; a filled one shows the photo with a mark and a way to take it out
 * again. One hidden file input serves every slot, so picking several at once
 * fills the next free places.
 */
function PhotoSlots({
  hashes,
  uploading,
  onAdd,
  onRemove,
  onReject,
}: {
  hashes: string[];
  uploading: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (hash: string) => void;
  onReject: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const { dropProps } = useFileDrop({ onFiles: onAdd, onReject, disabled: uploading || hashes.length >= MAX_PHOTOS });
  return (
    <div className="sc-pstudio-slots" {...dropProps}>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onAdd(files);
        }}
      />
      {SLOT_HINTS.map((hint, i) => {
        const hash = hashes[i];
        return (
          <div key={hint} className="sc-pstudio-pslot">
            {hash ? (
              <div className="sc-pstudio-pslot-frame" data-filled>
                <span className="sc-pstudio-pslot-inner">
                  <img src={thumbUrl(hash, 'small')} alt={`Yours, ${i + 1} of ${hashes.length}`} />
                  <span className="sc-pstudio-slot-mark" aria-hidden>
                    <Check size={11} weight="bold" />
                  </span>
                </span>
                <button
                  type="button"
                  className="sc-pstudio-pslot-drop"
                  aria-label={`Remove the ${hint.toLowerCase()} photo`}
                  onClick={() => onRemove(hash)}
                >
                  <X size={11} weight="bold" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="sc-pstudio-pslot-frame"
                aria-label={i === hashes.length ? `Add a photo, ${hint.toLowerCase()}` : `${hint}, add photos in order`}
                disabled={uploading || i !== hashes.length}
                onClick={() => input.current?.click()}
              >
                <span className="sc-pstudio-pslot-inner">
                  <span className="sc-pstudio-pslot-plus">
                    <span>
                      <Plus size={17} />
                    </span>
                  </span>
                </span>
              </button>
            )}
            <span className="sc-pstudio-pslot-lb" aria-hidden>
              {hint}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The categories a presenter is cast for: one line, and a menu behind it.
 *
 * The engine names these itself, off the photographs or off the portrait it
 * drew, and what is chosen here only overrides that. So this is the quietest
 * field in the rail, never a wall of toggles.
 */
export function CategoriesField({
  categories,
  facets,
  onFacets,
}: {
  categories: string[];
  facets: string[];
  onFacets: (next: string[]) => void;
}) {
  return (
    <Field label="Categories">
      <CategoryMenu value={facets} categories={categories} onChange={onFacets} />
    </Field>
  );
}

/** The whole setup form; the head's toggle decides whether the middle is a sentence or photographs. */
export function SetupForm({
  mode,
  canDraw,
  engineOff,
  name,
  onName,
  gender,
  onGender,
  direction,
  onDirection,
  onCreate,
  hashes,
  uploading,
  attested,
  onAdd,
  onRemove,
  onReject,
  onAttested,
  notes,
  onNotes,
  facets,
  onFacets,
  categories,
  onSetup,
  error,
}: {
  mode: Mode;
  canDraw: boolean;
  engineOff: boolean;
  name: string;
  onName: (next: string) => void;
  gender: Gender | null;
  onGender: (next: Gender | null) => void;
  direction: string;
  onDirection: (next: string) => void;
  onCreate: () => void;
  hashes: string[];
  uploading: boolean;
  attested: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (hash: string) => void;
  onReject: () => void;
  onAttested: (on: boolean) => void;
  notes: string;
  onNotes: (next: string) => void;
  facets: string[];
  onFacets: (next: string[]) => void;
  categories: string[];
  onSetup: () => void;
  error?: string | null;
}) {
  const enterCreates = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    onCreate();
  };
  return (
    <div className="sc-pstudio-form">
      <Field id="sc-pstudio-name" label="Name">
        <input
          id="sc-pstudio-name"
          className="sc-in"
          type="text"
          maxLength={60}
          placeholder="Their name"
          value={name}
          onChange={(e) => onName(e.target.value)}
          onKeyDown={enterCreates}
        />
      </Field>
      <GenderCards value={gender} onChange={onGender} />
      {mode === 'scratch' ? (
        engineOff ? (
          <SetupCard onSetup={onSetup} />
        ) : (
          <Field id="sc-pstudio-direction" label="Describe the presenter">
            <textarea
              id="sc-pstudio-direction"
              className="sc-in sc-pstudio-direction"
              rows={4}
              maxLength={400}
              placeholder="Natural-looking woman in her late 20s, slim build, long straight brown hair, calm expression"
              value={direction}
              onChange={(e) => onDirection(e.target.value)}
              onKeyDown={enterCreates}
            />
          </Field>
        )
      ) : (
        <div className="sc-pstudio-field sc-pstudio-photos">
          <span className="sc-newdlg-seclabel">Your presenter</span>
          <PhotoSlots hashes={hashes} uploading={uploading} onAdd={onAdd} onRemove={onRemove} onReject={onReject} />
          <p className="sc-pstudio-line">{photosHint(hashes.length)}</p>
          {!canDraw && (
            <p className="sc-pstudio-line">
              No engine here can draw the other views. The photos are saved as they are.
            </p>
          )}
          <label className="sc-pstudio-consent">
            <input type="checkbox" checked={attested} onChange={(e) => onAttested(e.target.checked)} />
            <span>
              I confirm this is a real person who is 18 or older and has given me permission to use their likeness in
              commercial images, and that I am responsible for that permission.
            </span>
          </label>
        </div>
      )}
      <Field id="sc-pstudio-notes" label="Optional notes">
        <input
          id="sc-pstudio-notes"
          className="sc-in"
          type="text"
          maxLength={400}
          placeholder="Anything worth knowing about them"
          value={notes}
          onChange={(e) => onNotes(e.target.value)}
          onKeyDown={enterCreates}
        />
      </Field>
      <CategoriesField categories={categories} facets={facets} onFacets={onFacets} />
      {error && (
        <p className="sc-newdlg-err" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** The words that belong to a presenter, behind Change once the person exists. */
export function DetailsFields({
  name,
  onName,
  facets,
  onFacets,
  notes,
  onNotes,
  categories,
  onEnter,
}: {
  name: string;
  onName: (next: string) => void;
  facets: string[];
  onFacets: (next: string[]) => void;
  notes: string;
  onNotes: (next: string) => void;
  categories: string[];
  onEnter: () => void;
}) {
  return (
    <div id="sc-pstudio-details" className="sc-pstudio-details">
      <Field id="sc-pstudio-name" label="Name">
        <input
          id="sc-pstudio-name"
          className="sc-in"
          type="text"
          maxLength={60}
          placeholder="Their name"
          value={name}
          onChange={(e) => onName(e.target.value)}
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            onEnter();
          }}
        />
      </Field>
      <Field id="sc-pstudio-notes" label="Notes">
        <textarea
          id="sc-pstudio-notes"
          className="sc-in"
          rows={2}
          maxLength={400}
          placeholder="Anything worth knowing about them"
          value={notes}
          onChange={(e) => onNotes(e.target.value)}
        />
      </Field>
      <CategoriesField categories={categories} facets={facets} onFacets={onFacets} />
    </div>
  );
}
