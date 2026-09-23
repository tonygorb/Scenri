import type { FastifyInstance } from 'fastify';
import { fromThisComputer } from '../access.js';
import type { PhoneAccess } from '../network/phoneAccess.js';

/**
 * Settings' "Open on your phone" row. Read fresh on every ask, never cached by
 * the studio: the address follows whichever Wi-Fi this machine is on now.
 */
export function registerPhoneRoutes(app: FastifyInstance, deps: { phone: PhoneAccess }): void {
  const { phone } = deps;
  app.get('/api/phone', async (req) => phone.status(fromThisComputer(req)));

  /** Why a phone might not open it: asked only when the studio's help is showing. */
  app.get('/api/phone/help', async (req, reply) => {
    // only the computer running Scenri can act on its own firewall
    if (!fromThisComputer(req)) return reply.send({ firewall: 'unknown' });
    return reply.send({ firewall: await phone.firewall() });
  });
}
