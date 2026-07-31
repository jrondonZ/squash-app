import { createConsumer } from '@rails/actioncable';

import { CableTransport, type NetHandlers } from './transport';

/**
 * ActionCable wiring.
 *
 * In development the Vite dev server proxies `/cable` through to Rails, so a
 * relative URL works in both environments and there is no host to configure.
 */

const CABLE_URL = '/cable';

export interface OnlineSession {
  transport: CableTransport;
  /** Player index this browser controls. The host is always player one. */
  localPlayer: 0 | 1;
  close(): void;
}

export const connectToRoom = (
  code: string,
  role: 'host' | 'guest',
  handlers: NetHandlers,
): OnlineSession => {
  const consumer = createConsumer(CABLE_URL);
  const transport = new CableTransport(consumer, code, role, handlers);

  return {
    transport,
    localPlayer: role === 'host' ? 0 : 1,
    close: () => transport.close(),
  };
};
