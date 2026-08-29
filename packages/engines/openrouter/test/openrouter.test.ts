import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BrandContext, EditRequest, GenerateRequest } from '@scenri/core';
import { createOpenRouterEngine } from '../src/index.js';

const brand: BrandContext = { brand: {}, assetPaths: {} };

const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'); // PNG magic + IHDR start
const PNG_B64 = PNG_BYTES.toString('base64');

function okJson(payload: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

function imagePayload(b64: string, cost?: number) {
  return {
    choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${b64}` } }] } }],
    ...(cost === undefined ? {} : { usage: { cost } }),
  };
}

function makeEngine(overrides: Partial<Parameters<typeof createOpenRouterEngine>[0]> = {}) {
  const saved: Buffer[] = [];
  const saveImage = vi.fn((buf: Buffer) => {
    saved.push(buf);
    return `hash-${saved.length}`;
  });
  const fetchImpl =
    overrides.fetchImpl ?? (vi.fn(async () => okJson(imagePayload(PNG_B64))) as unknown as typeof fetch);
  const engine = createOpenRouterEngine({
    getKey: () => 'sk-or-test-key',
    saveImage,
    fetchImpl,
    ...overrides,
  });
  return { engine, saveImage, saved, fetchImpl: fetchImpl as ReturnType<typeof vi.fn> };
}

function genReq(partial: Partial<GenerateRequest> = {}): GenerateRequest {
  return { prompt: 'a red bird', brand, width: 1024, height: 768, count: 1, ...partial };
}

describe('capabilities', () => {
  it('reports the locked capability set', () => {
    const { engine } = makeEngine();
    expect(engine.capabilities()).toEqual({
      id: 'openrouter',
      displayName: 'OpenRouter (BYOK)',
      localOnly: false,
      supportsEdit: true,
      supportsMask: false,
      maxReferenceImages: 4,
    });
  });
});

describe('isAvailable', () => {
  it('is ok when getKey returns a non-empty key', async () => {
    const { engine } = makeEngine();
    await expect(engine.isAvailable()).resolves.toEqual({ ok: true });
  });

  it('is not ok when getKey returns null', async () => {
    const { engine } = makeEngine({ getKey: () => null });
    await expect(engine.isAvailable()).resolves.toEqual({
      ok: false,
      reason: 'Set an OpenRouter API key in Settings',
    });
  });

  it('is not ok when getKey returns an empty string', async () => {
    const { engine } = makeEngine({ getKey: () => '' });
    const res = await engine.isAvailable();
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('Set an OpenRouter API key in Settings');
  });
});

describe('costEstimate', () => {
  it('charges count * default 0.04 for generate', async () => {
    const { engine } = makeEngine();
    await expect(engine.costEstimate(genReq({ count: 3 }))).resolves.toBeCloseTo(0.12);
  });

  it('honors a custom costPerImageUsd', async () => {
    const { engine } = makeEngine({ costPerImageUsd: 0.1 });
    await expect(engine.costEstimate(genReq({ count: 2 }))).resolves.toBeCloseTo(0.2);
  });

  it('charges 1x for edit requests', async () => {
    const { engine } = makeEngine();
    const req: EditRequest = { instruction: 'make it blue', sourceImage: '/nope.png', brand };
    await expect(engine.costEstimate(req)).resolves.toBeCloseTo(0.04);
  });
});

describe('generate request shape', () => {
  it('POSTs the right URL, headers, and body', async () => {
    const { engine, fetchImpl } = makeEngine();
    await engine.generate(genReq({ prompt: 'hello world' }));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer sk-or-test-key');
    expect(init.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body);
    expect(body.model).toBe('google/gemini-2.5-flash-image');
    expect(body.modalities).toEqual(['image', 'text']);
    expect(body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hello world' }] }]);
  });

  it('uses opts.model when provided', async () => {
    const { engine, fetchImpl } = makeEngine({ model: 'openai/gpt-image-1' });
    await engine.generate(genReq());
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.model).toBe('openai/gpt-image-1');
  });

  it('inlines reference images as base64 data URLs', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scenri-or-'));
    const refPath = path.join(dir, 'ref.png');
    fs.writeFileSync(refPath, PNG_BYTES);
    try {
      const { engine, fetchImpl } = makeEngine();
      await engine.generate(genReq({ referenceImages: [refPath] }));
      const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
      // Each attached image is now bound to what it is. Sending N images with
      // no binding left the model to guess which one was the product.
      expect(body.messages[0].content).toEqual([
        {
          type: 'text',
          text: 'a red bird The attached image is a reference to match in composition, lighting and treatment.',
        },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG_B64}` } },
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes the abort signal through to fetch', async () => {
    const { engine, fetchImpl } = makeEngine();
    const controller = new AbortController();
    await engine.generate(genReq(), controller.signal);
    expect(fetchImpl.mock.calls[0][1].signal).toBe(controller.signal);
  });
});

