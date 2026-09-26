import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCore } from '@scenri/core';
import type { ExampleJob } from '../src/sceneExamples.js';
import { STUDIO_WORK_FINISHED, listStudioWork } from '../src/studioWork.js';

const job = (i: number, status: ExampleJob['status']): ExampleJob =>
  ({
    id: `j${i}`,
    brandId: 'b1',
    sceneId: `us-${i}`,
    name: `Scene ${i}`,
    status,
    roles: ['hero'],
    done: status === 'done' ? ['hero'] : [],
    failed: [],
    current: status === 'running' ? 'hero' : null,
    from: 'asset:0123456789abcdef0123456789abcdef',
    startedAt: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(),
    finishedAt: status === 'running' ? null : new Date(Date.UTC(2026, 8, 1, 0, i, 30)).toISOString(),
    error: null,
  }) as unknown as ExampleJob;

describe('the studio work the bell is handed', () => {
  it('carries everything running and only the newest of what finished', () => {
    const home = mkdtempSync(join(tmpdir(), 'scenri-studiowork-'));
    const core = createCore(home);
    try {
      // the oldest job is still running: it stays whatever finished after it
      const jobs = [job(0, 'running'), ...Array.from({ length: 60 }, (_, i) => job(i + 1, 'done'))];
      const work = listStudioWork(core, 'b1', jobs);
      expect(work.filter((w) => w.status !== 'running')).toHaveLength(STUDIO_WORK_FINISHED);
      expect(work.some((w) => w.id === 'examples:j0' && w.status === 'running')).toBe(true);
      // newest first, so the finishes a person has not heard about yet are the ones kept
      expect(work[0].id).toBe('examples:j60');
    } finally {
      core.close();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
