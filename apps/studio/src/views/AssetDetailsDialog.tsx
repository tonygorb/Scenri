import { useState } from 'react';
import { DropdownMenu } from '@radix-ui/themes';
import { Plus, X } from '@phosphor-icons/react';
import type { SceneSetup } from '../api.js';
import { ChipPicker } from '../layout/ChipPicker.js';
import { DialogSheet, SheetClose, SheetTitle } from '../layout/DialogSheet.js';

/**
 * The words on an asset's record, changed in one place: a presenter's, a
 * scene's. Two things, and only the two that are actually yours: what it is
 * called, and what you file it under.
 *
 * The caption under their name is not here, and was briefly. Creation never
 * asks for it: the analyser writes it from the face it drew or the
 * photographs it read, and it is then used as a label wherever the person
 * appears. Offering it as a list to curate asked for work nobody signed up
 * for and implied it was the reader's sentence to write. If it is wrong, the
 * person is what to change, and it is rewritten with them.
 *
 * Not to be confused with Edit presenter or Edit scene, which open the studio
 * and change what it looks like. Nothing here touches a picture.
 */
export function AssetDetailsDialog({
  name,
  categories,
  known,
  hint,
  ways,
  wayChoices,
  wayMax,
  busy,
  error,
  onSave,
  onDismiss,
}: {
  name: string;
  categories: string[];
  /** Every category this brand already files this kind under. */
  known: string[];
  /** What filing it does, in the kind's own words. */
  hint: string;
  /**
   * A scene's ways to shoot it, if this record has them. They are words about
   * where a camera stands, so they are written here beside the name rather
   * than in the studio, which is where pictures are drawn.
   */
  ways?: readonly SceneSetup[];
  /** Every way this kind knows how to add; the ones already taken are hidden. */
  wayChoices?: readonly SceneSetup[];
  /** How many a record may hold, after which nothing more is offered. */
  wayMax?: number;
  busy?: boolean;
  error?: string | null;
  onSave: (next: { name: string; categories: string[]; ways?: SceneSetup[] }) => void;
  onDismiss: () => void;
}) {
  const [draftName, setName] = useState(name);
  const [draftCategories, setCategories] = useState(categories);
  const [draftWays, setWays] = useState<SceneSetup[]>(() => [...(ways ?? [])]);

  const trimmed = draftName.trim();
  // A name is theirs to choose, so anything with a character in it stands.
  const ready = trimmed.length > 0;
  const key = (list: readonly SceneSetup[]) => list.map((w) => w.id).join(' ');
  const changed =
    trimmed !== name.trim() ||
    draftCategories.join(' ') !== categories.join(' ') ||
    (!!ways && key(draftWays) !== key(ways));
  const left =
    draftWays.length >= (wayMax ?? Number.POSITIVE_INFINITY)
      ? []
      : (wayChoices ?? []).filter((c) => !draftWays.some((w) => w.id === c.id));

  const submit = () => {
    if (!ready || busy) return;
    if (!changed) return onDismiss();
    onSave({ name: trimmed, categories: draftCategories, ...(ways ? { ways: draftWays } : {}) });
  };

  return (
    <DialogSheet className="sc-newdlg sc-pdetails" maxWidth="min(460px, 94vw)" onDismiss={onDismiss}>
      <div className="sc-newdlg-head">
        <SheetTitle className="sc-newdlg-title">Details</SheetTitle>
        <SheetClose asChild>
          <button type="button" className="sc-set-close sc-newdlg-close" aria-label="Close">
            <span aria-hidden>{'×'}</span>
          </button>
        </SheetClose>
      </div>

      <div className="sc-newdlg-body">
        <label className="sc-pdetails-row">
          <span className="sc-pdetails-lb">Name</span>
          <input
            className="sc-pdetails-field"
            value={draftName}
            dir="auto"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </label>

        <div className="sc-pdetails-row">
          <span className="sc-pdetails-lb">Categories</span>
          <ChipPicker
            value={draftCategories}
            onChange={setCategories}
            options={known}
            label="Categories"
            placeholder="Any"
            findPlaceholder="Find or add a category"
            emptyNote="Nothing by that name."
            maxLength={30}
          />
          <span className="sc-pdetails-hint">{hint}</span>
        </div>

        {/* Ways to shoot it. Only a scene has them, and only here: on the page
            they are how the Use button is pressed, which is no place to write
            a list or take one away. */}
        {ways && (
          <div className="sc-pdetails-row">
            <span className="sc-pdetails-lb">Ways to shoot it</span>
            <div className="sc-pdetails-ways">
              {draftWays.map((w) => (
                <div key={w.id} className="sc-pdetails-way">
                  <span className="sc-pdetails-way-lb">{w.label}</span>
                  <span className="sc-pdetails-way-sub">{w.camera}</span>
                  <button
                    type="button"
                    className="sc-icon-btn"
                    aria-label={`Remove ${w.label}`}
                    onClick={() => setWays(draftWays.filter((d) => d.id !== w.id))}
                  >
                    <X size={13} weight="bold" aria-hidden />
                  </button>
                </div>
              ))}
              {left.length > 0 && (
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger>
                    <button type="button" className="sc-btn sc-btn-ghost" aria-label="Add a way to shoot it">
                      <Plus size={12} weight="bold" aria-hidden />
                      <span>Add a way</span>
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content>
                    {left.map((c) => (
                      <DropdownMenu.Item key={c.id} onSelect={() => setWays([...draftWays, c])}>
                        {c.label}
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              )}
            </div>
            <span className="sc-pdetails-hint">
              A way moves the camera and leaves the world alone.
              {wayMax ? ` ${wayMax} at most.` : ''}
            </span>
          </div>
        )}

        {error && <p className="sc-assetform-err">{error}</p>}
      </div>

      <div className="sc-newdlg-foot">
        <button type="button" className="sc-btn sc-btn-ghost" onClick={onDismiss}>
          Cancel
        </button>
        <button
          type="button"
          className="sc-btn sc-btn-primary"
          disabled={!ready}
          data-busy={busy || undefined}
          onClick={submit}
        >
          {busy ? 'Saving' : 'Save'}
        </button>
      </div>
    </DialogSheet>
  );
}
