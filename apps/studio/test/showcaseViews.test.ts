import { describe, expect, it, vi } from 'vitest';

const pickSceneView = vi.fn(async (_id: string, view: string) => {
  if (view === 'bold') throw new Error('this scene has no such view');
  return { hash: 'a'.repeat(32) };
});
vi.mock('../src/api.js', () => ({ api: { pickSceneView } }));

const { namesAView, withPickedViews } = await import('../src/app/showcaseViews.js');

describe('a Home example that follows a scene view', () => {
  it('lands the chip a pick makes: the frame copied in, its hash and name on the scene chip', async () => {
    const [chip] = await withPickedViews([{ t: 'template', id: 'tomato-vine', view: 'angle', viewName: 'Angle' }]);
    expect(pickSceneView).toHaveBeenCalledWith('tomato-vine', 'angle');
    expect(chip).toEqual({ t: 'template', id: 'tomato-vine', view: 'a'.repeat(32), viewName: 'Angle' });
  });

  it('keeps the plain scene when the frame cannot be copied', async () => {
    const [chip] = await withPickedViews([{ t: 'template', id: 'model-village', view: 'bold', viewName: 'Bold' }]);
    expect(chip).toEqual({ t: 'template', id: 'model-village' });
  });

  it('copies nothing for a chip that already carries a picture, or none', async () => {
    pickSceneView.mockClear();
    const tokens = [
      { t: 'template' as const, id: 'dune', view: 'b'.repeat(32), viewName: 'Close-up' },
      { t: 'template' as const, id: 'dune' },
      { t: 'text' as const, v: ' on the sand' },
    ];
    expect(tokens.some(namesAView)).toBe(false);
    expect(await withPickedViews(tokens)).toEqual(tokens);
    expect(pickSceneView).not.toHaveBeenCalled();
  });
});
