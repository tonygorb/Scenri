import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { BrandContext, EditRequest, GenerateRequest } from '@scenri/core';
import { createFalEngine } from '../src/index.js';

const brand: BrandContext = { brand: {}, assetPaths: {} };

const genReq = (over: Partial<GenerateRequest> = {}): GenerateRequest => ({
  prompt: 'a teal fox logo',
  brand,
  width: 1024,
  height: 768,
  count: 2,
  ...over,
});

const editReq = (over: Partial<EditRequest> = {}): EditRequest => ({
  instruction: 'make the sky purple',
  sourceImage: `data:image/png;base64,${Buffer.from('src-pixels').toString('base64')}`,
  brand,
  ...over,
});

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

function textResponse(status: number, text: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new Error('not json');
    },
    text: async () => text,
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

function binaryResponse(bytes: Buffer) {
  return {
    ok: true,
    status: 200,
    json: async () => {
      throw new Error('not json');
    },
    text: async () => bytes.toString('utf8'),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

const dataUri = (content: string) => `data:image/png;base64,${Buffer.from(content).toString('base64')}`;

function makeEngine(overrides: Partial<Parameters<typeof createFalEngine>[0]> = {}) {
  const saved: Buffer[] = [];
  const saveImage = vi.fn((buf: Buffer) => {
    saved.push(buf);
    return `hash-${saved.length}`;
  });
  const fetchImpl = vi.fn() as ReturnType<typeof vi.fn>;
  const engine = createFalEngine({
    getKey: () => 'sk-fal-test',
    saveImage,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    ...overrides,
  });
  return { engine, saveImage, fetchImpl, saved };
}

describe('capabilities', () => {
  it('reports the fal capability set', () => {
    const { engine } = makeEngine();
    expect(engine.capabilities()).toEqual({
      id: 'fal',
      displayName: 'fal.ai (BYOK)',
      localOnly: false,
      supportsEdit: true,
      supportsMask: false,
      maxReferenceImages: 0,
    });
  });
});

describe('isAvailable', () => {
  it('is ok when a key is present', async () => {
    const { engine } = makeEngine();
    await expect(engine.isAvailable()).resolves.toEqual({ ok: true });
  });

  it('is not ok when the key is null', async () => {
    const { engine } = makeEngine({ getKey: () => null });
    await expect(engine.isAvailable()).resolves.toEqual({
      ok: false,
      reason: 'Set a fal.ai key in Settings',
    });
  });

  it('is not ok when the key is empty', async () => {
    const { engine } = makeEngine({ getKey: () => '' });
    const res = await engine.isAvailable();
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('Set a fal.ai key in Settings');
  });
});

describe('costEstimate', () => {
  it('charges per image for generate', async () => {
    const { engine } = makeEngine();
    await expect(engine.costEstimate(genReq({ count: 4 }))).resolves.toBeCloseTo(0.012);
  });

  it('charges a flat rate for edit', async () => {
    const { engine } = makeEngine();
    await expect(engine.costEstimate(editReq())).resolves.toBe(0.025);
  });
});

describe('generate', () => {
  it('POSTs the correct URL, auth header, and body', async () => {
    const { engine, fetchImpl } = makeEngine();
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { images: [{ url: dataUri('img') }] }));

    await engine.generate(genReq({ count: 1 }));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://fal.run/fal-ai/flux/schnell');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Key sk-fal-test');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      prompt: 'a teal fox logo',
      image_size: { width: 1024, height: 768 },
      num_images: 1,
    });
  });

  it('uses a custom model when provided', async () => {
    const { engine, fetchImpl } = makeEngine({ model: 'fal-ai/flux/dev' });
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { images: [{ url: dataUri('img') }] }));

    await engine.generate(genReq({ count: 1 }));

    expect(fetchImpl.mock.calls[0][0]).toBe('https://fal.run/fal-ai/flux/dev');
  });

  it('parses data: URI images, saves each, and returns hashes + cost', async () => {
    const { engine, fetchImpl, saveImage, saved } = makeEngine();
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { images: [{ url: dataUri('one') }, { url: dataUri('two') }] }));

    const result = await engine.generate(genReq({ count: 2 }));

    expect(saveImage).toHaveBeenCalledTimes(2);
    expect(saved[0].toString('utf8')).toBe('one');
    expect(saved[1].toString('utf8')).toBe('two');
    expect(result.images).toEqual(['hash-1', 'hash-2']);
    expect(result.costUsd).toBeCloseTo(0.006);
    expect(result.raw).toBeDefined();
  });

  it('downloads https image URLs via fetchImpl', async () => {
    const { engine, fetchImpl, saved } = makeEngine();
    const pixels = Buffer.from('remote-bytes');
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(200, { images: [{ url: 'https://cdn.fal.example/out.png' }] }))
      .mockResolvedValueOnce(binaryResponse(pixels));

    const result = await engine.generate(genReq({ count: 1 }));

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][0]).toBe('https://cdn.fal.example/out.png');
    expect(saved[0].toString('utf8')).toBe('remote-bytes');
    expect(result.images).toEqual(['hash-1']);
  });

  it('throws with status and a <=200 char body snippet on HTTP failure', async () => {
    const { engine, fetchImpl, saveImage } = makeEngine();
    const longBody = 'x'.repeat(500);
    fetchImpl.mockResolvedValueOnce(textResponse(422, longBody));

    const err = await engine.generate(genReq()).catch((e: unknown) => e as Error);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('422');
    expect((err as Error).message).toContain('x'.repeat(200));
    expect((err as Error).message).not.toContain('x'.repeat(201));
    expect(saveImage).not.toHaveBeenCalled();
  });

  it('throws a clear error when the response has no images array', async () => {
    const { engine, fetchImpl } = makeEngine();
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { detail: 'weird shape' }));

    await expect(engine.generate(genReq())).rejects.toThrow(/missing "images"/);
  });

  it('throws a clear error when an image entry has no url', async () => {
    const { engine, fetchImpl } = makeEngine();
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { images: [{ nope: true }] }));

    await expect(engine.generate(genReq())).rejects.toThrow(/images\[0\] missing "url"/);
  });

  it('throws when no key is configured', async () => {
    const { engine, fetchImpl } = makeEngine({ getKey: () => null });

    await expect(engine.generate(genReq())).rejects.toThrow(/key not set/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('edit', () => {
  it('POSTs instruction and image_url data URI to the edit model', async () => {
    const { engine, fetchImpl } = makeEngine();
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { images: [{ url: dataUri('edited') }] }));
    const source = `data:image/png;base64,${Buffer.from('src-pixels').toString('base64')}`;

    await engine.edit(editReq({ sourceImage: source }));

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://fal.run/fal-ai/flux-kontext/dev');
    expect(init.headers.Authorization).toBe('Key sk-fal-test');
    expect(JSON.parse(init.body)).toEqual({
      prompt: 'make the sky purple',
      image_url: source,
    });
  });

  it('uses a custom edit model when provided', async () => {
    const { engine, fetchImpl } = makeEngine({ editModel: 'fal-ai/kontext/max' });
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { images: [{ url: dataUri('e') }] }));

    await engine.edit(editReq());

    expect(fetchImpl.mock.calls[0][0]).toBe('https://fal.run/fal-ai/kontext/max');
  });

  it('converts a file-path sourceImage into a base64 data URI', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fal-test-'));
    const filePath = join(dir, 'source.png');
    const fileBytes = Buffer.from('file-pixels');
    await writeFile(filePath, fileBytes);

    const { engine, fetchImpl } = makeEngine();
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { images: [{ url: dataUri('e') }] }));

    await engine.edit(editReq({ sourceImage: filePath }));

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.image_url).toBe(`data:image/png;base64,${fileBytes.toString('base64')}`);
  });

  it('saves the edited image and returns its hash with flat cost', async () => {
    const { engine, fetchImpl, saveImage, saved } = makeEngine();
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { images: [{ url: dataUri('edited') }] }));

    const result = await engine.edit(editReq());

    expect(saveImage).toHaveBeenCalledTimes(1);
    expect(saved[0].toString('utf8')).toBe('edited');
    expect(result.images).toEqual(['hash-1']);
    expect(result.costUsd).toBe(0.025);
  });

  it('throws with status and body snippet on HTTP failure', async () => {
    const { engine, fetchImpl } = makeEngine();
    fetchImpl.mockResolvedValueOnce(textResponse(401, '{"detail":"invalid key"}'));

    await expect(engine.edit(editReq())).rejects.toThrow(/401.*invalid key/s);
  });

  it('throws when no key is configured', async () => {
    const { engine, fetchImpl } = makeEngine({ getKey: () => '' });

    await expect(engine.edit(editReq())).rejects.toThrow(/key not set/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
