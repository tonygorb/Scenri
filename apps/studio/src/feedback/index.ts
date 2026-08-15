import { setApiErrorSink } from '../api.js';
import { installErrorHooks, recordError } from './errors.js';

/**
 * Contextual feedback, alpha builds only.
 *
 * Everything here sits behind `__SC_ALPHA__`, which the public build defines
 * as the literal `false`, so the bundler drops this module and everything it
 * reaches. Nothing runs, stores or transmits anything until a human presses
 * Send — these hooks only keep the last few failures in memory so that a
 * report filed right after one carries it.
 */
export function installFeedback(): void {
  if (!__SC_ALPHA__) return;

  installErrorHooks();

  // api.ts funnels ~70 methods through one `req`, so this is the whole HTTP
  // surface. The sink is null in the public build because nothing calls the
  // setter there.
  setApiErrorSink((e) => {
    recordError({ kind: 'api', message: e.message, status: e.status, method: e.method, url: e.url });
  });
}
