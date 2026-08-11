/**
 * Codex CLI engine adapter.
 *
 * Drives the user's locally-installed `codex` binary (their own session) to
 * generate/edit images in a temp workspace directory, then ingests any
 * out-*.png results into the content-addressed store via the injected
 * saveImage function.
 *
 * OSS-local only (ToS boundary): this adapter bridges the user's OWN local
 * Codex subscription session and must never run in hosted mode — hence
 * `localOnly: true`. See docs/STRATEGY.md §13.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { copyFile, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  EditRequest,
  EngineAdapter,
  EngineCapabilities,
  EngineResult,
  GenerateRequest,
  ReferenceRole,
} from '@scenri/core';

export interface CodexEngineOptions {
  saveImage: (buf: Buffer) => string;
  spawnImpl?: typeof nodeSpawn;
  timeoutMs?: number;
}

const NOT_AVAILABLE_REASON = 'Codex CLI not found or not signed in (run: codex login)';
const DEFAULT_TIMEOUT_MS = 300_000;

// One source of truth for what each reference role means, shared by the
// generate and edit paths so they can never drift apart. Module scope, not
// factory scope: the helpers that use these live after the adapter's `return`,
// where a `const` would never initialize.
const ROLE_DIRECTIVE: Record<ReferenceRole, string> = {
  product: 'the exact product — preserve its label, shape, colors and design faithfully; do not redesign it',
  character: 'the exact person — preserve their face, hair and build faithfully; do not restyle them',
  brand:
    'a brand reference for palette, type and mark treatment only — take no geometry, subject or composition from it',
  scene: 'a reference for the environment and light only — take no subject, product or person from it',
  composition:
    'a reference for framing, camera angle and pose only — take no subject, color, material or branding from it',
  style: 'a reference for overall treatment and mood only — take no composition, subject or product detail from it',
  reference: 'a reference to match in composition, lighting and treatment',
};
const EDIT_ROLE_DIRECTIVE: Record<ReferenceRole, string> = {
  product: 'the exact product: keep or restore its label, shape and design faithfully',
  character: 'the exact person: keep their face, hair and build faithfully',
  brand: 'a brand reference for palette and mark treatment only',
  scene: 'a reference for environment and light only',
  composition: 'a reference for framing and pose only',
  style: 'a reference for treatment and mood only',
  reference: 'a reference for composition, lighting and treatment only',
};

export function createCodexEngine(opts: CodexEngineOptions): EngineAdapter {
  const { saveImage } = opts;
  const spawnImpl = opts.spawnImpl ?? nodeSpawn;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  /** Run `codex <args>`, resolving on exit 0; kill + reject after timeoutMs. */
  function runCodex(args: string[], signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let child: ReturnType<typeof nodeSpawn>;
      try {
        child = spawnImpl('codex', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (err) {
        reject(new Error(`Failed to spawn codex: ${(err as Error).message}`));
        return;
      }

      let settled = false;
      let stderr = '';
      // codex streams its full transcript to stdout; it MUST be drained or the
      // 64KB pipe buffer fills and codex blocks forever (real hang, 2026-08-01).
      child.stdout?.on('data', () => {});
      child.stderr?.on('data', (d: Buffer | string) => {
        stderr += String(d);
      });

      const timer = setTimeout(() => {
        child.kill();
        finish(() => reject(new Error(`Codex CLI timed out after ${timeoutMs}ms`)));
      }, timeoutMs);

      const onAbort = () => {
        child.kill();
        finish(() => reject(new Error('Codex CLI run aborted')));
      };

      function finish(fn: () => void): void {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        fn();
      }

      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      child.on('error', (err: Error) => {
        finish(() => reject(new Error(`Failed to spawn codex: ${err.message}`)));
      });
      child.on('exit', (code: number | null) => {
        if (code === 0) {
          finish(resolve);
        } else {
          const snippet = stderr.trim().slice(0, 200);
          finish(() =>
            reject(new Error(`codex exited with code ${code ?? 'unknown'}${snippet ? `: ${snippet}` : ''}`)),
          );
        }
      });
    });
  }

  /** Read out-*.png from dir (numerically sorted), save each, return hashes. */
  async function collectImages(dir: string): Promise<string[]> {
    const entries = await readdir(dir);
    const outFiles = entries
      .filter((name) => /^out-.*\.png$/.test(name))
      .sort((a, b) => {
        const na = Number(/^out-(\d+)\.png$/.exec(a)?.[1] ?? NaN);
        const nb = Number(/^out-(\d+)\.png$/.exec(b)?.[1] ?? NaN);
        if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
        return a.localeCompare(b);
      });
    if (outFiles.length === 0) {
      throw new Error('Codex finished but produced no images');
    }
    const hashes: string[] = [];
    for (const name of outFiles) {
      hashes.push(saveImage(await readFile(join(dir, name))));
    }
    return hashes;
  }

  async function withWorkDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), 'scenri-codex-'));
    try {
      return await fn(dir);
    } finally {
      // Best-effort cleanup.
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return {
    capabilities(): EngineCapabilities {
      return {
        id: 'codex-cli',
        displayName: 'Codex CLI',
        localOnly: true, // OSS-local only — ToS boundary, see docs/STRATEGY.md §13
        supportsEdit: true,
        supportsMask: false,
        // The underlying `codex` binary's --image flag is genuinely variadic
        // ("-i, --image <FILE>...", re-confirmed via `codex exec --help`), so
        // this number is a product decision, not a binary constraint. It is
        // sized to hold a full identity payload without eviction:
        // PRODUCT_REF_MAX (3 angles) + CHARACTER_REF_MAX (2 views) + one
        // style reference = 6. Below this, compileBrief's role-priority clamp
        // starts dropping real identity information.
        maxReferenceImages: 6,
      };
    },

    isAvailable(): Promise<{ ok: boolean; reason?: string }> {
      return new Promise((resolve) => {
        let settled = false;
        const done = (r: { ok: boolean; reason?: string }) => {
          if (!settled) {
            settled = true;
            resolve(r);
          }
        };
        let child: ReturnType<typeof nodeSpawn>;
        try {
          child = spawnImpl('codex', ['--version']);
        } catch {
          done({ ok: false, reason: NOT_AVAILABLE_REASON });
          return;
        }
        child.on('error', () => done({ ok: false, reason: NOT_AVAILABLE_REASON }));
        child.on('exit', (code: number | null) => {
          done(code === 0 ? { ok: true } : { ok: false, reason: NOT_AVAILABLE_REASON });
        });
      });
    },

    async costEstimate(): Promise<number> {
      return 0; // billed on the user's own Codex subscription, never by us
    },

    async generate(req: GenerateRequest, signal?: AbortSignal): Promise<EngineResult> {
      // One codex exec per image, run concurrently (cap 3): a single serial
      // batch regularly blew the per-run timeout, and parallel runs make the
      // timeout apply per image instead of per batch.
      const count = Math.max(1, req.count);
      const refs = req.referenceImages ?? [];
      const roles = req.referenceRoles ?? refs.map(() => 'reference' as const);
      const jobs = Array.from(
        { length: count },
        (_, i) => async () =>
          withWorkDir(async (dir) => {
            const args = execArgs(dir, buildPrompt(req, i, roles));
            for (const [idx, ref] of refs.entries()) {
              const dest = join(dir, `ref-${idx}.png`);
              await copyFile(ref, dest);
              // --image is variadic; the = form binds exactly one value so the
              // positional prompt isn't swallowed as a second image path.
              args.splice(args.length - 1, 0, `--image=${dest}`);
            }
            await runCodex(args, signal);
            return collectImages(dir);
          }),
      );
      const results: string[][] = new Array(count);
      let next = 0;
      const workers = Array.from({ length: Math.min(3, count) }, async () => {
        while (next < count) {
          const i = next++;
          results[i] = await jobs[i]();
        }
      });
      await Promise.all(workers);
      return { images: results.flat(), costUsd: 0 };
    },

    async edit(req: EditRequest, signal?: AbortSignal): Promise<EngineResult> {
      return withWorkDir(async (dir) => {
        await copyFile(req.sourceImage, join(dir, 'input.png'));
        // Name each reference for what it actually is. Previously every
        // reference was copied to product.png and described as the product,
        // so an edit carrying a presenter's face told the model that face was
        // a product to preserve the "label, shape and design" of.
        const editRefs = req.referenceImages ?? [];
        const editRoles = req.referenceRoles ?? [];
        const refLines: string[] = [];
        for (let i = 0; i < editRefs.length; i++) {
          const role = editRoles[i] ?? 'product';
          const name = `${role}-${i + 1}.png`;
          await copyFile(editRefs[i], join(dir, name));
          refLines.push(`${name} shows ${EDIT_ROLE_DIRECTIVE[role]}`);
        }
        const promptText =
          `Edit input.png using your image generation/editing tool: ${req.instruction}.` +
          (refLines.length ? ` ${refLines.join('. ')}.` : '') +
          `${brandBlock(req)}` +
          ` Do not browse the web or explore files. Save the result in the current directory as out-1.png ` +
          `(you may run the commands needed to save and resize it). Nothing else.`;
        await runCodex(execArgs(dir, promptText), signal);
        const images = await collectImages(dir);
        return { images, costUsd: 0 };
      });
    },
  };

  /** Shared exec args: low reasoning — imagegen needs speed, not deliberation. */
  function execArgs(dir: string, promptText: string): string[] {
    return [
      'exec',
      '--skip-git-repo-check',
      '--sandbox',
      'workspace-write',
      '-c',
      'model_reasoning_effort="low"',
      '-C',
      dir,
      promptText,
    ];
  }

  // Wording matters: codex's imagegen skill needs shell access (cp/sips) to
  // place the file — forbid browsing/exploration, but NOT running commands.
  function buildPrompt(req: GenerateRequest, index: number, roles: ReferenceRole[]): string {
    const roleDirective = ROLE_DIRECTIVE;
    const refDirectives = roles
      .map((role, i) =>
        roles.length > 1
          ? `Attached image ${i + 1} is ${roleDirective[role]}.`
          : `The attached image is ${roleDirective[role]}.`,
      )
      .join(' ');
    return (
      `Generate one flawless, professional-grade image immediately using your image generation tool, ` +
      `${req.width}x${req.height}: ${req.prompt}.` +
      (refDirectives ? ` ${refDirectives}` : '') +
      `${brandBlock(req)}` +
      ` Do not browse the web or explore files. Save the image in the current directory as out-1.png ` +
      `(you may run the commands needed to save and resize it). Nothing else.` +
      (index > 0 ? ` (variant ${index + 1} — same brief, different composition)` : '')
    );
  }

  /** Distill the .brand kit into style directives so output stays on-brand. */
  function brandBlock(req: GenerateRequest | EditRequest): string {
    const b = (req.brand?.brand ?? {}) as any;
    const lines: string[] = [];
    const p = b.palette;
    const hexes = [p?.primary?.hex, p?.secondary?.hex, ...(p?.accent ?? []).map((a: any) => a?.hex)].filter(
      (h: unknown): h is string => typeof h === 'string',
    );
    if (hexes.length) lines.push(`brand colors ${hexes.join(', ')}`);
    if (b.imagery?.mood) lines.push(`mood: ${b.imagery.mood}`);
    if (b.imagery?.keywords?.length) lines.push(`style: ${b.imagery.keywords.join(', ')}`);
    if (b.imagery?.avoid?.length) lines.push(`avoid: ${b.imagery.avoid.join(', ')}`);
    if (b.meta?.tagline) lines.push(`brand feel: "${b.meta.tagline}"`);
    return lines.length ? ` Brand style — ${lines.join('; ')}.` : '';
  }
}
