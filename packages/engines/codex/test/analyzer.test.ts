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
  stdin = {
    written: '',
    write(d: string | Buffer) {
      this.written += String(d);
      return true;
    },
    end: () => {},
    on: () => {},
  };
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
const promptFromArgs = (call: SpawnCall) => call.child.stdin.written; // the prompt rides stdin

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
    expect(promptFromArgs(calls[0])).not.toContain('--image'); // prompt stays the positional tail
    // Reading a face is the anchor everything downstream is conditioned on.
    expect(args).toContain('model_reasoning_effort="high"');

    const prompt = promptFromArgs(calls[0]);
    expect(prompt).toContain('2 reference images are attached');
    expect(prompt).toContain('she is our founder');
    expect(prompt).toContain('Do not name, identify, or guess who this person is');
    expect(prompt).toContain('Choose "suitableCategories" only from this list: Beauty, Apparel');
    expect(prompt).toContain('analysis.json');
    expect(existsSync(dir)).toBe(false); // workspace cleaned up
  });

  it('keeps facial, skin and build, and files each photo by view, when asked to', async () => {
    const { spawnImpl, calls } = fakeSpawn(({ args, child }) => {
      const body = {
        ...GOOD_PRESENTER,
        facial: 'oval face, high cheekbones, wide-set eyes',
        skin: 'olive with fine natural texture',
        build: 'slender, upright posture',
        photos: [
          { index: 0, view: 'portrait', usable: true, note: 'sharp, well lit' },
          { index: 1, view: 'sideways', usable: 'yes', note: 'a profile' },
          { index: 2, view: 'Three-Quarter', usable: true, note: 'turned, both eyes visible' },
          { index: 7, view: 'front', usable: true, note: 'no such photo' },
          'junk',
        ],
        conflict: 'ref-2 looks like a different person: rounder face, darker brows',
      };
      writeFileSync(join(dirFromArgs(args), 'analysis.json'), JSON.stringify(body));
      child.emit('exit', 0, null);
    });
    const analyzer = createCodexAnalyzer({ platform: 'linux', spawnImpl });
    const draft = (await analyzer.analyze({
      kind: 'presenter',
      name: 'Mara',
      imagePaths: [photo(), photo(), photo()],
      classifyPhotos: true,
    })) as PresenterDraft;

    expect(draft.facial).toBe('oval face, high cheekbones, wide-set eyes');
    expect(draft.skin).toBe('olive with fine natural texture');
    expect(draft.build).toBe('slender, upright posture');
    // an unknown view is "other", a loose boolean is coerced, an index past
    // the photos is dropped, junk is dropped
    expect(draft.photos).toEqual([
      { index: 0, view: 'portrait', usable: true, note: 'sharp, well lit' },
      { index: 1, view: 'other', usable: true, note: 'a profile' },
      { index: 2, view: 'three-quarter', usable: true, note: 'turned, both eyes visible' },
    ]);
    // a second person in the pile is said once, never refused
    expect(draft.conflict).toBe('ref-2 looks like a different person: rounder face, darker brows');
    const prompt = promptFromArgs(calls[0]);
    expect(prompt).toContain('"facial"');
    expect(prompt).toContain('"photos"');
    expect(prompt).toContain('"conflict"');
    expect(prompt).toContain('ref-1.png');
    // the filing names every view the studio can fill, the three-quarter included
    expect(prompt).toContain('"three-quarter" (turned about forty-five degrees, both eyes visible)');
  });

  it('never spends the one retry on the optional keys', async () => {
    const { spawnImpl, calls } = fakeSpawn(({ args, child }) => {
      const body = { ...GOOD_PRESENTER, facial: 42, skin: null, build: [], photos: 'none' };
      writeFileSync(join(dirFromArgs(args), 'analysis.json'), JSON.stringify(body));
      child.emit('exit', 0, null);
    });
    const analyzer = createCodexAnalyzer({ platform: 'linux', spawnImpl });
    const draft = (await analyzer.analyze({
      kind: 'presenter',
      name: 'Mara',
      imagePaths: [photo()],
    })) as PresenterDraft;
    expect(calls).toHaveLength(1);
    expect(draft.facial).toBeUndefined();
    expect(draft.photos).toBeUndefined();
    expect(draft.conflict).toBeUndefined();
    // and a call that did not ask for a filing is not told about one
    expect(promptFromArgs(calls[0])).not.toContain('"photos"');
    expect(promptFromArgs(calls[0])).not.toContain('"conflict"');
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
    expect(promptFromArgs(calls[0])).not.toContain('Your last answer was rejected');
    expect(promptFromArgs(calls[1])).toContain('"presentation" must be exactly "woman" or "man"');
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

    const prompt = promptFromArgs(calls[0]);
    expect(prompt).toContain('keep the rocks, less orange');
    // Identity is still refused outright, and now says so about people too.
    expect(prompt).toContain('Never name a brand, a product model or a wordmark');
    expect(prompt).toContain('do not use any proper name anywhere in your answer');
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
    expect(promptFromArgs(calls[0])).toContain('You have no reference images');
    expect(promptFromArgs(calls[0])).toContain('The person describes the place as: a volcanic beach at dusk');
    expect(promptFromArgs(calls[0])).toContain('That description is the brief');
    expect(promptFromArgs(calls[0])).not.toContain('The person who chose these references');
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
    expect(promptFromArgs(calls[1])).toContain('contained a {placeholder}');
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
    const prompt = promptFromArgs(calls[0]);
    expect(prompt).toContain('You are revising an existing record, not starting over');
    expect(prompt).toContain('A wet basalt shelf at low sunset light.');
    expect(prompt).toContain('The correction to apply: more daylight');
  });
});

