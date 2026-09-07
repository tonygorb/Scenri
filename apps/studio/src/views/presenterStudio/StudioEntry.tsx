import { Images, UserFocus } from '@phosphor-icons/react';
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api, type AssetBuildCapabilities, type PresenterDraft, uploadImage } from '../../api.js';
import { RefStrip } from '../../create/RefStrip.js';
import { presenterDraftPath } from '../../routes.js';
import { agoLabel } from '../../tasks.js';

/** Four is the working ceiling: past that a photo adds nothing an engine reads. */
const MAX_PHOTOS = 4;

type Mode = 'scratch' | 'photos';

/**
 * How the person starts: from a sentence, or from photographs.
 *
 * Two doors, in the chooser's own card shape so this reads as the next room
 * of the same house, and one field behind each. A door is one press; the
 * field replaces the doors rather than opening under them, so the screen
 * holds one question at a time. The name comes later, once there is someone
 * to name.
 */
export function StudioEntry({
  brand,
  caps,
  capsNote,
  pictures,
  onCreated,
}: {
  brand: { id: string; slug: string };
  caps: AssetBuildCapabilities | null;
  capsNote: (whenKnown: string) => ReactNode;
  /** What each door shows: a face Scenri drew, a photograph of a person. Null falls back to the glyph. */
  pictures: { scratch: string | null; photos: string | null };
  onCreated: (draft: PresenterDraft) => void;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [direction, setDirection] = useState('');
  const [hashes, setHashes] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<PresenterDraft[]>([]);
  const directionRef = useRef<HTMLTextAreaElement>(null);

  // A draft left open earlier is offered back, quietly, above the doors.
  useEffect(() => {
    let alive = true;
    void api
      .presenterDrafts(brand.id)
      .then((r) => alive && setOpen(r.drafts))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [brand.id]);

  // The sentence takes the keyboard the moment its door opens.
  useEffect(() => {
    if (mode === 'scratch') directionRef.current?.focus();
  }, [mode]);

  const canDraw = caps?.canGenerate ?? false;

  const addFiles = useCallback(
    async (files: File[]) => {
      setErr(null);
      setUploading(true);
      try {
        for (const f of files.slice(0, Math.max(0, MAX_PHOTOS - hashes.length))) {
          const h = await uploadImage(f);
          setHashes((cur) => (cur.includes(h) || cur.length >= MAX_PHOTOS ? cur : [...cur, h]));
        }
      } catch (e: any) {
        setErr(String(e?.message ?? e));
      } finally {
        setUploading(false);
      }
    },
    [hashes.length],
  );

  const ready = mode === 'scratch' ? direction.trim().length > 0 && canDraw : hashes.length > 0 && attested;
  const blocked =
    mode === 'scratch'
      ? canDraw
        ? 'Describe who they are'
        : 'Needs an engine that reads reference images'
      : hashes.length === 0
        ? 'Add at least one photo'
        : 'Confirm you have permission to use their likeness';

  const create = async () => {
    if (!mode || !ready || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const draft = await api.createPresenterDraft(brand.id, {
        source: mode === 'scratch' ? 'synthetic' : 'photos',
        direction: mode === 'scratch' ? direction.trim() : undefined,
        imageHashes: mode === 'photos' ? hashes : undefined,
        attestation: mode === 'photos' ? attested : undefined,
      });
      onCreated(draft);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
      setBusy(false);
    }
  };
  const submitOnEnter = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    void create();
  };

  return (
    <div className="sc-studio-entry">
      <h1>Create your presenter</h1>
      <p className="sc-lookpage-lede">One person, the same in every image you make.</p>

      {!mode && open.length > 0 && (
        <p className="sc-studio-resume">
          {open.slice(0, 2).map((d) => (
            <Link key={d.id} to={presenterDraftPath(brand, d.id)}>
              Continue{' '}
              {d.name.trim() ? d.name : d.source === 'synthetic' ? 'the person you described' : 'from your photos'}
              <small> {agoLabel(d.updatedAt)}</small>
            </Link>
          ))}
        </p>
      )}

      {!mode && (
        <div className="sc-pickgrid sc-studio-doors">
          <button
            type="button"
            className="sc-pick"
            data-kind="scratch"
            aria-disabled={caps && !canDraw ? 'true' : undefined}
            aria-label="Start from scratch. Describe who they are; Scenri draws them."
            onClick={() => setMode('scratch')}
          >
            <span className="sc-pick-media">
              {pictures.scratch ? (
                <img src={pictures.scratch} alt="" loading="lazy" />
              ) : (
                <span className="sc-pick-blank">
                  <UserFocus size={22} />
                </span>
              )}
            </span>
            <span className="sc-pick-cap">
              <b>Start from scratch</b>
              <small>Describe who they are. Scenri draws them.</small>
            </span>
          </button>
          <button
            type="button"
            className="sc-pick"
            data-kind="photos"
            aria-label="Use photos. A real person you have permission to use."
            onClick={() => setMode('photos')}
          >
            <span className="sc-pick-media">
              {pictures.photos ? (
                <img src={pictures.photos} alt="" loading="lazy" />
              ) : (
                <span className="sc-pick-blank">
                  <Images size={22} />
                </span>
              )}
            </span>
            <span className="sc-pick-cap">
              <b>Use photos</b>
              <small>A real person you have permission to use.</small>
            </span>
          </button>
        </div>
      )}

      {mode === 'scratch' && (
        <div className="sc-studio-field">
          <label className="sc-newdlg-seclabel" htmlFor="sc-studio-direction">
            Who are they
          </label>
          <textarea
            id="sc-studio-direction"
            ref={directionRef}
            className="sc-in"
            rows={2}
            maxLength={400}
            placeholder="Confident woman in her 40s, short silver hair, editorial but approachable"
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            onKeyDown={submitOnEnter}
          />
          {caps && !canDraw && (
            <p className="sc-studio-note">
              Drawing a person needs Codex, or an engine that reads reference images. You can still use photos.
            </p>
          )}
        </div>
      )}

      {mode === 'photos' && (
        <div className="sc-studio-field">
          <RefStrip
            hashes={hashes}
            max={MAX_PHOTOS}
            label="Add photos"
            hint="One works. Two to four, from different angles, hold the likeness better."
            busy={uploading}
            onAdd={(files) => void addFiles(files)}
            onRemove={(h) => setHashes((cur) => cur.filter((x) => x !== h))}
            onReject={() => setErr('Drop an image file.')}
          />
          <label className="sc-studio-consent">
            <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
            <span>
              I confirm this is a real person who is 18 or older and has given me permission to use their likeness in
              commercial images, and that I am responsible for that permission.
            </span>
          </label>
        </div>
      )}

      {mode && (
        <div className="sc-studio-actions">
          <button
            type="button"
            className="sc-btn sc-btn-primary"
            aria-disabled={!ready ? 'true' : undefined}
            title={ready ? undefined : blocked}
            disabled={busy}
            onClick={() => void create()}
          >
            {mode === 'scratch' ? 'Create' : 'Continue'}
          </button>
          <button type="button" className="sc-btn sc-btn-ghost" disabled={busy} onClick={() => setMode(null)}>
            Back
          </button>
          {err && <span className="sc-studio-blocker">{err}</span>}
        </div>
      )}

      <p className="sc-studio-foot">
        {capsNote(
          canDraw
            ? caps?.free
              ? 'Three views, one at a time. Nothing billed through Scenri.'
              : 'Three views, one at a time, each a generation.'
            : 'Saved from the photos you add.',
        )}
      </p>
    </div>
  );
}
