import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createReplicateEngine } from '../src/index.js';
import type { BrandContext, EditRequest, GenerateRequest } from '@scenri/core';

const brand: BrandContext = { brand: {}, assetPaths: {} };

function genReq(overrides: Partial<GenerateRequest> = {}): GenerateRequest {
  return {
    prompt: 'a red bicycle',
    brand,
    width: 1024,
    height: 1024,
    count: 2,
    ...overrides,
  };
}

const POLL = 'https://api.replicate.com/v1/predictions/p-poll';
const CANCEL = 'https://api.replicate.com/v1/predictions/p-poll/cancel';

interface MockResponseInit {
  ok?: boolean;
  status?: number;
  json?: unknown;
  text?: string;
  bytes?: Uint8Array;
}

function mockRes(init: MockResponseInit): Response {
  const { ok = true, status = 200, json, text, bytes } = init;
  return {
    ok,
    status,
    json: async () => json,
    text: async () => text ?? JSON.stringify(json ?? ''),
    arrayBuffer: async () => {
      const src = bytes ?? new Uint8Array();
      return src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength);
    },
  } as unknown as Response;
}

type FetchCall = { url: string; init?: RequestInit };

function recordingFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  // Parameters<typeof fetch> rather than RequestInfo: the latter is a DOM lib
  // type and this package compiles against Node types only.
  const impl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

function makeEngine(opts: {
  fetchImpl: typeof fetch;
  key?: string | null;
  saveImage?: (buf: Buffer) => string;
  model?: string;
  editModel?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}) {
  const saved: Buffer[] = [];
  const saveImage =
    opts.saveImage ??
    ((buf: Buffer) => {
      saved.push(buf);
      return `hash-${saved.length}`;
    });
  const engine = createReplicateEngine({
    getKey: () => (opts.key === undefined ? 'test-token' : opts.key),
    saveImage,
    fetchImpl: opts.fetchImpl,
    model: opts.model,
    editModel: opts.editModel,
    pollIntervalMs: opts.pollIntervalMs ?? 1,
    timeoutMs: opts.timeoutMs ?? 500,
  });
  return { engine, saved };
}

describe('capabilities', () => {
  it('reports the locked capability set', () => {
    const { engine } = makeEngine({ fetchImpl: recordingFetch(() => mockRes({})).impl });
    expect(engine.capabilities()).toEqual({
      id: 'replicate',
      displayName: 'Replicate (BYOK)',
      localOnly: false,
      supportsEdit: true,
      supportsMask: false,
      // bria/expand-image: an expansion is painted around the picture rather
      // than re-rendered from a sentence
      supportsOutpaint: true,
      maxReferenceImages: 0,
    });
  });
});

describe('isAvailable', () => {
  it('is ok when a key is present', async () => {
    const { engine } = makeEngine({ fetchImpl: recordingFetch(() => mockRes({})).impl, key: 'r8_abc' });
    await expect(engine.isAvailable()).resolves.toEqual({ ok: true });
  });

  it('is not ok when the key is null', async () => {
    const { engine } = makeEngine({ fetchImpl: recordingFetch(() => mockRes({})).impl, key: null });
    await expect(engine.isAvailable()).resolves.toEqual({
      ok: false,
      reason: 'Set a Replicate API token in Settings',
    });
  });

  it('is not ok when the key is empty', async () => {
    const { engine } = makeEngine({ fetchImpl: recordingFetch(() => mockRes({})).impl, key: '' });
    const res = await engine.isAvailable();
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('Set a Replicate API token in Settings');
  });
});

describe('costEstimate', () => {
  it('charges 0.003 per generated image', async () => {
    const { engine } = makeEngine({ fetchImpl: recordingFetch(() => mockRes({})).impl });
    await expect(engine.costEstimate(genReq({ count: 4 }))).resolves.toBeCloseTo(0.012);
  });

  it('charges a flat 0.04 for edits', async () => {
    const { engine } = makeEngine({ fetchImpl: recordingFetch(() => mockRes({})).impl });
    const editReq: EditRequest = { instruction: 'make it blue', sourceImage: '/x.png', brand };
    await expect(engine.costEstimate(editReq)).resolves.toBe(0.04);
  });
});

