import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { spawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { createCodexAnalyzer, type PresenterDraft, type SceneDraft } from '../src/analyzer.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 1, 1]);

class FakeChild extends EventEmitter {
  kill = vi.fn(() => true);
  stdout = new EventEmitter();
  stderr = new EventEmitter();
}

interface SpawnCall {
  cmd: string;
  args: string[];
  child: FakeChild;
}

function fakeSpawn(onSpawn: (call: SpawnCall) => void): { spawnImpl: typeof spawn; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  const spawnImpl = ((cmd: string, args: string[]) => {
    const call: SpawnCall = { cmd, args, child: new FakeChild() };
    calls.push(call);
    setTimeout(() => onSpawn(call), 0);
    return call.child;
  }) as unknown as typeof spawn;
  return { spawnImpl, calls };
}

const dirFromArgs = (args: string[]) => args[args.indexOf('-C') + 1];
const promptFromArgs = (args: string[]) => args[args.length - 1];

function photo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'analyzer-src-'));
  const p = join(dir, 'photo.png');
  writeFileSync(p, PNG);
  return p;
}

const GOOD_PRESENTER = {
  promptName: 'a woman in her early thirties with dark shoulder-length waves',
  presentation: 'woman',
  descriptor: 'Warm editorial · dark waves · composed',
  ageRange: 'early 30s',
  hair: 'dark shoulder-length waves',
  identityNotes: 'the wide-set brown eyes and the small scar above the left brow must survive every generation',
  negativeConstraints: ['no straightened hair'],
  suitableCategories: ['Beauty', 'Nowhere'],
  coverage: ['A three-quarter photo would pin the cheekbones down.'],
};

const GOOD_SCENE = {
  name: 'Wet Basalt Shore',
  promptName: 'Wet Basalt Shore',
  lighting: 'Low directional sunset, long shadows across wet stone',
  description: 'A dark volcanic shoreline at last light.',
  subject: 'product',
  prompt:
    'A wet dark basalt shelf at low sunset light. Cool ocean haze sits behind. Foreground rock occludes the lower frame.',
  camera: 'low three-quarter, long lens',
  keywords: ['volcanic', 'shore', 'sunset'],
  collections: ['Editorial', 'Nowhere'],
  verticals: ['Beauty'],
};

describe('isAvailable', () => {
  it('reports the same absence the engine does', async () => {
    const { spawnImpl } = fakeSpawn(({ child }) => child.emit('error', new Error('spawn codex ENOENT')));
    const analyzer = createCodexAnalyzer({ platform: 'linux', spawnImpl });
    await expect(analyzer.isAvailable()).resolves.toEqual({
      ok: false,
      reason: 'Codex CLI is not installed on this computer',
      code: 'not-installed',
    });
  });
});

