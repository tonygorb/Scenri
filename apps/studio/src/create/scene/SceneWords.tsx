import { useEffect, useRef, useState } from 'react';
import type { SceneReading } from '../../apiTypes.js';
import { COPY } from './sceneCopy.js';
import { readingLines } from './sceneStudioRules.js';

/**
 * What a shot is told about this scene, set apart from everything else in the
 * rail, in the conversation's own read-back panel.
 *
 * These words are the scene. A shot never sees the pictures (a figure-led
 * preview aside), so this is the one place the person can see, and correct,
 * exactly what every shot made here will be given. The pencil writes over them
 * by hand; a sentence in the change line revises them and redraws.
 */
export function SceneWords({
  reading,
  coverage,
  caption,
  editable,
  onEdit,
}: {
  reading: SceneReading;
  coverage: string[];
  /** What the picture on the stage is, in a line. */
  caption: string | null;
  editable: boolean;
  onEdit: (next: SceneReading) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState(reading.prompt);
  const [lighting, setLighting] = useState(reading.lighting);
  const [camera, setCamera] = useState(reading.camera ?? '');
  const field = useRef<HTMLTextAreaElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  // New words arrive: an open editor would be writing over the old ones. Keyed
  // on what the words say, not on the object: every poll while a picture draws
  // hands back an equal reading in a new object.
  const said = JSON.stringify(reading);
  useEffect(() => {
    setEditing(false);
    setPrompt(reading.prompt);
    setLighting(reading.lighting);
    setCamera(reading.camera ?? '');
  }, [said]);
  useEffect(() => {
    if (editing) field.current?.focus();
  }, [editing]);

  const close = () => {
    setEditing(false);
    // back where the keyboard was
    requestAnimationFrame(() => opener.current?.focus());
  };

  return (
    <section className="sc-sstudio-sec" aria-labelledby="sc-sstudio-words-lb">
      <figure className="sc-convo-brief sc-sstudio-words">
        <figcaption className="sc-convo-brief-head">
          <span id="sc-sstudio-words-lb" className="sc-convo-brief-lb">
            {COPY.readingHead}
          </span>
          {editable && !editing && (
            <button ref={opener} type="button" className="sc-convo-brief-copy" onClick={() => setEditing(true)}>
              {COPY.editReading}
            </button>
          )}
        </figcaption>
        {editing ? (
          <form
            className="sc-sstudio-wordsedit"
            onSubmit={(e) => {
              e.preventDefault();
              if (!prompt.trim()) return;
              onEdit({
                ...reading,
                prompt: prompt.trim(),
                lighting: lighting.trim() || reading.lighting,
                camera: camera.trim() || undefined,
              });
              close();
            }}
          >
            <label className="sc-sstudio-field">
              <span>{COPY.placeLabel}</span>
              <textarea
                ref={field}
                className="sc-in"
                dir="auto"
                rows={5}
                maxLength={2000}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </label>
            <label className="sc-sstudio-field">
              <span>{COPY.lightLabel}</span>
              <input
                className="sc-in"
                dir="auto"
                maxLength={200}
                value={lighting}
                onChange={(e) => setLighting(e.target.value)}
              />
            </label>
            <label className="sc-sstudio-field">
              <span>{COPY.cameraLabel}</span>
              <input
                className="sc-in"
                dir="auto"
                maxLength={200}
                value={camera}
                onChange={(e) => setCamera(e.target.value)}
              />
            </label>
            <div className="sc-sstudio-row">
              <button type="submit" className="sc-btn sc-btn-primary" disabled={!prompt.trim()}>
                {COPY.saveWords}
              </button>
              <button type="button" className="sc-btn sc-btn-ghost" onClick={close}>
                {COPY.cancel}
              </button>
            </div>
          </form>
        ) : (
          <dl className="sc-sstudio-lines">
            {readingLines(reading).map((l) => (
              <div key={l.label}>
                <dt>{l.label}</dt>
                <dd dir="auto">{l.text}</dd>
              </div>
            ))}
          </dl>
        )}
        {!editing && reading.figure && <p className="sc-sstudio-hint">{COPY.figureNote}</p>}
      </figure>
      <p className="sc-sstudio-hint">{COPY.readingNote}</p>
      {caption && <p className="sc-sstudio-hint">{caption}</p>}
      {coverage.map((c) => (
        <p key={c} className="sc-sstudio-note">
          {c}
        </p>
      ))}
    </section>
  );
}