// The reported failure: "leave it out completely" was read, correctly, as an
// instruction to describe an empty room, so a world built around a person came
// back as bare architecture. Identity is what a scene must drop; presence is not.
describe('analyze — scene: presence without identity', () => {
  const scenePrompt = async (over: Record<string, unknown> = {}) => {
    const { spawnImpl, calls } = fakeSpawn(({ args, child }) => {
      writeFileSync(join(dirFromArgs(args), 'analysis.json'), JSON.stringify({ ...GOOD_SCENE, ...over }));
      child.emit('exit', 0, null);
    });
    const analyzer = createCodexAnalyzer({ platform: 'darwin', spawnImpl });
    const draft = (await analyzer.analyze({ kind: 'scene', name: '', imagePaths: [photo()] })) as SceneDraft;
    return { draft, prompt: promptFromArgs(calls[0]) };
  };

  it('asks for a figure by role, and refuses one by identity', async () => {
    const { prompt } = await scenePrompt();
    expect(prompt).toContain('What you leave out is identity, not presence');
    expect(prompt).toContain('recorded only as a figure');
    expect(prompt).toMatch(/scale in the frame.*distance.*posture/s);
    expect(prompt).toContain('Never their face, hair, age, wardrobe');
    expect(prompt).toContain('never as a particular person');
    // The instruction that caused the erasure is gone.
    expect(prompt).not.toContain('leave it out completely');
    expect(prompt).not.toContain('not what is standing in it');
  });

  it('asks for the axes a generic description flattens', async () => {
    const { prompt } = await scenePrompt();
    expect(prompt).toContain('Name materials rather than colours');
    expect(prompt).toContain('foreground through middle ground to background');
    expect(prompt).toContain('reflective or transmissive');
  });

  // Lettering described without its words and then forbidden by the draw
  // left the model to copy the reference's words, brand names included.
  it('keeps lettering built into the set in words of its own, and drops what was laid over the picture', async () => {
    const { prompt } = await scenePrompt();
    expect(prompt).toContain('only one of them belongs to the world');
    expect(prompt).toMatch(/sculptural letters, signage.*is art direction/s);
    expect(prompt).toContain('give it new words of your own in curly quotation marks');
    expect(prompt).toContain('never the words it carries in the reference and never a name');
    expect(prompt).toMatch(/headline, tagline, caption, credits.*is the advertisement, not the world: leave it out/s);
    expect(prompt).toContain('A logo is never reproduced');
    expect(prompt).not.toContain('typographic texture');
  });

  it("takes a visitor out with its shadow, and out of the figure's hands", async () => {
    const { prompt } = await scenePrompt();
    expect(prompt).toContain('leave the object itself out, with its shadow and its reflection');
    expect(prompt).toContain('describe their pose with empty hands');
  });

  it('keeps the quoted words of set lettering through the answer file', async () => {
    const prompt =
      'Printed tape bands repeat “OPEN SPACE” across a bright white gallery, crossing at opposing diagonals.';
    const { draft } = await scenePrompt({ prompt });
    expect(draft.prompt).toContain('“OPEN SPACE”');
  });

  it('keeps camera out of the set prose, where the shot could not outrank it', async () => {
    const { prompt } = await scenePrompt();
    expect(prompt).toContain('Camera belongs here and never in "prompt"');
  });

  // Consensus alone collapsed complementary references to their intersection.
  it('builds several references into one world: what they share, what each adds, what gives way', async () => {
    const { prompt } = await scenePrompt();
    expect(prompt).toContain('they were chosen together to describe one world');
    expect(prompt).toContain('add what each one brings that the others do not contradict');
    expect(prompt).toContain('a detail is not a visitor because only one reference shows it');
    expect(prompt).toMatch(/truly disagree.*follow the place most of them support.*never blend them/s);
    expect(prompt).toContain('say in "coverage" what you left out');
    expect(prompt).not.toContain('the world is what they share');
    // Order-neutral: nothing in the wording favours a position.
    expect(prompt).not.toMatch(/first (reference|image|picture)/i);
  });

  it('separates "is the frame built around a body" from "who does this world flatter"', async () => {
    const { prompt } = await scenePrompt();
    expect(prompt).toContain('This is a different question from "subject"');
  });

  it('keeps a staged position, collapsed to one line', async () => {
    const { draft } = await scenePrompt({
      figure: '  someone is seated at the stone ledge,\n  mid-ground, at human scale  ',
    });
    expect(draft.figure).toBe('someone is seated at the stone ledge, mid-ground, at human scale');
  });

  it('drops a staged position rather than burning the retry on it', async () => {
    // A placeholder, an absent key and a wrong type are all non-blocking: the one
    // retry exists for a broken contract, not for an optional field.
    expect((await scenePrompt({ figure: 'beside the {product_name}' })).draft.figure).toBeUndefined();
    expect((await scenePrompt({ figure: undefined })).draft.figure).toBeUndefined();
    expect((await scenePrompt({ figure: 42 })).draft.figure).toBeUndefined();
  });

  it('caps a staged position before it can become a pose', async () => {
    const { draft } = await scenePrompt({ figure: 'x'.repeat(400) });
    expect(draft.figure!.length).toBeLessThanOrEqual(160);
  });

  it('cuts a long position at its last clause, never mid-word', async () => {
    const long =
      'one nearly full-length figure fills the central aisle at close range between the marble tables and the counter, stepping forward with both arms gathered tightly around a precarious stack';
    expect((await scenePrompt({ figure: long })).draft.figure).toBe(
      'one nearly full-length figure fills the central aisle at close range between the marble tables and the counter',
    );
    const noClause = `one figure ${'stands very still '.repeat(12)}`;
    const cut = (await scenePrompt({ figure: noClause })).draft.figure!;
    expect(cut.length).toBeLessThanOrEqual(160);
    expect(noClause.startsWith(cut)).toBe(true);
    expect(noClause[cut.length]).toBe(' ');
  });

  // Coverage is read in the conversation, so it is never cut mid-word.
  it('cuts a long coverage note at a word, never inside one', async () => {
    const note =
      'These references show different places: three compact display sets and one densely dressed outdoor street, so their shared world is chiefly directional light and mineral surfaces rather than one continuous room or a single street, and the street carries far more dressing than any of the three display sets does.';
    const [cut] = (await scenePrompt({ coverage: [note] })).draft.coverage;
    expect(cut.length).toBeLessThanOrEqual(240);
    expect(note.startsWith(cut)).toBe(true);
    expect(cut).toMatch(/[a-z]$/);
    expect([' ', ',', ';'].includes(note[cut.length])).toBe(true);
  });

  it('carries at most two coverage notes, the way a presenter does', async () => {
    const { draft } = await scenePrompt({ coverage: ['One.', 'Two.', 'Three.'] });
    expect(draft.coverage).toEqual(['One.', 'Two.']);
    expect((await scenePrompt({ coverage: undefined })).draft.coverage).toEqual([]);
  });
});

