/**
 * Codex CLI engine adapter.
 *
 * Drives the user's locally-installed `codex` binary (their own session) to
 * generate/edit images in a temp workspace directory, then ingests any
 * out-*.png results into the content-addressed store via the injected
 * saveImage function.
 *
 * OSS-local only (ToS boundary): this adapter drives the user's OWN local
 * Codex session on their OWN machine, which is what that session is licensed
 * for. It must never run in a hosted service on someone else's behalf — hence
 * `localOnly: true`.
 */
import { copyFile, readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  EDIT_REFERENCE_ROLE_DIRECTIVE,
  REFERENCE_ROLE_DIRECTIVE,
  type EditRequest,
  type EngineAdapter,
  type EngineAvailability,
  type EngineCapabilities,
  type EngineResult,
  type GenerateRequest,
  type ReferenceRole,
} from '@scenri/core';
import { DEFAULT_TIMEOUT_MS, createRunner, execArgs, type CodexRunner, type RunnerOptions } from './run.js';

export { createCodexAnalyzer } from './analyzer.js';
export { createCodexSetup, INSTALL_COMMAND, type CodexSetup, type CodexSetupState } from './setup.js';
export type { AnalyzeRequest, CodexAnalyzer, PresenterDraft, SceneDraft } from './analyzer.js';
export { createRunner, type CodexRunner } from './run.js';

/**
 * How many execs one node runs at once. Two halves the upload contention of
 * the old pool of three while a four-variant batch still takes the same two
 * waves; one would double typical batch latency for no reliability gain.
 */
export const CODEX_POOL = 2;

/**
 * The overall bound a codex generation node legally needs: its waves of
 * per-exec hard cap, plus a post-processing margin. The old flat ten-minute
 * node watchdog was arithmetically wrong for large batches — eight variants
 * are four waves of up to 300s each, 1200s of legitimate work.
 */
export function codexNodeBudgetMs(count: number): number {
  return Math.ceil(Math.max(1, count) / CODEX_POOL) * DEFAULT_TIMEOUT_MS + 60_000;
}

export interface CodexEngineOptions extends RunnerOptions {
  saveImage: (buf: Buffer) => string;
  /** The process-wide runner, so every caller shares one probe cache. */
  runner?: CodexRunner;
}