describe('generate', () => {
  it('sends the right URL, auth header, Prefer: wait and body', async () => {
    const png = new Uint8Array([137, 80, 78, 71]);
    const { impl, calls } = recordingFetch((url) => {
      if (url.endsWith('/predictions')) {
        return mockRes({ json: { status: 'succeeded', output: ['https://cdn.example/img1.png'] } });
      }
      return mockRes({ bytes: png });
    });
    const { engine } = makeEngine({ fetchImpl: impl, key: 'r8_secret' });

    await engine.generate(genReq({ width: 1920, height: 1080, count: 3 }));

    const create = calls[0];
    expect(create.url).toBe('https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions');
    expect(create.init?.method).toBe('POST');
    const headers = create.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer r8_secret');
    expect(headers.Prefer).toBe('wait');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(create.init?.body))).toEqual({
      input: { prompt: 'a red bicycle', num_outputs: 3, aspect_ratio: '16:9', output_format: 'png' },
    });
  });

  it('asks flux-schnell for a lossless png rather than its default webp', async () => {
    // Left alone, flux-schnell answers in webp at quality 80, a lossy frame the
    // server then re-encodes to png. A png arrives as delivered.
    const { impl, calls } = recordingFetch((url) =>
      url.endsWith('/predictions')
        ? mockRes({ json: { status: 'succeeded', output: 'https://cdn.example/one.png' } })
        : mockRes({ bytes: new Uint8Array([1]) }),
    );
    const { engine } = makeEngine({ fetchImpl: impl });
    await engine.generate(genReq());
    expect(JSON.parse(String(calls[0].init?.body)).input.output_format).toBe('png');
  });

  it('tells Replicate to stop the prediction itself at the adapter ceiling', async () => {
    // Cancel-After is measured from creation, so a prediction this process can
    // no longer cancel (it quit, or a Stop landed mid-create) still ends.
    const { impl, calls } = recordingFetch((url) =>
      url.endsWith('/predictions')
        ? mockRes({ json: { status: 'succeeded', output: 'https://cdn.example/one.png' } })
        : mockRes({ bytes: new Uint8Array([1]) }),
    );
    const engine = createReplicateEngine({ getKey: () => 'k', saveImage: () => 'h', fetchImpl: impl });
    await engine.generate(genReq({ count: 1 }));
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers['Cancel-After']).toBe('600s');
  });

  it('never sends a Cancel-After below the documented five second minimum', async () => {
    const { impl, calls } = recordingFetch((url) =>
      url.endsWith('/predictions')
        ? mockRes({ json: { status: 'succeeded', output: 'https://cdn.example/one.png' } })
        : mockRes({ bytes: new Uint8Array([1]) }),
    );
    const { engine } = makeEngine({ fetchImpl: impl, timeoutMs: 500 });
    await engine.generate(genReq({ count: 1 }));
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers['Cancel-After']).toBe('5s');
  });

  it('honors a custom model slug', async () => {
    const { impl, calls } = recordingFetch((url) =>
      url.endsWith('/predictions')
        ? mockRes({ json: { status: 'succeeded', output: 'https://cdn.example/one.png' } })
        : mockRes({ bytes: new Uint8Array([1]) }),
    );
    const { engine } = makeEngine({ fetchImpl: impl, model: 'acme/super-model' });
    await engine.generate(genReq());
    expect(calls[0].url).toBe('https://api.replicate.com/v1/models/acme/super-model/predictions');
  });

  it.each([
    // the eleven ratios black-forest-labs/flux-schnell documents
    [1024, 1024, '1:1'],
    [1920, 1080, '16:9'],
    [2016, 864, '21:9'],
    [1536, 1024, '3:2'],
    [1024, 1536, '2:3'],
    [1024, 1280, '4:5'],
    [1280, 1024, '5:4'],
    [1024, 1365, '3:4'],
    [1365, 1024, '4:3'],
    [1080, 1920, '9:16'],
    [864, 2016, '9:21'],
    // and near misses snap to the closest of them
    [1600, 1000, '3:2'], // 1.6 is nearer 3:2 than 16:9
    [950, 1000, '1:1'],
  ])('maps %dx%d to aspect_ratio %s', async (width, height, expected) => {
    const { impl, calls } = recordingFetch((url) =>
      url.endsWith('/predictions')
        ? mockRes({ json: { status: 'succeeded', output: 'https://cdn.example/one.png' } })
        : mockRes({ bytes: new Uint8Array([1]) }),
    );
    const { engine } = makeEngine({ fetchImpl: impl });
    await engine.generate(genReq({ width, height }));
    expect(JSON.parse(String(calls[0].init?.body)).input.aspect_ratio).toBe(expected);
  });

  it.each([
    [3072, 1024, '21:9'],
    [1024, 3072, '9:21'],
  ])('refuses %dx%d rather than silently returning %s', async (width, height, nearest) => {
    // A shape past every entry on the menu (3:1 is 22% off 21:9) would come back
    // as a different frame than the one asked for, so it fails before sending.
    const { impl, calls } = recordingFetch(() => mockRes({ json: { status: 'succeeded', output: 'x' } }));
    const { engine } = makeEngine({ fetchImpl: impl });
    await expect(engine.generate(genReq({ width, height }))).rejects.toThrow(
      new RegExp(`supports only .* silently returned as ${nearest}`, 's'),
    );
    expect(calls).toHaveLength(0);
  });

  it('saves each output image and returns hashes and cost', async () => {
    const bytes1 = new Uint8Array([1, 2, 3]);
    const bytes2 = new Uint8Array([4, 5, 6]);
    const { impl, calls } = recordingFetch((url) => {
      if (url.endsWith('/predictions')) {
        return mockRes({
          json: {
            status: 'succeeded',
            output: ['https://cdn.example/a.png', 'https://cdn.example/b.png'],
          },
        });
      }
      return mockRes({ bytes: url.endsWith('a.png') ? bytes1 : bytes2 });
    });
    const { engine, saved } = makeEngine({ fetchImpl: impl });

    const result = await engine.generate(genReq({ count: 2 }));

    expect(result.images).toEqual(['hash-1', 'hash-2']);
    expect(result.costUsd).toBeCloseTo(0.006);
    expect(saved).toHaveLength(2);
    expect([...saved[0]]).toEqual([1, 2, 3]);
    expect([...saved[1]]).toEqual([4, 5, 6]);
    // image downloads carry no auth header
    const imageCalls = calls.slice(1);
    expect(imageCalls).toHaveLength(2);
    for (const call of imageCalls) {
      const headers = (call.init?.headers ?? {}) as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
    }
  });

  it('accepts a single string output', async () => {
    const { impl } = recordingFetch((url) =>
      url.endsWith('/predictions')
        ? mockRes({ json: { status: 'succeeded', output: 'https://cdn.example/solo.png' } })
        : mockRes({ bytes: new Uint8Array([9]) }),
    );
    const { engine } = makeEngine({ fetchImpl: impl });
    const result = await engine.generate(genReq({ count: 1 }));
    expect(result.images).toEqual(['hash-1']);
  });

  it('polls urls.get with auth until succeeded', async () => {
    let polls = 0;
    const { impl, calls } = recordingFetch((url) => {
      if (url.endsWith('/predictions')) {
        return mockRes({
          json: { status: 'processing', urls: { get: 'https://api.replicate.com/v1/predictions/p1' } },
        });
      }
      if (url === 'https://api.replicate.com/v1/predictions/p1') {
        polls += 1;
        return polls < 3
          ? mockRes({ json: { status: 'processing', urls: { get: url } } })
          : mockRes({ json: { status: 'succeeded', output: ['https://cdn.example/done.png'] } });
      }
      return mockRes({ bytes: new Uint8Array([7]) });
    });
    const { engine } = makeEngine({ fetchImpl: impl, key: 'r8_poll' });

    const result = await engine.generate(genReq({ count: 1 }));

    expect(result.images).toEqual(['hash-1']);
    expect(polls).toBe(3);
    const pollCall = calls.find((c) => c.url === 'https://api.replicate.com/v1/predictions/p1');
    const headers = pollCall?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer r8_poll');
  });

  it('throws when polling reaches a failed status', async () => {
    const { impl } = recordingFetch((url) => {
      if (url.endsWith('/predictions')) {
        return mockRes({
          json: { status: 'starting', urls: { get: 'https://api.replicate.com/v1/predictions/p2' } },
        });
      }
      return mockRes({ json: { status: 'failed', error: 'NSFW content detected' } });
    });
    const { engine } = makeEngine({ fetchImpl: impl });
    await expect(engine.generate(genReq())).rejects.toThrow(/failed.*NSFW content detected/);
  });

  it('throws on timeout while still processing', async () => {
    const { impl } = recordingFetch((url) => {
      if (url.endsWith('/predictions')) {
        return mockRes({
          json: { status: 'processing', urls: { get: 'https://api.replicate.com/v1/predictions/p3' } },
        });
      }
      return mockRes({ json: { status: 'processing', urls: { get: url } } });
    });
    const { engine } = makeEngine({ fetchImpl: impl, pollIntervalMs: 1, timeoutMs: 20 });
    await expect(engine.generate(genReq())).rejects.toThrow(/timed out after 20ms/);
  });

  it('keeps polling past two minutes, up to its own ten minute ceiling', async () => {
    // It used to give up at 120s while the server's node budget runs ten
    // minutes, so a slow prediction that then succeeded was billed and thrown
    // away. Now the caller's signal ends the wait, with 600s as the backstop.
    vi.useFakeTimers();
    try {
      const start = Date.now();
      const { impl } = recordingFetch((url) => {
        if (url.endsWith('/predictions')) {
          return mockRes({ json: { id: 'p5', status: 'processing', urls: { get: POLL } } });
        }
        if (url === POLL) {
          return Date.now() - start < 300_000
            ? mockRes({ json: { status: 'processing' } })
            : mockRes({ json: { status: 'succeeded', output: ['https://cdn.example/slow.png'] } });
        }
        return mockRes({ bytes: new Uint8Array([5]) });
      });
      const engine = createReplicateEngine({
        getKey: () => 'k',
        saveImage: () => 'hash-slow',
        fetchImpl: impl,
        pollIntervalMs: 5_000,
      });
      const outcome = engine.generate(genReq({ count: 1 })).then(
        (r) => r,
        (e: Error) => e,
      );
      await vi.advanceTimersByTimeAsync(310_000);
      expect(await outcome).toMatchObject({ images: ['hash-slow'] });
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up at the ten minute ceiling and cancels the prediction', async () => {
    vi.useFakeTimers();
    try {
      const { impl, calls } = recordingFetch((url) =>
        url.endsWith('/predictions')
          ? mockRes({ json: { id: 'p6', status: 'processing', urls: { get: POLL, cancel: CANCEL } } })
          : mockRes({ json: { status: 'processing' } }),
      );
      const engine = createReplicateEngine({
        getKey: () => 'k',
        saveImage: () => 'h',
        fetchImpl: impl,
        pollIntervalMs: 5_000,
      });
      const outcome = engine.generate(genReq({ count: 1 })).then(
        (r) => r,
        (e: Error) => e,
      );
      await vi.advanceTimersByTimeAsync(610_000);
      const err = await outcome;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/timed out after 600000ms/);
      expect(calls.filter((c) => c.url === CANCEL)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels the prediction on Replicate when the caller aborts', async () => {
    // A Stop used to throw here and leave the prediction running, and billed.
    const ctrl = new AbortController();
    let polls = 0;
    const { impl, calls } = recordingFetch((url) => {
      if (url.endsWith('/predictions')) {
        return mockRes({ json: { id: 'p4', status: 'processing', urls: { get: POLL, cancel: CANCEL } } });
      }
      if (url === POLL) {
        polls += 1;
        if (polls === 2) ctrl.abort();
        return mockRes({ json: { status: 'processing' } });
      }
      return mockRes({ json: { status: 'canceled' } });
    });
    const { engine } = makeEngine({ fetchImpl: impl, key: 'r8_stop' });

    await expect(engine.generate(genReq(), ctrl.signal)).rejects.toThrow(/aborted/);

    const cancel = calls.find((c) => c.url === CANCEL);
    expect(cancel?.init?.method).toBe('POST');
    const headers = cancel?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer r8_stop');
    // not the caller's signal, which is already aborted and would kill the cancel itself
    expect(cancel?.init?.signal?.aborted).toBe(false);
  });

  it('cancels on the adapter deadline too', async () => {
    const { impl, calls } = recordingFetch((url) =>
      url.endsWith('/predictions')
        ? mockRes({ json: { id: 'p7', status: 'processing', urls: { get: POLL, cancel: CANCEL } } })
        : mockRes({ json: { status: 'processing' } }),
    );
    const { engine } = makeEngine({ fetchImpl: impl, pollIntervalMs: 1, timeoutMs: 20 });
    await expect(engine.generate(genReq())).rejects.toThrow(/timed out after 20ms/);
    expect(calls.filter((c) => c.url === CANCEL && c.init?.method === 'POST')).toHaveLength(1);
  });

  it('builds the documented cancel path from the id when urls.cancel is absent', async () => {
    const { impl, calls } = recordingFetch((url) =>
      url.endsWith('/predictions')
        ? mockRes({ json: { id: 'p9', status: 'processing', urls: { get: POLL } } })
        : mockRes({ json: { status: 'processing' } }),
    );
    const { engine } = makeEngine({ fetchImpl: impl, pollIntervalMs: 1, timeoutMs: 20 });
    await expect(engine.generate(genReq())).rejects.toThrow(/timed out/);
    expect(calls.some((c) => c.url === 'https://api.replicate.com/v1/predictions/p9/cancel')).toBe(true);
  });

  it('never lets a failing cancel mask the error that ended the wait', async () => {
    const ctrl = new AbortController();
    const { impl, calls } = recordingFetch((url) => {
      if (url.endsWith('/predictions')) {
        return mockRes({ json: { id: 'p8', status: 'processing', urls: { get: POLL, cancel: CANCEL } } });
      }
      if (url === CANCEL) throw new Error('network down');
      ctrl.abort();
      return mockRes({ json: { status: 'processing' } });
    });
    const { engine } = makeEngine({ fetchImpl: impl });
    await expect(engine.generate(genReq(), ctrl.signal)).rejects.toThrow(/aborted/);
    expect(calls.some((c) => c.url === CANCEL)).toBe(true);
  });

  it('does not cancel a prediction that already failed on its own', async () => {
    const { impl, calls } = recordingFetch((url) =>
      url.endsWith('/predictions')
        ? mockRes({ json: { id: 'p10', status: 'processing', urls: { get: POLL, cancel: CANCEL } } })
        : mockRes({ json: { status: 'failed', error: 'CUDA out of memory' } }),
    );
    const { engine } = makeEngine({ fetchImpl: impl });
    await expect(engine.generate(genReq())).rejects.toThrow(/failed.*CUDA/);
    expect(calls.some((c) => c.url === CANCEL)).toBe(false);
  });

  it('throws with status and body snippet on HTTP failure', async () => {
    const body = JSON.stringify({ detail: 'Invalid token.' }) + 'x'.repeat(500);
    const { impl } = recordingFetch(() => mockRes({ ok: false, status: 401, text: body }));
    const { engine } = makeEngine({ fetchImpl: impl });
    const err = await engine.generate(genReq()).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('401');
    expect((err as Error).message).toContain('Invalid token.');
    // snippet is capped at 200 chars (plus fixed prefix)
    expect((err as Error).message.length).toBeLessThan(300);
  });

  it('throws a clear error when output is missing', async () => {
    const { impl } = recordingFetch(() => mockRes({ json: { status: 'succeeded' } }));
    const { engine } = makeEngine({ fetchImpl: impl });
    await expect(engine.generate(genReq())).rejects.toThrow(/output/);
  });

  it('throws a clear error when status is odd and no poll URL exists', async () => {
    const { impl } = recordingFetch(() => mockRes({ json: { status: 'processing' } }));
    const { engine } = makeEngine({ fetchImpl: impl });
    await expect(engine.generate(genReq())).rejects.toThrow(/no polling URL/);
  });

  it('throws when no key is configured', async () => {
    const { impl, calls } = recordingFetch(() => mockRes({}));
    const { engine } = makeEngine({ fetchImpl: impl, key: null });
    await expect(engine.generate(genReq())).rejects.toThrow(/token/i);
    expect(calls).toHaveLength(0);
  });
});