describe('analyze — presenter', () => {
  it('attaches every photo, thinks hard, and returns the casting sheet', async () => {
    const { spawnImpl, calls } = fakeSpawn(({ args, child }) => {
      writeFileSync(join(dirFromArgs(args), 'analysis.json'), JSON.stringify(GOOD_PRESENTER));
      child.emit('exit', 0, null);
    });
    const analyzer = createCodexAnalyzer({ platform: 'linux', spawnImpl });
    const draft = (await analyzer.analyze({
      kind: 'presenter',
      name: 'Mara',
      imagePaths: [photo(), photo()],
      instruction: 'she is our founder',
      vocabulary: { categories: ['Beauty', 'Apparel'] },
    })) as PresenterDraft;

    // "Nowhere" is not a category this install has a tab for, so it is
    // dropped rather than filed somewhere nobody can click.
    expect(draft).toEqual({ ...GOOD_PRESENTER, suitableCategories: ['Beauty'] });
    expect(calls).toHaveLength(1);
    const { args } = calls[0];
    const dir = dirFromArgs(args);
    expect(args).toContain(`--image=${join(dir, 'ref-1.png')}`);
    expect(args).toContain(`--image=${join(dir, 'ref-2.png')}`);
    expect(promptFromArgs(args)).not.toContain('--image'); // prompt stays the positional tail
    // Reading a face is the anchor everything downstream is conditioned on.
    expect(args).toContain('model_reasoning_effort="high"');

    const prompt = promptFromArgs(args);
    expect(prompt).toContain('2 reference images are attached');
    expect(prompt).toContain('she is our founder');
    expect(prompt).toContain('Do not name, identify, or guess who this person is');
    expect(prompt).toContain('Choose "suitableCategories" only from this list: Beauty, Apparel');
    expect(prompt).toContain('analysis.json');
    expect(existsSync(dir)).toBe(false); // workspace cleaned up
  });

  it('retries once with the exact problem, then succeeds', async () => {
    let n = 0;
    const { spawnImpl, calls } = fakeSpawn(({ args, child }) => {
      const body = n++ === 0 ? { ...GOOD_PRESENTER, presentation: 'person' } : GOOD_PRESENTER;
      writeFileSync(join(dirFromArgs(args), 'analysis.json'), JSON.stringify(body));
      child.emit('exit', 0, null);
    });
    const analyzer = createCodexAnalyzer({ platform: 'linux', spawnImpl });
    const draft = (await analyzer.analyze({
      kind: 'presenter',
      name: 'Mara',
      imagePaths: [photo()],
    })) as PresenterDraft;

    expect(draft.presentation).toBe('woman');
    expect(calls).toHaveLength(2);
    expect(promptFromArgs(calls[0].args)).not.toContain('Your last answer was rejected');
    expect(promptFromArgs(calls[1].args)).toContain('"presentation" must be exactly "woman" or "man"');
  });

  it('gives up after the second bad answer rather than inventing a person', async () => {
    const { spawnImpl, calls } = fakeSpawn(({ args, child }) => {
      writeFileSync(join(dirFromArgs(args), 'analysis.json'), 'not json at all');
      child.emit('exit', 0, null);
    });
    const analyzer = createCodexAnalyzer({ platform: 'linux', spawnImpl });
    await expect(analyzer.analyze({ kind: 'presenter', name: 'Mara', imagePaths: [photo()] })).rejects.toThrow(
      /could not describe these references.*not valid JSON/s,
    );
    expect(calls).toHaveLength(2);
  });

  it('reports the missing file when codex exits clean without writing one', async () => {
    const { spawnImpl } = fakeSpawn(({ child }) => child.emit('exit', 0, null));
    const analyzer = createCodexAnalyzer({ platform: 'linux', spawnImpl });
    await expect(analyzer.analyze({ kind: 'presenter', name: 'Mara', imagePaths: [photo()] })).rejects.toThrow(
      /No analysis\.json was written/,
    );
  });

  it('accepts a fenced answer and trims runaway prose', async () => {
    const { spawnImpl } = fakeSpawn(({ args, child }) => {
      const body = {
        ...GOOD_PRESENTER,
        identityNotes: 'x'.repeat(2000),
        negativeConstraints: Array(20).fill('no drift'),
      };
      writeFileSync(join(dirFromArgs(args), 'analysis.json'), `\`\`\`json\n${JSON.stringify(body)}\n\`\`\``);
      child.emit('exit', 0, null);
    });
    const analyzer = createCodexAnalyzer({ platform: 'linux', spawnImpl });
    const draft = (await analyzer.analyze({
      kind: 'presenter',
      name: 'Mara',
      imagePaths: [photo()],
    })) as PresenterDraft;
    expect(draft.identityNotes.length).toBe(900);
    expect(draft.negativeConstraints).toHaveLength(6);
  });

  it('surfaces a codex failure as itself', async () => {
    const { spawnImpl } = fakeSpawn(({ child }) => {
      child.stderr.emit('data', 'not signed in');
      child.emit('exit', 3, null);
    });
    const analyzer = createCodexAnalyzer({ platform: 'linux', spawnImpl });
    await expect(analyzer.analyze({ kind: 'presenter', name: 'Mara', imagePaths: [photo()] })).rejects.toThrow(
      /codex exited with code 3: not signed in/,
    );
  });

  it('kills the run and throws after timeoutMs', async () => {
    const { spawnImpl, calls } = fakeSpawn(() => {
      /* never exits */
    });
    const analyzer = createCodexAnalyzer({ platform: 'linux', spawnImpl, timeoutMs: 40 });
    await expect(analyzer.analyze({ kind: 'presenter', name: 'Mara', imagePaths: [photo()] })).rejects.toThrow(
      'Codex CLI timed out after 40ms',
    );
    expect(calls[0].child.kill).toHaveBeenCalled();
  });

  it('aborts mid-run when the caller gives up', async () => {
    const { spawnImpl, calls } = fakeSpawn(() => {
      /* never exits */
    });
    const analyzer = createCodexAnalyzer({ platform: 'linux', spawnImpl });
    const ctl = new AbortController();
    const p = analyzer.analyze({ kind: 'presenter', name: 'Mara', imagePaths: [photo()] }, ctl.signal);
    setTimeout(() => ctl.abort(), 10);
    await expect(p).rejects.toThrow('Codex CLI run aborted');
    expect(calls[0].child.kill).toHaveBeenCalled();
  });
});