describe('generate success parsing', () => {
  it('decodes data URLs, calls saveImage per image, and returns the hashes', async () => {
    const { engine, saveImage, saved } = makeEngine();
    const result = await engine.generate(genReq());
    expect(saveImage).toHaveBeenCalledTimes(1);
    expect(saved[0].equals(PNG_BYTES)).toBe(true);
    expect(result.images).toEqual(['hash-1']);
  });

  it('makes one sequential request per requested image', async () => {
    const { engine, fetchImpl, saveImage } = makeEngine();
    const result = await engine.generate(genReq({ count: 3 }));
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(saveImage).toHaveBeenCalledTimes(3);
    expect(result.images).toEqual(['hash-1', 'hash-2', 'hash-3']);
  });

  it('sums usage.cost across responses when present', async () => {
    const fetchImpl = vi.fn(async () => okJson(imagePayload(PNG_B64, 0.011))) as unknown as typeof fetch;
    const { engine } = makeEngine({ fetchImpl });
    const result = await engine.generate(genReq({ count: 2 }));
    expect(result.costUsd).toBeCloseTo(0.022);
  });

  it('falls back to count * costPerImageUsd when usage.cost is absent', async () => {
    const { engine } = makeEngine({ costPerImageUsd: 0.05 });
    const result = await engine.generate(genReq({ count: 2 }));
    expect(result.costUsd).toBeCloseTo(0.1);
  });
});

describe('HTTP and shape errors', () => {
  it('throws with status and body snippet on HTTP failure', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: { message: 'No auth credentials found' } }),
    })) as unknown as typeof fetch;
    const { engine } = makeEngine({ fetchImpl });
    await expect(engine.generate(genReq())).rejects.toThrow(/401.*No auth credentials found/s);
  });

  it('truncates long error bodies to 200 chars', async () => {
    const longBody = 'x'.repeat(500);
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => longBody,
    })) as unknown as typeof fetch;
    const { engine } = makeEngine({ fetchImpl });
    const err = await engine.generate(genReq()).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('500');
    expect((err as Error).message.length).toBeLessThanOrEqual(250);
  });

  it('throws a clear error when choices[0].message is missing', async () => {
    const fetchImpl = vi.fn(async () => okJson({ id: 'gen-123' })) as unknown as typeof fetch;
    const { engine } = makeEngine({ fetchImpl });
    await expect(engine.generate(genReq())).rejects.toThrow(/choices\[0\]\.message/);
  });

  it('throws a clear error when the message has no images', async () => {
    const fetchImpl = vi.fn(async () =>
      okJson({ choices: [{ message: { content: 'no images here' } }] }),
    ) as unknown as typeof fetch;
    const { engine } = makeEngine({ fetchImpl });
    await expect(engine.generate(genReq())).rejects.toThrow(/no images/i);
  });

  it('throws a clear error on non-JSON success bodies', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => '<html>oops</html>',
    })) as unknown as typeof fetch;
    const { engine } = makeEngine({ fetchImpl });
    await expect(engine.generate(genReq())).rejects.toThrow(/non-JSON/);
  });

  it('throws when no API key is set', async () => {
    const { engine } = makeEngine({ getKey: () => null });
    await expect(engine.generate(genReq())).rejects.toThrow(/API key/);
  });
});

