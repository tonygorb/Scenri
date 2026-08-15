#!/usr/bin/env node
/**
 * The bin. Everything heavy (fastify, better-sqlite3, sharp) lives behind
 * dynamic imports so the dispatcher — and later the launcher — stays a
 * few-KB chunk of node builtins that loads instantly and cannot break when a
 * native module does.
 */
import { parseArgs, helpText } from './args.js';

const command = parseArgs(process.argv.slice(2));

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
  case 'update':
    // Arrives with the launcher (update staging). Present in --help so the
    // name is settled; honest about not existing yet.
    console.error('scenri update is not part of this build yet');
    process.exit(1);
    break;
  case 'launch':
    // The supervising launcher arrives in a later change; until then the
    // default command serves directly, exactly as it always has.
    await (await import('./serve.js')).serve();
    break;
}
