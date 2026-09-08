import { Check, Image as ImageIcon, Plus, TextAa, X } from '@phosphor-icons/react';
import { type KeyboardEvent, type ReactNode, useRef } from 'react';
import { thumbUrl } from '../../api.js';
import { Choice, Choices } from '../../composer/shotSettings/Choices.js';
import { CategoryMenu } from './CategoryMenu.js';
import { useFileDrop } from '../../layout/Dropzone.js';
import { OpenAIMark } from '../../layout/OpenAIMark.js';
import {
  type Age,
  MAX_PHOTOS,
  photosHint,
  type Steer,
  type Tone,
  type Traits,
  whoHint,
} from './presenterStudioRules.js';

/**
 * The setup rail: two ways to start as tabs, then the three things a roll
 * cannot guess and the sentence that
 * carries the rest, or the four photo places, with Cancel and Create
 * presenter in the foot. The name is asked in review, where saving needs it.
 */
export type Mode = 'scratch' | 'photos';

/**
 * The two ways to start, as a segmented control.
 *
 * This is not navigation between two views of the same thing, which is what a
 * tab strip means: it is a choice of what the person will be made from, and
 * it changes the form under it. A two-up switch says that, says it at the
 * size of the fields it governs, and keeps the words that two icons could
 * only imply.
 */