export function createCodexEngine(opts: CodexEngineOptions): EngineAdapter {
  const { saveImage } = opts;
  const platform = opts.platform ?? process.platform;
  const runner = opts.runner ?? createRunner(opts);
  const runCodex = runner.run;
  const withWorkDir = runner.withWorkDir;

  /**
   * Where codex's built-in image tool saves first, before the agent moves the
   * file into the workdir. That move is what the native Windows sandbox breaks
   * (openai/codex#34961), so on win32 this directory is the recovery source.
   */
  const generatedImagesDir = () => join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'generated_images');

  /** What generated_images held before a job ran; null on posix (no fallback). */
  async function snapshotGenerated(): Promise<Set<string> | null> {
    if (platform !== 'win32') return null;
    try {
      return new Set(await readdir(generatedImagesDir()));
    } catch {
      return new Set();
    }
  }

  /** Read out-*.png from dir (numerically sorted), save each, return hashes. */
  async function collectImages(dir: string, before: Set<string> | null = null): Promise<string[]> {
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
      // win32 recovery: the exec succeeded but nothing reached the workdir.
      // Claim the newest file that appeared in generated_images during this
      // job — one job, one image, newest first. Known imperfection: two nodes
      // generating at the same moment could cross-attribute a recovered image;
      // accepted for a single-user local app over forking CODEX_HOME per job,
      // which would break auth.
      if (before) {
        const recovered = await recoverFromGenerated(before);
        if (recovered) return [recovered];
      }
      throw new Error('Codex finished but produced no images');
    }
    const hashes: string[] = [];
    for (const name of outFiles) {
      hashes.push(saveImage(await readFile(join(dir, name))));
    }
    return hashes;
  }

  async function recoverFromGenerated(before: Set<string>): Promise<string | null> {
    const home = generatedImagesDir();
    let names: string[];
    try {
      names = (await readdir(home)).filter((n) => !before.has(n));
    } catch {
      return null;
    }
    if (!names.length) return null;
    const stamped = await Promise.all(names.map(async (n) => ({ n, mtime: (await stat(join(home, n))).mtimeMs })));
    stamped.sort((a, b) => b.mtime - a.mtime);
    const pick = stamped[0].n;
    console.warn(`codex: workdir empty, recovered ${pick} from ${home}`);
    return saveImage(await readFile(join(home, pick)));
  }

  return {
    capabilities(): EngineCapabilities {
      return {
        id: 'codex-cli',
        displayName: 'Codex CLI',
        localOnly: true, // OSS-local only: the user's own session, on the user's own machine
        supportsEdit: true,
        supportsMask: false,
        /*
         * Five, and it is a hard constraint of the image tool, not a product
         * choice.
         *
         * The `codex` binary's --image flag really is variadic, which is why
         * this used to be 6 — one style reference on top of PRODUCT_REF_MAX (3)
         * plus CHARACTER_REF_MAX (2). But the flag only puts pictures into the
         * conversation; the thing that consumes them is codex's built-in
         * image_gen tool, and that caps at five either way it is called:
         * `referenced_image_paths` longer than five is a hard tool error, and
         * `num_last_images_to_include` is validated to 1..=5
         * (codex-rs/ext/image-generation/src/tool.rs, MAX_EDIT_IMAGES = 5).
         *
         * Six was therefore not a generous budget, it was an eviction. On the
         * context route `recent_images` walks the history BACKWARDS and keeps
         * the last five, so the sixth image to be dropped is the FIRST one
         * attached — and on an edit the first one attached is `input.png`, the
         * shot being edited. A refine carrying a full identity payload was
         * silently editing nothing at all.
         */
        maxReferenceImages: 5,
        /*
         * The longest edge a reference is worth sending at. codex's image_gen
         * reads references at reduced resolution server-side either way, but
         * the bytes still ride the user's uplink inside the exec's own time
         * budget — a full-resolution phone-photo PNG is tens of megabytes that
         * buy nothing. Same cap as brand marks (MARK_MAX_EDGE).
         */
        maxReferenceEdge: 2048,
      };
    },

    isAvailable(): Promise<EngineAvailability> {
      return runner.probe();
    },

    async costEstimate(): Promise<number> {
      return 0; // billed on the user's own Codex subscription, never by us
    },

    async generate(req: GenerateRequest, signal?: AbortSignal): Promise<EngineResult> {
      // One codex exec per image, run concurrently (CODEX_POOL): each exec
      // carries its own timers, so the pool trades total batch latency
      // against upload contention — every worker uploads the same reference
      // set over the same uplink, and the more that run at once the closer
      // each one sails to its own hard cap.
      const count = Math.max(1, req.count);
      const refs = req.referenceImages ?? [];
      const roles = req.referenceRoles ?? refs.map(() => 'reference' as const);
      // Sibling jobs share this controller so one fatal setup failure (codex
      // signed out, binary gone) stops the batch at once instead of letting
      // every remaining variant run the same doomed five minutes.
      const inner = new AbortController();
      const onOuterAbort = () => inner.abort();
      if (signal?.aborted) inner.abort();
      else signal?.addEventListener('abort', onOuterAbort, { once: true });
      const jobs = Array.from(
        { length: count },
        (_, i) => async () =>
          withWorkDir(async (dir) => {
            const args = execArgs(dir);
            let refBytes = 0;
            for (const [idx, ref] of refs.entries()) {
              const dest = join(dir, `ref-${idx}.png`);
              await copyFile(ref, dest);
              refBytes += (await stat(dest)).size;
              // --image is variadic; the = form binds exactly one value so the
              // positional stdin marker isn't swallowed as a second image path.
              args.splice(args.length - 1, 0, `--image=${dest}`);
            }
            const before = await snapshotGenerated();
            await runCodex(args, inner.signal, {
              stdin: buildPrompt(req, i, roles),
              label: `gen v${i + 1}/${count} refs=${refs.length} refKB=${Math.round(refBytes / 1024)}`,
            });
            return collectImages(dir, before);
          }),
      );
      const results: string[][] = new Array(count);
      const failures: unknown[] = [];
      let fatal: unknown = null;
      let next = 0;
      try {
        const workers = Array.from({ length: Math.min(CODEX_POOL, count) }, async () => {
          while (next < count && !inner.signal.aborted) {
            const i = next++;
            try {
              results[i] = await jobs[i]();
            } catch (err) {
              // One variant failing used to reject the batch, so three finished
              // images were thrown away and left orphaned in the content store.
              // A cancel still has to propagate: the user asked for the stop.
              if (signal?.aborted) throw err;
              results[i] = [];
              failures.push(err);
              if (fatal == null && isFatalSetupError(err)) {
                fatal = err;
                inner.abort();
                // The world changed under the cached probe: the next
                // /api/engines and preflight must see it, not "Connected".
                runner.invalidateProbe();
              }
            }
          }
        });
        await Promise.all(workers);
      } finally {
        signal?.removeEventListener('abort', onOuterAbort);
      }
      // Walk the slots in request order and remember which slot each surviving
      // image came from. filter(Boolean).flat() used to compact the holes away,
      // so when variants 1 and 2 failed the run opened on an image whose own
      // prompt said "variant 3" with nothing anywhere recording the loss.
      const images: string[] = [];
      const variantIndexes: number[] = [];
      for (const [i, slot] of results.entries()) {
        for (const hash of slot ?? []) {
          images.push(hash);
          variantIndexes.push(i);
        }
      }
      // A fatal setup error is the reason whatever else happened around it;
      // otherwise, with nothing to keep, the first failure is the reason.
      if (!images.length && failures.length) throw fatal ?? failures[0];
      if (failures.length) {
        console.warn(
          `codex: ${failures.length} of ${count} variants failed, keeping ${images.length}: ${String((failures[0] as Error)?.message ?? failures[0])}`,
        );
        return {
          images,
          costUsd: 0,
          raw: {
            requested: count,
            variantIndexes,
            partialFailures: failures.map((f) => String((f as Error)?.message ?? f)),
          },
        };
      }
      return { images, costUsd: 0 };
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
          // An unnamed reference is not a product. Defaulting to one told the
          // model to preserve the "label, shape and design" of whatever it was,
          // which is the mistake the role system exists to prevent.
          const role = editRoles[i] ?? 'reference';
          const name = `${role}-${i + 1}.png`;
          await copyFile(editRefs[i], join(dir, name));
          refLines.push(`${name} shows ${EDIT_REFERENCE_ROLE_DIRECTIVE[role]}`);
        }
        const promptText =
          `Edit input.png using your image generation/editing tool: ${req.instruction}.` +
          (refLines.length ? ` ${refLines.join('. ')}.` : '') +
          ` Do not browse the web or explore files. Save the result in the current directory as out-1.png ` +
          `(you may run the commands needed to save and resize it).` +
          // sips is already licensed by the parenthesis above; an exact-size
          // answer lets the caller's compositing pass skip its rescale.
          (req.width && req.height ? ` Save the result at exactly ${req.width}x${req.height} pixels.` : '') +
          ` Nothing else.`;
        // Hand the pictures over the same way generate does. The edit path only
        // copied them into the working directory and named them in prose, so
        // whether the model ever looked at the source depended on the skill
        // going and finding the file. The source leads, because it is the shot.
        const args = execArgs(dir);
        for (const name of ['input.png', ...refLines.map((_, i) => `${editRoles[i] ?? 'reference'}-${i + 1}.png`)]) {
          args.splice(args.length - 1, 0, `--image=${join(dir, name)}`);
        }
        const before = await snapshotGenerated();
        try {
          await runCodex(args, signal, { stdin: promptText, label: `edit refs=${editRefs.length}` });
        } catch (err) {
          if (isFatalSetupError(err)) runner.invalidateProbe();
          throw err;
        }
        const images = await collectImages(dir, before);
        return { images, costUsd: 0 };
      });
    },
  };

  // Wording matters: codex's imagegen skill needs shell access (cp/sips) to
  // place the file — forbid browsing/exploration, but NOT running commands.
  /**
   * Errors that mean the machine, not this variant: the next variant would
   * fail identically, so the batch stops. Matched on our own thrown messages
   * plus codex's stable not-signed-in wording.
   */
  function isFatalSetupError(err: unknown): boolean {
    return /failed to spawn|ENOENT|not logged in|login required|401|unauthorized/i.test(
      String((err as Error)?.message ?? err),
    );
  }

  function buildPrompt(req: GenerateRequest, index: number, roles: ReferenceRole[]): string {
    const roleDirective = REFERENCE_ROLE_DIRECTIVE;
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
      ` Do not browse the web or explore files. Save the image in the current directory as out-1.png ` +
      `(you may run the commands needed to save and resize it). Nothing else.` +
      (index > 0 ? ` (variant ${index + 1} — same brief, different composition)` : '')
    );
  }
}
