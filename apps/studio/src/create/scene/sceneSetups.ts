import type { SceneSetup } from '../../apiTypes.js';

/**
 * The ways one world can be shot.
 *
 * A setup is what a photographer calls it: the number changes when the camera
 * or the light moves and the location does not. A scene owns the world; a
 * setup owns where the camera stands in it, and nothing else, which is why one
 * is a label and a line rather than a second scene or another picture.
 *
 * The lines are the ones a battery on real Codex actually produced the frame
 * for (2026-09-20): overhead gave a true top-down of the paving, ground level
 * gave a low close frame with the walls behind, and both kept the world, the
 * light and the product identical. They are written the way that battery wrote
 * them, not paraphrased.
 *
 * Five, and four at most on any one scene: a longer list is a shot list, and a
 * shot list belongs to Create.
 */
export const FRAMINGS: readonly SceneSetup[] = [
  {
    id: 'top-down',
    label: 'Top down',
    camera: 'Directly overhead, looking straight down, the subject centred, deep focus',
  },
  {
    id: 'eye-level',
    label: 'Eye level',
    camera: 'Eye level, the subject at a natural three-quarter angle, medium depth',
  },
  {
    id: 'ground',
    label: 'Ground level',
    camera: 'Ground level, camera low, the subject close and large in frame, the place rising behind it',
  },
  {
    id: 'wide',
    label: 'Wide',
    camera: 'A wide view, the subject small in the frame, the place around it doing the talking',
  },
  {
    id: 'close',
    label: 'Close',
    camera: 'Close in on the subject, its surface, edge and material filling the frame',
  },
];

/** The most a scene keeps, matching the record's own cap. */
export const SETUPS_MAX = 4;

/** The framings this scene has not taken yet, in the order they are offered. */
export const framingsLeft = (setups: readonly SceneSetup[] | undefined): SceneSetup[] =>
  FRAMINGS.filter((f) => !(setups ?? []).some((s) => s.id === f.id));