describe('edit', () => {
  let dir: string;
  let sourceImage: string;
  const sourceBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'scenri-replicate-test-'));
    sourceImage = join(dir, 'source.png');
    await writeFile(sourceImage, sourceBytes);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function editReq(over: Partial<EditRequest> = {}): EditRequest {
    return { instruction: 'remove the background', sourceImage, brand, ...over };
  }

  it('sends an expansion to the outpainting model with the canvas it belongs in', async () => {
    const { impl, calls } = recordingFetch((url) =>
      url.endsWith('/predictions')
        ? mockRes({ json: { status: 'succeeded', output: ['https://cdn.example/wide.png'] } })
        : mockRes({ bytes: new Uint8Array([8]) }),
    );
    const { engine } = makeEngine({ fetchImpl: impl, key: 'r8_expand' });

    await engine.edit(
      editReq({
        instruction: '',
        width: 1824,
        height: 1024,
        expand: { left: 400, top: 0, width: 1024, height: 1024 },
        seed: 4242,
      }),
    );

    // the expansion model, not the instruction editor
    expect(calls[0].url).toContain('bria/expand-image');
    const input = JSON.parse(String(calls[0].init?.body)).input;
    expect(input.canvas_size).toEqual([1824, 1024]);
    expect(input.original_image_size).toEqual([1024, 1024]);
    expect(input.original_image_location).toEqual([400, 0]);
    // the same extend of the same shot comes back the same picture
    expect(input.seed).toBe(4242);
    // bria has no output format field; png stays a generate-only input
    expect(input.output_format).toBeUndefined();
  });

  it('still uses the instruction editor for an ordinary refinement', async () => {
    const { impl, calls } = recordingFetch((url) =>
      url.endsWith('/predictions')
        ? mockRes({ json: { status: 'succeeded', output: ['https://cdn.example/edited.png'] } })
        : mockRes({ bytes: new Uint8Array([8]) }),
    );
    const { engine } = makeEngine({ fetchImpl: impl, key: 'r8_plain' });
    await engine.edit(editReq());
    expect(calls[0].url).toContain('flux-kontext-pro');
  });

  it('POSTs to the edit model with instruction and base64 data URI', async () => {
    const { impl, calls } = recordingFetch((url) =>
      url.endsWith('/predictions')
        ? mockRes({ json: { status: 'succeeded', output: ['https://cdn.example/edited.png'] } })
        : mockRes({ bytes: new Uint8Array([8]) }),
    );
    const { engine } = makeEngine({ fetchImpl: impl, key: 'r8_edit' });

    const result = await engine.edit(editReq());

    const create = calls[0];
    expect(create.url).toBe('https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-pro/predictions');
    const headers = create.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer r8_edit');
    expect(headers.Prefer).toBe('wait');
    const body = JSON.parse(String(create.init?.body));
    expect(body.input.prompt).toBe('remove the background');
    expect(body.input.input_image).toBe(`data:image/png;base64,${sourceBytes.toString('base64')}`);
    // kontext-pro already answers in png
    expect(body.input.output_format).toBeUndefined();
    expect(headers['Cancel-After']).toBe('5s');
    expect(result.images).toEqual(['hash-1']);
    expect(result.costUsd).toBe(0.04);
  });

  it('honors a custom edit model slug', async () => {
    const { impl, calls } = recordingFetch((url) =>
      url.endsWith('/predictions')
        ? mockRes({ json: { status: 'succeeded', output: 'https://cdn.example/e2.png' } })
        : mockRes({ bytes: new Uint8Array([8]) }),
    );
    const { engine } = makeEngine({ fetchImpl: impl, editModel: 'acme/editor' });
    await engine.edit(editReq());
    expect(calls[0].url).toBe('https://api.replicate.com/v1/models/acme/editor/predictions');
  });

  it('propagates HTTP errors with status and snippet', async () => {
    const { impl } = recordingFetch(() =>
      mockRes({ ok: false, status: 422, text: '{"detail":"input_image is required"}' }),
    );
    const { engine } = makeEngine({ fetchImpl: impl });
    await expect(engine.edit(editReq())).rejects.toThrow(/422.*input_image is required/);
  });
});
