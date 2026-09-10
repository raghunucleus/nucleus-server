import { Injectable } from '@nestjs/common';
import type { Namespace, Server } from 'socket.io';
import { sessionRoom } from './session.constants';

/**
 * The seam between session revocation and the websocket gateways.
 *
 * Sockets authenticate at handshake only and are never re-validated, so a
 * killed session's sockets must be disconnected explicitly. The gateways
 * (student chat, student notifications, employee notifications) each
 * `register` their namespace server in `afterInit` and join every socket to
 * `session:<sid>` at handshake; a kill then targets that room on each
 * registered namespace. The Redis socket.io adapter fans the room operation
 * across instances, so registering only the local handles is enough.
 *
 * Living in the global AuthSessionsModule keeps the dependency arrow one-way —
 * the sessions service never imports a gateway.
 */
@Injectable()
export class SessionSocketRegistry {
  private readonly servers: Array<Server | Namespace> = [];

  register(server: Server | Namespace): void {
    this.servers.push(server);
  }

  /** Best-effort: disconnect every socket of one session, everywhere. */
  disconnectSession(sid: string): void {
    for (const server of this.servers) {
      server.in(sessionRoom(sid)).disconnectSockets(true);
    }
  }
}