describe('analyze — scene', () => {
  it('extracts the world, keeps only known facets, and never asks for a product', async () => {
    const { spawnImpl, calls } = fakeSpawn(({ args, child }) => {
      writeFileSync(join(dirFromArgs(args), 'analysis.json'), JSON.stringify(GOOD_SCENE));
      child.emit('exit', 0, null);
    });
    const analyzer = createCodexAnalyzer({ platform: 'linux', spawnImpl });
    const draft = (await analyzer.analyze({
      kind: 'scene',
      name: '',
      imagePaths: [photo()],
      instruction: 'keep the rocks, less orange',
      vocabulary: { collections: ['Editorial', 'Interiors'], verticals: ['Beauty', 'Home'] },
    })) as SceneDraft;

    expect(draft.subject).toBe('product');
    expect(draft.prompt).toContain('basalt shelf');
    expect(draft.camera).toBe('low three-quarter, long lens');
    // "Nowhere" is not a collection this install has a filter for.
    expect(draft.collections).toEqual(['Editorial']);
    expect(draft.verticals).toEqual(['Beauty']);

    const prompt = promptFromArgs(calls[0].args);
    expect(prompt).toContain('keep the rocks, less orange');
    expect(prompt).toContain('Never name or describe a brand, a logo, a product, or a person');
    expect(prompt).toContain('Choose "collections" only from this list: Editorial, Interiors');
  });

  it('works from words alone when there is nothing to look at', async () => {
    const { spawnImpl, calls } = fakeSpawn(({ args, child }) => {
      writeFileSync(join(dirFromArgs(args), 'analysis.json'), JSON.stringify(GOOD_SCENE));
      child.emit('exit', 0, null);
    });
    const analyzer = createCodexAnalyzer({ platform: 'linux', spawnImpl });
    await analyzer.analyze({ kind: 'scene', name: 'Shore', imagePaths: [], instruction: 'a volcanic beach at dusk' });
    const { args } = calls[0];
    expect(args.filter((a) => a.startsWith('--image='))).toEqual([]);
    expect(promptFromArgs(args)).toContain('You have no reference images');
  });

  it('rejects a prompt that leaves a placeholder behind', async () => {
    let n = 0;
    const { spawnImpl, calls } = fakeSpawn(({ args, child }) => {
      const body = n++ === 0 ? { ...GOOD_SCENE, prompt: 'A shelf holding {product_name} at dusk.' } : GOOD_SCENE;
      writeFileSync(join(dirFromArgs(args), 'analysis.json'), JSON.stringify(body));
      child.emit('exit', 0, null);
    });
    const analyzer = createCodexAnalyzer({ platform: 'linux', spawnImpl });
    const draft = (await analyzer.analyze({ kind: 'scene', name: 'Shore', imagePaths: [photo()] })) as SceneDraft;
    expect(draft.prompt).not.toContain('{');
    expect(promptFromArgs(calls[1].args)).toContain('contained a {placeholder}');
  });

  it('carries the prior record and the correction into a revision', async () => {
    const { spawnImpl, calls } = fakeSpawn(({ args, child }) => {
      writeFileSync(join(dirFromArgs(args), 'analysis.json'), JSON.stringify(GOOD_SCENE));
      child.emit('exit', 0, null);
    });
    const analyzer = createCodexAnalyzer({ platform: 'linux', spawnImpl });
    await analyzer.analyze({
      kind: 'scene',
      name: 'Shore',
      imagePaths: [],
      correction: 'more daylight',
      priorDraft: { prompt: 'A wet basalt shelf at low sunset light.' },
    });
    const prompt = promptFromArgs(calls[0].args);
    expect(prompt).toContain('You are revising an existing record, not starting over');
    expect(prompt).toContain('A wet basalt shelf at low sunset light.');
    expect(prompt).toContain('The correction to apply: more daylight');
  });
});
