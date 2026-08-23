#!/usr/bin/env node
/**
 * The bin. Everything heavy (fastify, better-sqlite3, sharp) lives behind
 * dynamic imports so the dispatcher — and later the launcher — stays a
 * few-KB chunk of node builtins that loads instantly and cannot break when a
 * native module does.
 */
import { fileURLToPath } from 'node:url';
import { parseArgs, helpText } from './args.js';
import { bootErrorLines } from './bootError.js';
import { isBuiltEntry } from './builtEntry.js';

const command = parseArgs(process.argv.slice(2));

try {
  switch (command.cmd) {
    case 'version': {
      const { readMeta } = await import('./meta.js');
      console.log(readMeta().version);
      break;
    }
    case 'help':
      console.log(helpText());
      break;
    case 'error':
      console.error(command.message);
      process.exit(2);
      break;
    case 'verify':
      await (await import('./serve.js')).verify();
      break;
    case 'serve':
      await (await import('./serve.js')).serve();
      break;
    case 'update': {
      const { runUpdateCommand } = await import('./update/cli.js');
      process.exit(await runUpdateCommand(command));
      break;
    }
    case 'launch': {
      // The module's own path, not process.argv[1]: the loader realpaths it,
      // argv keeps the bin symlink, and the symlink path has no dist/ segment.
      const ownEntry = fileURLToPath(import.meta.url);
      // From a checkout (tsx, src/) there is nothing to supervise: pnpm dev and
      // the e2e webServer keep their exact old behaviour.
      if (!isBuiltEntry(ownEntry)) {
        await (await import('./serve.js')).serve();
        break;
      }
      const { runLauncher } = await import('./launcher.js');
      const { readMeta } = await import('./meta.js');
      const { defaultHome } = await import('./update/versionsDir.js');
      const meta = readMeta();
      process.exit(await runLauncher({ home: defaultHome(), pkg: meta.name, ownVersion: meta.version, ownEntry }));
      break;
    }
  }
} catch (err) {
  // Under npx this code runs in the supervised child with inherited stdio, and
  // the launcher passes the exit code through silently, so the message prints
  // exactly once.
  if (process.env.SCENRI_DEBUG === '1') throw err;
  console.error('');
  for (const line of bootErrorLines(err)) console.error(`  ${line}`);
  console.error('');
  process.exit(1);
}
