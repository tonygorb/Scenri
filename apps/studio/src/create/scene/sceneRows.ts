import type { SwatchRow } from '../../conversation/question.js';

/**
 * The five things a place is asked about, in the order they are asked.
 *
 * A scene is where a shot is and how it looks: the kind of place, its light,
 * the feeling, what it is made of, and whether it is built around someone
 * standing in it. Nothing here is about who; a person in a scene is a
 * position, never an identity, and the reader keeps it that way.
 *
 * Each option carries the words it hands the reader (`words`), which is what
 * a tap means, and a card id for its drawn picture (`card`), which the
 * stylesheet names one by one, the way the presenter's rows are drawn.
 */
export type SceneRow = 'where' | 'light' | 'feeling' | 'materials' | 'figure';

export const ROW_ORDER: readonly SceneRow[] = ['where', 'light', 'feeling', 'materials', 'figure'];

export interface RowOption {
  id: string;
  label: string;
  /** What choosing it tells the reader, as it would be written in the place's own sentence. */
  words: string;
  card?: string;
}

interface RowSpec {
  prompt: string;
  options: RowOption[];
}

const card = (row: SceneRow, n: number) => `scene-${row}-${n}`;

export const ROWS: Record<SceneRow, RowSpec> = {
  where: {
    prompt: 'What kind of place?',
    options: [
      { id: 'studio', label: 'Studio', words: 'a photography studio', card: card('where', 1) },
      { id: 'interior', label: 'Interior', words: 'an interior', card: card('where', 2) },
      { id: 'outdoors', label: 'Outdoors', words: 'outdoors, in the open air', card: card('where', 3) },
      { id: 'architecture', label: 'Architecture', words: 'a piece of architecture', card: card('where', 4) },
      { id: 'nature', label: 'Nature', words: 'a natural landscape', card: card('where', 5) },
      { id: 'surreal', label: 'Surreal set', words: 'a surreal, built set', card: card('where', 6) },
    ],
  },
  light: {
    prompt: 'What light?',
    options: [
      { id: 'soft', label: 'Soft daylight', words: 'soft daylight', card: card('light', 1) },
      { id: 'golden', label: 'Golden hour', words: 'low golden-hour light', card: card('light', 2) },
      { id: 'hard', label: 'Hard sun', words: 'hard direct sun and crisp shadows', card: card('light', 3) },
      { id: 'night', label: 'Night and neon', words: 'night, lit by neon', card: card('light', 4) },
      { id: 'flash', label: 'Studio flash', words: 'direct studio flash', card: card('light', 5) },
      { id: 'lowkey', label: 'Low-key', words: 'low-key light falling into deep shadow', card: card('light', 6) },
    ],
  },
  feeling: {
    prompt: 'And the feeling?',
    options: [
      { id: 'warm', label: 'Warm', words: 'warm', card: card('feeling', 1) },
      { id: 'cool', label: 'Cool', words: 'cool', card: card('feeling', 2) },
      { id: 'minimal', label: 'Minimal', words: 'quiet and minimal', card: card('feeling', 3) },
      { id: 'bold', label: 'Bold colour', words: 'in bold, saturated colour', card: card('feeling', 4) },
      { id: 'dramatic', label: 'Dark and dramatic', words: 'dark and dramatic', card: card('feeling', 5) },
      { id: 'pastel', label: 'Pastel', words: 'in soft pastel tones', card: card('feeling', 6) },
    ],
  },
  materials: {
    prompt: 'What is it made of?',
    options: [
      { id: 'stone', label: 'Stone and concrete', words: 'stone and concrete', card: card('materials', 1) },
      { id: 'wood', label: 'Wood', words: 'wood', card: card('materials', 2) },
      { id: 'metal', label: 'Metal and glass', words: 'metal and glass', card: card('materials', 3) },
      { id: 'fabric', label: 'Fabric', words: 'fabric', card: card('materials', 4) },
      { id: 'water', label: 'Sand and water', words: 'sand and water', card: card('materials', 5) },
      { id: 'plaster', label: 'Plaster', words: 'plaster', card: card('materials', 6) },
    ],
  },
  figure: {
    prompt: 'Is it built around someone?',
    options: [
      { id: 'place', label: 'Just the place', words: 'with nobody in it', card: card('figure', 1) },
      {
        id: 'someone',
        label: 'Someone in it',
        words: 'built around one person in the frame, a position rather than anyone in particular',
        card: card('figure', 2),
      },
    ],
  },
};

/**
 * The rows whose pictures are drawn.
 *
 * Each row's cards are drawn in one pass (the selection-art skill: one ground,
 * one framing, only the chosen thing differs) and named in the stylesheet one
 * by one. A row not in here is words on chips: the same answers, unillustrated,
 * never a row with pictures on some cards and not others.
 */
export const DRAWN: ReadonlySet<SceneRow> = new Set<SceneRow>(['where', 'light', 'feeling', 'materials', 'figure']);

/** A row as the conversation's swatch block takes it. */
export function swatchRow(row: SceneRow): SwatchRow {
  return {
    id: row,
    label: ROWS[row].prompt,
    options: ROWS[row].options.map((o) => ({
      id: o.id,
      label: o.label,
      ...(DRAWN.has(row) && o.card ? { card: o.card } : {}),
    })),
  };
}

export const optionOf = (row: SceneRow, id: string | undefined): RowOption | undefined =>
  id ? ROWS[row].options.find((o) => o.id === id) : undefined;
