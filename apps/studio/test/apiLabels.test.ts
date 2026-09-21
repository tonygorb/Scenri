import { describe, expect, it } from 'vitest';
import { nodeLabel, nodeName, registerSceneNameAliases } from '../src/apiLabels.js';

describe('nodeName', () => {
  it('returns the scene bracket, remapped when the catalog renamed it', () => {
    registerSceneNameAliases([{ name: 'Silk Drape', legacyNames: ['Old Silk'] }]);
    expect(nodeName({ promptHead: '[Silk Drape] a bottle on marble' })).toBe('Silk Drape');
    expect(nodeName({ promptHead: '[Old Silk] a bottle on marble' })).toBe('Silk Drape');
  });

  it('returns the text-lift shorthand', () => {
    expect(nodeName({ promptHead: 'Remove all overlaid marketing text from the pack' })).toBe('Text lift');
    expect(nodeName({ promptHead: 'Remove ALL text from the label' })).toBe('Text lift');
  });

  it('does not quote the first words of a prompt', () => {
    expect(nodeName({ promptHead: 'Dark stained timber frames a tall doorway' })).toBeUndefined();
  });
});

describe('nodeLabel', () => {
  it('prefers a name, then first words, then a kind fallback', () => {
    registerSceneNameAliases([]);
    expect(nodeLabel({ promptHead: '[Silk Drape] a bottle', kind: 'generation' })).toBe('Silk Drape');
    expect(nodeLabel({ promptHead: 'Dark stained timber frames a tall doorway', kind: 'generation' })).toBe(
      'Dark stained timber frames a tall',
    );
    expect(nodeLabel({ promptHead: '', kind: 'edit' })).toBe('Edit');
    expect(nodeLabel({ promptHead: '', kind: 'generation' })).toBe('Generation');
  });
});
