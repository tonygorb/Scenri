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

  /** Whether this computer's firewall would stop a phone: asked when the QR code opens. */
  app.get('/api/phone/help', async (req, reply) => {
    // only the computer running Scenri can act on its own firewall
    if (!fromThisComputer(req)) return reply.send({ firewall: 'unknown' });
    return reply.send({ firewall: await phone.firewall() });
  });

  /**
   * Allow was pressed. The operating system asks for a password or a UAC
   * yes, so only the person at this computer may start it, never a phone.
   */
  app.post('/api/phone/allow', async (req, reply) => {
    if (!fromThisComputer(req)) {
      return reply.status(403).send({ error: 'Change this on the computer running Scenri.' });
    }
    return reply.send(await phone.allow());
  });
}