describe('edit', () => {
  function withSourceImage<T>(fn: (sourcePath: string) => Promise<T>): Promise<T> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scenri-or-edit-'));
    const sourcePath = path.join(dir, 'source.png');
    fs.writeFileSync(sourcePath, PNG_BYTES);
    return fn(sourcePath).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
  }

  it('sends instruction text plus the source image as a data URL', async () => {
    await withSourceImage(async (sourcePath) => {
      const { engine, fetchImpl } = makeEngine();
      const req: EditRequest = { instruction: 'make it blue', sourceImage: sourcePath, brand };
      await engine.edit(req);

      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
      expect(init.headers.Authorization).toBe('Bearer sk-or-test-key');
      const body = JSON.parse(init.body);
      expect(body.modalities).toEqual(['image', 'text']);
      expect(body.messages[0].content).toEqual([
        { type: 'text', text: 'make it blue' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG_B64}` } },
      ]);
      // Given no size there is no shape to promise, and none is sent.
      expect(body.image_config).toBeUndefined();
    });
  });

  it('carries the requested shape when the edit states one', async () => {
    // Mirrors generate: an edit given no shape answered at whatever ratio the
    // model felt like, and the drift compounded down refine chains.
    await withSourceImage(async (sourcePath) => {
      const { engine, fetchImpl } = makeEngine();
      await engine.edit({ instruction: 'warmer', sourceImage: sourcePath, brand, width: 1024, height: 768 });
      const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
      expect(body.image_config).toEqual({ aspect_ratio: '4:3' });
    });
  });

  it('prefers editModel over model', async () => {
    await withSourceImage(async (sourcePath) => {
      const { engine, fetchImpl } = makeEngine({ model: 'a/base', editModel: 'b/editor' });
      await engine.edit({ instruction: 'crop it', sourceImage: sourcePath, brand });
      expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model).toBe('b/editor');
    });
  });

  it('returns a single saved hash and reported usage.cost', async () => {
    await withSourceImage(async (sourcePath) => {
      const fetchImpl = vi.fn(async () => okJson(imagePayload(PNG_B64, 0.03))) as unknown as typeof fetch;
      const { engine, saveImage, saved } = makeEngine({ fetchImpl });
      const result = await engine.edit({ instruction: 'sharpen', sourceImage: sourcePath, brand });
      expect(saveImage).toHaveBeenCalledTimes(1);
      expect(saved[0].equals(PNG_BYTES)).toBe(true);
      expect(result.images).toEqual(['hash-1']);
      expect(result.costUsd).toBeCloseTo(0.03);
    });
  });

  it('falls back to costPerImageUsd when usage.cost is absent', async () => {
    await withSourceImage(async (sourcePath) => {
      const { engine } = makeEngine({ costPerImageUsd: 0.07 });
      const result = await engine.edit({ instruction: 'sharpen', sourceImage: sourcePath, brand });
      expect(result.costUsd).toBeCloseTo(0.07);
    });
  });

  it('propagates HTTP errors with status and snippet', async () => {
    await withSourceImage(async (sourcePath) => {
      const fetchImpl = vi.fn(async () => ({
        ok: false,
        status: 429,
        text: async () => 'rate limited',
      })) as unknown as typeof fetch;
      const { engine } = makeEngine({ fetchImpl });
      await expect(engine.edit({ instruction: 'x', sourceImage: sourcePath, brand })).rejects.toThrow(
        /429.*rate limited/s,
      );
    });
  });
});

describe('aspect ratio', () => {
  // Asking for a shape in prose does not work on this API: it answers with a
  // square, and the server's delivered-image check then rejects it. Every
  // non-square brief failed this way, so the ratio has to travel as a field.
  const bodyOf = (fetchImpl: ReturnType<typeof vi.fn>) => JSON.parse(fetchImpl.mock.calls[0][1].body as string);

  it("carries Scenri's four formats through as exact ratios", async () => {
    for (const [width, height, ratio] of [
      [1024, 1024, '1:1'],
      [1024, 1280, '4:5'],
      [1024, 1820, '9:16'],
      [1820, 1024, '16:9'],
    ] as [number, number, string][]) {
      const { engine, fetchImpl } = makeEngine();
      await engine.generate(genReq({ width, height }));
      expect(bodyOf(fetchImpl).image_config).toEqual({ aspect_ratio: ratio });
    }
  });

  it('snaps an odd request to the nearest shape the API accepts', async () => {
    const { engine, fetchImpl } = makeEngine();
    await engine.generate(genReq({ width: 1024, height: 768 }));
    expect(bodyOf(fetchImpl).image_config).toEqual({ aspect_ratio: '4:3' });
  });
});

describe('edit — references', () => {
  it('attaches every reference and names what each one is for', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'or-edit-'));
    const src = path.join(dir, 'src.png');
    const prod = path.join(dir, 'prod.png');
    const face = path.join(dir, 'face.png');
    for (const f of [src, prod, face]) fs.writeFileSync(f, PNG_BYTES);

    const { engine, fetchImpl } = makeEngine();
    const req: EditRequest = {
      instruction: 'remove the text',
      sourceImage: src,
      brand,
      referenceImages: [prod, face],
      referenceRoles: ['product', 'character'],
    };
    await engine.edit(req);

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    const parts = body.messages[0].content;
    // source image first, then the two references
    expect(parts.filter((p: any) => p.type === 'image_url')).toHaveLength(3);
    const text = parts[0].text as string;
    expect(text).toContain('Attached image 1 is the image to edit');
    expect(text).toContain('Attached image 2 is the exact product');
    expect(text).toContain('Attached image 3 is the exact person');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('says nothing about references when there are none', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'or-edit-'));
    const src = path.join(dir, 'src.png');
    fs.writeFileSync(src, PNG_BYTES);
    const { engine, fetchImpl } = makeEngine();
    await engine.edit({ instruction: 'brighten it', sourceImage: src, brand });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.messages[0].content[0].text).toBe('brighten it');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
