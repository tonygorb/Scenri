#!/usr/bin/env node
/**
 * A codex the tests can really spawn. Selected by FAKE_CODEX_MODE:
 *   ok                    healthy: version, login status 0, exec writes out-1.png
 *   old-version           version prints 0.140.0
 *   logged-out            login status exits 1
 *   hang                  --version never exits (probe hang)
 *   exec-hang             healthy probe, exec never exits (cancel/timeout path)
 *   exec-fail-auth        exec fails with a not-logged-in stderr
 *   slow-then-write       exec chats on stderr, then writes out-1.png
 *   exec-writes-elsewhere exec writes into $CODEX_HOME/generated_images instead
 *   exec-announce-then-silent  exec prints one line, is silent for
 *                         FAKE_CODEX_SILENT_MS, then writes out-1.png and
 *                         exits 0 — the healthy image_gen round-trip shape
 *   exec-banner-then-hang exec prints one line, then never exits
 *   spawn-grandchild      exec spawns a hanging grandchild (pid to
 *                         FAKE_CODEX_CHILD_PID_FILE), prints, never exits
 * FAKE_CODEX_PID_FILE: where to record this process's pid, so a test can prove
 * the process is actually dead after a kill. FAKE_CODEX_VERSION overrides the
 * healthy version string.
 */
const fs = require('node:fs');
const path = require('node:path');

const mode = process.env.FAKE_CODEX_MODE || 'ok';
const args = process.argv.slice(2);

if (process.env.FAKE_CODEX_PID_FILE) {
  fs.writeFileSync(process.env.FAKE_CODEX_PID_FILE, String(process.pid));
}

function hangForever() {
  setInterval(() => {}, 1 << 30);
}

function readPrompt() {
  const tail = args[args.length - 1];
  if (tail !== '-') return tail;
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  if (args[0] === '--version') {
    if (mode === 'hang') return hangForever();
    const v = mode === 'old-version' ? '0.140.0' : process.env.FAKE_CODEX_VERSION || '0.149.0';
    process.stdout.write(`codex-cli ${v}\n`);
    process.exit(0);
  }

  if (args[0] === 'login' && args[1] === 'status') {
    if (mode === 'logged-out') {
      process.stderr.write('Not logged in\n');
      process.exit(1);
    }
    process.stderr.write('Logged in using ChatGPT\n');
    process.exit(0);
  }

  if (args[0] === 'exec') {
    const cIdx = args.indexOf('-C');
    const dir = cIdx >= 0 ? args[cIdx + 1] : process.cwd();
    const prompt = readPrompt();

    if (mode === 'exec-fail-auth') {
      process.stderr.write('Not logged in\n');
      process.exit(1);
    }
    if (mode === 'hang' || mode === 'exec-hang') return hangForever();
    if (mode === 'exec-writes-elsewhere') {
      const home = process.env.CODEX_HOME || path.join(require('node:os').homedir(), '.codex');
      const out = path.join(home, 'generated_images');
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(
        path.join(out, `img-${Date.now()}.png`),
        Buffer.concat([Buffer.from('PNG'), Buffer.from(prompt)]),
      );
      process.exit(0);
    }
    const finish = () => {
      fs.writeFileSync(path.join(dir, 'out-1.png'), Buffer.concat([Buffer.from('PNG'), Buffer.from(prompt)]));
      process.exit(0);
    };
    if (mode === 'exec-banner-then-hang') {
      process.stdout.write('banner\n');
      return hangForever();
    }
    if (mode === 'exec-announce-then-silent') {
      process.stdout.write('tool call: image_gen\n');
      return setTimeout(finish, Number(process.env.FAKE_CODEX_SILENT_MS || 500));
    }
    if (mode === 'spawn-grandchild') {
      const kid = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(()=>{},1<<30)'], {
        stdio: 'ignore',
      });
      if (process.env.FAKE_CODEX_CHILD_PID_FILE) {
        fs.writeFileSync(process.env.FAKE_CODEX_CHILD_PID_FILE, String(kid.pid));
      }
      process.stdout.write('banner\n');
      return hangForever();
    }
    if (mode === 'slow-then-write') {
      let ticks = 0;
      const t = setInterval(() => {
        process.stderr.write('.');
        if (++ticks >= 5) {
          clearInterval(t);
          finish();
        }
      }, 100);
      return;
    }
    return finish();
  }

  process.stderr.write(`fake codex: unknown args ${args.join(' ')}\n`);
  process.exit(2);
}

main();
