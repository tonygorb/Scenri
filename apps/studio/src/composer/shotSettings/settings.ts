import { FORMATS } from '../formats.js';
import { supportsFormat } from '../../engines/capabilities.js';

/**
 * The stored id stays `quality` — it is a persisted pref key and a field on
 * every brief ever written, and renaming it to match a label would reset the
 * setting for everyone who has one. What the user reads is Resolution, because
 * the long edge in pixels is the only thing this changes: not the model, not
 * the effort, not the time, and not the cost.
 */
export type QualityId = 'draft' | 'standard' | 'high';

export const RESOLUTIONS: { id: QualityId; label: string; edge: number; note: string }[] = [
  { id: 'draft', label: 'Draft', edge: 768, note: 'quick checks' },
  { id: 'standard', label: 'Standard', edge: 1024, note: 'everyday shots' },
  { id: 'high', label: 'High', edge: 1536, note: 'hero and print' },
];

/**
 * How many images one brief may return. The server clamps at eight; four is as
 * many as this can offer before a choice becomes a form.
 */
export const VARIANTS = [1, 2, 3, 4];

/** What every surface calls each setting, so no two spell it differently. */
export type ShotSettingsProps = {
  mode: 'generation' | 'edit';
  /**
   * The engine that will run this brief. Two of them cannot do everything the
   * settings offer, and a control is better dimmed before the send than
   * explained after the failure.
   */
  engineId: string;
  engineName: string;
  formatId: string;
  onFormat: (id: string) => void;
  count: number;
  onCount: (n: number) => void;
  quality: QualityId;
  onQuality: (q: QualityId) => void;
};

/** Which formats this engine refuses, as ids. */
export const blockedFormats = (engineId: string) => FORMATS.filter((f) => !supportsFormat(engineId, f.id)).map((f) => f.id);

/**
 * The two sentences an engine's limits are worth saying, written once. Three
 * shells show these and they must not word the same fact three ways.
 */
export const shapeNote = (engineName: string, blocked: string[]) =>
  blocked.length === 0
    ? undefined
    : `${engineName} cannot make ${FORMATS.filter((f) => blocked.includes(f.id))
        .map((f) => f.hint)
        .join(' or ')}.`;

/**
 * Send the opening focus to the group rather than into it.
 *
 * Radix focuses the first tabbable thing in a surface it opens, which here is
 * the option that is already set. That matched :focus-visible and painted the
 * app's 2px ring on it, so every picker opened with the mouse arrived
 * shouting. The group is the roving target instead, and the ring appears the
 * moment an arrow key moves onto a real option.
 */
const openOnGroup = (e: Event) => {
  e.preventDefault();
  const root = (e.currentTarget ?? e.target) as HTMLElement | null;
  root?.querySelector<HTMLElement>('[role="radiogroup"]')?.focus();
};
export { openOnGroup };