export function ModeSwitch({ mode, onMode }: { mode: Mode; onMode: (next: Mode) => void }) {
  return (
    <Choices
      label="How to start"
      className="sc-seg sc-pstudio-modes"
      value={mode}
      ids={['scratch', 'photos']}
      onChange={(id) => onMode(id as Mode)}
    >
      <Choice
        id="scratch"
        className="sc-seg-o"
        on={mode === 'scratch'}
        label="From scratch"
        onPick={() => onMode('scratch')}
      >
        <TextAa size={17} />
        From scratch
      </Choice>
      <Choice
        id="photos"
        className="sc-seg-o"
        on={mode === 'photos'}
        label="From photos"
        onPick={() => onMode('photos')}
      >
        <ImageIcon size={17} />
        From photos
      </Choice>
    </Choices>
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

/**
 * A labelled field. The label row takes a second slot on the right for the
 * value that is set, which is where a person looks for it: beside the name of
 * the thing, not trailing the control that sets it.
 */
function Field({ id, label, value, children }: { id?: string; label: string; value?: string; children: ReactNode }) {
  return (
    <div className="sc-pstudio-field">
      <div className="sc-pstudio-fieldhead">
        {id ? (
          <label className="sc-newdlg-seclabel" htmlFor={id}>
            {label}
          </label>
        ) : (
          <span className="sc-newdlg-seclabel">{label}</span>
        )}
        {value && <span className="sc-pstudio-fieldval">{value}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * The three things a roll cannot guess, one row each.
 *
 * Nothing is chosen until it is chosen, and pressing the chosen one puts the
 * question back to the sentence. Every setting says something to the engine:
 * there is no neutral option that quietly does nothing.
 */
const STEERS: { id: Steer; label: string; src: string }[] = [
  { id: 'woman', label: 'Woman', src: '/presenter/who-woman.webp' },
  { id: 'man', label: 'Man', src: '/presenter/who-man.webp' },
  { id: 'androgynous', label: 'Androgynous', src: '/presenter/who-androgynous.webp' },
];
const AGES: { id: Age; label: string }[] = [
  { id: '20s', label: '20s' },
  { id: '30s', label: '30s' },
  { id: '40s', label: '40s' },
  { id: '50s', label: '50s' },
  { id: '60+', label: '60+' },
];
/** The swatch is the label: a word for skin means little, a colour means it at a glance. */
const TONES: { id: Tone; label: string; hex: string }[] = [
  { id: 'fair', label: 'Fair', hex: '#f3ddcd' },
  { id: 'light', label: 'Light', hex: '#e6c0a2' },
  { id: 'olive', label: 'Olive', hex: '#c99b6e' },
  { id: 'brown', label: 'Brown', hex: '#96603a' },
  { id: 'deep', label: 'Deep', hex: '#5a3825' },
];

/** Who they are, as three cards: a form, never a face, so a card is a kind and not a casting. */
function WhoRow({ value, onChange }: { value: Steer | null; onChange: (next: Steer | null) => void }) {
  return (
    <Field label="Who they are">
      <Choices
        label="Who they are"
        className="sc-pstudio-whorow"
        value={value ?? ''}
        ids={STEERS.map((o) => o.id)}
        onChange={(id) => onChange(id as Steer)}
      >
        {STEERS.map((o) => (
          <Choice
            key={o.id}
            id={o.id}
            className="sc-pstudio-whocard"
            on={value === o.id}
            label={o.label}
            onPick={() => onChange(value === o.id ? null : o.id)}
          >
            <span className="sc-pstudio-whocard-frame">
              <span className="sc-pstudio-whocard-inner">
                <img src={o.src} alt="" decoding="async" />
                {value === o.id && (
                  <span className="sc-pstudio-slot-mark" aria-hidden>
                    <Check size={11} weight="bold" />
                  </span>
                )}
              </span>
            </span>
            <span className="sc-pstudio-whocard-lb">{o.label}</span>
          </Choice>
        ))}
      </Choices>
    </Field>
  );
}

/** Skin, as the thing itself: five swatches, the word under the chosen one. */
function SkinRow({ value, onChange }: { value: Tone | null; onChange: (next: Tone | null) => void }) {
  const chosen = TONES.find((t) => t.id === value);
  return (
    <Field label="Skin" value={chosen?.label}>
      <div className="sc-pstudio-skin">
        <Choices
          label="Skin"
          className="sc-pstudio-swatches"
          value={value ?? ''}
          ids={TONES.map((o) => o.id)}
          onChange={(id) => onChange(id as Tone)}
        >
          {TONES.map((o) => (
            <Choice
              key={o.id}
              id={o.id}
              className="sc-pstudio-swatch"
              on={value === o.id}
              label={o.label}
              onPick={() => onChange(value === o.id ? null : o.id)}
            >
              <span style={{ background: o.hex }} aria-hidden />
            </Choice>
          ))}
        </Choices>
      </div>
    </Field>
  );
}

/**
 * Age, as the app's own chips.
 *
 * Five ordered buckets are a small set to choose from, not a track of modes
 * and not a continuum worth a slider: a segmented control at five cells reads
 * as five tabs, and a slider for five stops is harder to hit than a chip.
 */
function AgeRow({ value, onChange }: { value: Age | null; onChange: (next: Age | null) => void }) {
  return (
    <Field label="Age" value={value ? AGES.find((a) => a.id === value)?.label : undefined}>
      <Choices
        label="Age"
        className="sc-pstudio-chips"
        value={value ?? ''}
        ids={AGES.map((o) => o.id)}
        onChange={(id) => onChange(id as Age)}
      >
        {AGES.map((o) => (
          <Choice
            key={o.id}
            id={o.id}
            className="sc-chip"
            on={value === o.id}
            label={o.label}
            onPick={() => onChange(value === o.id ? null : o.id)}
          >
            {o.label}
          </Choice>
        ))}
      </Choices>
    </Field>
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
 * What the person is filed under, asked once they exist.
 *
 * The engine reads this off the photographs or off the portrait it drew, and
 * `savePresenterDraft` keeps that reading unless the user has an opinion. So
 * this is never an empty question in a form: it appears with the answer
 * already in it, and what happens here is a correction.
 */
export function FiledUnderField({
  categories,
  facets,
  onFacets,
}: {
  categories: string[];
  facets: string[];
  onFacets: (next: string[]) => void;
}) {
  return (
    <Field label="Filed under">
      <CategoryMenu value={facets} categories={categories} onChange={onFacets} placeholder="Nothing yet" />
    </Field>
  );
}

/**
 * The whole setup form.
 *
 * Four inputs, and every one of them changes the person who is drawn: who
 * they are, roughly their age, their skin, and the sentence that carries
 * everything an open vocabulary should carry. The name is asked in review,
 * where saving needs it, and the categories are the engine's to read. The
 * head's tabs decide whether the middle is a sentence or photographs.
 */
export function SetupForm({
  mode,
  canDraw,
  engineOff,
  traits,
  onTraits,
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
  onSetup,
  error,
}: {
  mode: Mode;
  canDraw: boolean;
  engineOff: boolean;
  traits: Traits;
  /** A patch, never the whole object: two rows changed in one tick must not clobber each other. */
  onTraits: (patch: Partial<Traits>) => void;
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
  onSetup: () => void;
  error?: string | null;
}) {
  const enterCreates = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    onCreate();
  };
  const hint = whoHint(traits, direction);
  return (
    <div className="sc-pstudio-form">
      {mode === 'scratch' ? (
        engineOff ? (
          <SetupCard onSetup={onSetup} />
        ) : (
          <>
            <WhoRow value={traits.steer} onChange={(steer) => onTraits({ steer })} />
            <AgeRow value={traits.age} onChange={(age) => onTraits({ age })} />
            <SkinRow value={traits.tone} onChange={(tone) => onTraits({ tone })} />
            <Field id="sc-pstudio-direction" label="Describe the presenter">
              <textarea
                id="sc-pstudio-direction"
                className="sc-in sc-pstudio-direction"
                rows={4}
                maxLength={400}
                placeholder="Natural-looking, slim build, long straight brown hair, calm expression"
                value={direction}
                onChange={(e) => onDirection(e.target.value)}
                onKeyDown={enterCreates}
              />
              {hint && <p className="sc-pstudio-line">{hint}</p>}
            </Field>
          </>
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
  categories,
  onEnter,
}: {
  name: string;
  onName: (next: string) => void;
  facets: string[];
  onFacets: (next: string[]) => void;
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
      <FiledUnderField categories={categories} facets={facets} onFacets={onFacets} />
    </div>
  );
}
