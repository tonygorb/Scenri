import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCore, type Core, type EngineAdapter } from '@scenri/core';
import { createDemoEngine } from '@scenri/engine-demo';
import { buildServer } from '../src/server.js';
import { hostnameOf, ACCESS_COOKIE } from '../src/access.js';
import type { FastifyInstance } from 'fastify';

let home: string;
let core: Core;

function registryWith(...adapters: EngineAdapter[]) {
  const byId = new Map(adapters.map((a) => [a.capabilities().id, a]));
  return { all: () => adapters, get: (id: string) => byId.get(id) ?? null };
}

const serve = (access?: Parameters<typeof buildServer>[0]['access']) =>
  buildServer({ core, engines: registryWith(createDemoEngine((b) => core.images.save(b))), access });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'bt-access-'));
  core = createCore(home);
});
afterEach(() => {
  core.close();
  rmSync(home, { recursive: true, force: true });
});

describe('hostnameOf', () => {
  it('strips the port', () => {
    expect(hostnameOf('127.0.0.1:4747')).toBe('127.0.0.1');
    expect(hostnameOf('localhost:4747')).toBe('localhost');
  });
  it('keeps a bare hostname', () => {
    expect(hostnameOf('localhost')).toBe('localhost');
  });
  it('unwraps bracketed IPv6', () => {
    expect(hostnameOf('[::1]:4747')).toBe('::1');
  });
  it('lowercases', () => {
    expect(hostnameOf('EVIL.Example:80')).toBe('evil.example');
  });
  it('returns null for nothing usable', () => {
    expect(hostnameOf(undefined)).toBeNull();
    expect(hostnameOf('   ')).toBeNull();
    expect(hostnameOf('[::1')).toBeNull();
  });
});

describe('host allowlist', () => {
  let app: FastifyInstance;
  afterEach(async () => await app.close());

  it('allows loopback names by default', async () => {
    app = serve();
    for (const host of ['127.0.0.1:4747', 'localhost:4747', '[::1]:4747']) {
      const res = await app.inject({ method: 'GET', url: '/api/brands', headers: { host } });
      expect(res.statusCode, host).toBe(200);
    }
  });

  it('rejects a foreign Host header, which is how DNS rebinding arrives', async () => {
    app = serve();
    const res = await app.inject({ method: 'GET', url: '/api/brands', headers: { host: 'evil.example:4747' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('forbidden host');
  });

  it('rejects 0.0.0.0, which browsers will load but the user never recognises', async () => {
    app = serve();
    const res = await app.inject({ method: 'GET', url: '/api/brands', headers: { host: '0.0.0.0:4747' } });
    expect(res.statusCode).toBe(403);
  });

  // A missing Host is covered by the hostnameOf unit tests above: inject always
  // substitutes its own default, and Node answers a HTTP/1.1 request with no
  // Host header itself, before Fastify sees it.

  it('allows a LAN address only when it was explicitly opted into', async () => {
    app = serve({ allowedHosts: ['192.168.1.20'] });
    const ok = await app.inject({ method: 'GET', url: '/api/brands', headers: { host: '192.168.1.20:4747' } });
    expect(ok.statusCode).toBe(200);
    const no = await app.inject({ method: 'GET', url: '/api/brands', headers: { host: '192.168.1.21:4747' } });
    expect(no.statusCode).toBe(403);
  });

  it('guards the SPA fallback too, not just /api', async () => {
    app = serve();
    const res = await app.inject({ method: 'GET', url: '/', headers: { host: 'evil.example' } });
    expect(res.statusCode).toBe(403);
  });
});

describe('LAN access token', () => {
  let app: FastifyInstance;
  const token = 'test-token-value';
  beforeEach(() => {
    app = serve({ allowedHosts: ['192.168.1.20'], token });
  });
  afterEach(async () => await app.close());

  const lan = (extra: Record<string, string> = {}) => ({ host: '192.168.1.20:4747', ...extra });

  it('rejects a request carrying no token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/brands', headers: lan() });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('access token required');
  });

  it('rejects a wrong token', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/brands?t=nope`, headers: lan() });
    expect(res.statusCode).toBe(403);
  });

  it('accepts the token in the query and hands back a cookie', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/brands?t=${token}`, headers: lan() });
    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie']).toContain(`${ACCESS_COOKIE}=${token}`);
    expect(res.headers['set-cookie']).toContain('HttpOnly');
  });

  it('accepts the cookie on later requests, so the token leaves the address bar', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/brands',
      headers: lan({ cookie: `${ACCESS_COOKIE}=${token}` }),
    });
    expect(res.statusCode).toBe(200);
  });

  it('accepts an x-access-token header', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/brands', headers: lan({ 'x-access-token': token }) });
    expect(res.statusCode).toBe(200);
  });

  it('still gates loopback once a token is in play', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/brands', headers: { host: '127.0.0.1:4747' } });
    expect(res.statusCode).toBe(403);
  });

  it('checks the host before the token, so a foreign host cannot brute-force', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/brands?t=${token}`, headers: { host: 'evil.example' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('forbidden host');
  });
});