// A figure can BE the concept. A close portrait whose whole art direction is
// what was done to the face used to be excluded by name - "a portrait that
// happens to have a background" - so a sticker-covered face came back as an
// empty room.
describe('analyze — scene: a figure can be the concept', () => {
  const run = async (over: Record<string, unknown> = {}) => {
    const { spawnImpl, calls } = fakeSpawn(({ args, child }) => {
      writeFileSync(join(dirFromArgs(args), 'analysis.json'), JSON.stringify({ ...GOOD_SCENE, ...over }));
      child.emit('exit', 0, null);
    });
    const analyzer = createCodexAnalyzer({ platform: 'darwin', spawnImpl });
    const draft = (await analyzer.analyze({
      kind: 'scene',
      name: '',
      imagePaths: [photo()],
      instruction: over.__instruction as string | undefined,
    })) as SceneDraft;
    return { draft, prompt: promptFromArgs(calls[0]) };
  };

  it('no longer excludes a portrait from being a scene', async () => {
    const { prompt } = await run();
    expect(prompt).not.toContain('portrait that happens to have a background');
    expect(prompt).toContain('A portrait counts');
    expect(prompt).toContain('however much of the frame they occupy');
  });

  it('asks for what was done to the figure, printing included', async () => {
    const { prompt } = await run();
    expect(prompt).toContain('the figure IS the world');
    expect(prompt).toMatch(/covered in stickers.*painted skin.*veil.*mask/s);
    expect(prompt).toContain('Record what was done; never who it was done to');
    // The sticker sheet is covered in real marks, and the graphic character is
    // the concept. Asking for the material alone produced blank pastel paper, so
    // the printing is wanted and only the real brands are refused.
    expect(prompt).toContain('the character of any printing on it');
    expect(prompt).toContain('graphic character is');
    expect(prompt).toContain('without naming a real company from the references');
    // Faithful to these pictures, not to the idea of them.
    expect(prompt).toContain('how much of the surface is covered and how much is left bare');
    expect(prompt).toContain('glossy vinyl, matte paper, foil, fabric');
    expect(prompt).toContain('give the range rather than picking one');
    // Reach is asked for separately from amount: sparse and full-face are not
    // the same thing, and conflating them massed everything on one cheek.
    expect(prompt).toContain('how far they reach across the form');
    expect(prompt).toContain('sparse and still cover the whole face');
  });

  it('keeps poster faces, statues and reflections out of the figure slot', async () => {
    const { prompt } = await run();
    expect(prompt).toMatch(/mannequin, a statue, a face on a poster/);
    expect(prompt).toContain('describe it in the set, not as a figure');
  });

  it('treats only the composed-around person as the figure, so a crowd is not cloned', async () => {
    const { prompt } = await run();
    expect(prompt).toContain('only the one the composition is built around is the figure');
  });

  it('carries a figure and its treatment through', async () => {
    const { draft } = await run({
      figure: 'one person at close portrait range, squared to camera, filling the frame',
      figureTreatment: 'the face entirely covered in overlapping printed stickers',
    });
    expect(draft.figure).toContain('close portrait range');
    expect(draft.figureTreatment).toBe('the face entirely covered in overlapping printed stickers');
  });

  it('never keeps a treatment with no figure to apply it to', async () => {
    const { draft } = await run({ figure: '', figureTreatment: 'face covered in stickers' });
    expect(draft.figure).toBeUndefined();
    expect(draft.figureTreatment).toBeUndefined();
  });

  it('lets the direction outrank the pictures', async () => {
    const { prompt } = await run({ __instruction: 'The stickers on the face are the whole point.' });
    expect(prompt).toContain('The stickers on the face are the whole point.');
    expect(prompt).toContain('Treat that as the deciding word');
    expect(prompt).toContain('essential even if only one reference shows it');
    expect(prompt).toContain('stays out even if every reference contains it');
    // The old wording made it a wish with no authority to settle anything.
    expect(prompt).not.toContain('What the person wants from it');
  });
});

describe('measure', () => {
  it('reads a product photograph for its real size, never its size in the picture', async () => {
    const { spawnImpl, calls } = fakeSpawn(({ args, child }) => {
      writeFileSync(
        join(dirFromArgs(args), 'analysis.json'),
        JSON.stringify({ size: 'about 2 cm across', largestCm: 2.04 }),
      );
      child.emit('exit', 0, null);
    });
    const analyzer = createCodexAnalyzer({ platform: 'linux', spawnImpl });
    const size = await analyzer.measure({ imagePath: photo(), name: 'Signet Ring', description: 'Solid gold' });
    expect(size).toEqual({ text: 'about 2 cm across', largestCm: 2 });
    expect(calls).toHaveLength(1);
    const prompt = promptFromArgs(calls[0]);
    expect(prompt).toContain('the product is called "Signet Ring"');
    expect(prompt).toContain('Its maker describes it: Solid gold.');
    expect(prompt).toContain('never from how large it looks in this picture');
    expect(calls[0].args.some((a) => a.startsWith('--image='))).toBe(true);
  });

  it('asks once more for a size it cannot read, then gives up rather than guess', async () => {
    const bodies = [
      { size: 'large', largestCm: 'big' },
      { size: 'about 10 cm tall', largestCm: 10 },
    ];
    const { spawnImpl, calls } = fakeSpawn(({ args, child }) => {
      writeFileSync(join(dirFromArgs(args), 'analysis.json'), JSON.stringify(bodies[calls.length - 1]));
      child.emit('exit', 0, null);
    });
    const analyzer = createCodexAnalyzer({ platform: 'linux', spawnImpl });
    expect(await analyzer.measure({ imagePath: photo(), name: 'Lumière' })).toEqual({
      text: 'about 10 cm tall',
      largestCm: 10,
    });
    expect(promptFromArgs(calls[1])).toContain('"largestCm" must be a number of centimetres');

    const { spawnImpl: bad } = fakeSpawn(({ args, child }) => {
      writeFileSync(
        join(dirFromArgs(args), 'analysis.json'),
        JSON.stringify({ size: 'about 900 m', largestCm: 90000 }),
      );
      child.emit('exit', 0, null);
    });
    await expect(
      createCodexAnalyzer({ platform: 'linux', spawnImpl: bad }).measure({ imagePath: photo(), name: 'X' }),
    ).rejects.toThrow(/could not size this product/);
  });
});
