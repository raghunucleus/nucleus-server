import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import type { EmployeeAccessPayload } from '../auth/employee-auth.service';

/**
 * Realtime transport for employee notifications. Mirrors the student gateway:
 * auth happens once at the handshake against `JWT_EMPLOYEE_ACCESS_SECRET`, and
 * every connection joins the private room `employee:<id>` so an emit reaches
 * all of an employee's open devices across server instances (the Redis adapter
 * fans out).
 *
 * A separate namespace from `/student/notifications` with a separate secret:
 * a student token presented here fails verification and is disconnected, so the
 * two audiences can never cross over. The gateway only emits (server → client);
 * marking read happens over REST.
 */
@WebSocketGateway({
  namespace: '/employee/notifications',
  cors: { origin: true, credentials: true },
})
export class EmployeeNotificationsGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger('EmployeeNotificationsGateway');

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = this.extractToken(client);
      const payload = this.jwt.verify<EmployeeAccessPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_EMPLOYEE_ACCESS_SECRET'),
      });
      // An employee mid-password-reset must not receive notifications.
      if (payload.mcp) throw new Error('password change pending');
      client.data.employeeId = payload.sub;
      await client.join(this.room(payload.sub));
    } catch {
      client.disconnect(true);
    }
  }

  /** Emit an event to all of an employee's open notification sockets. */
  emitToEmployee(employeeId: number, event: string, payload: unknown): void {
    this.server.to(this.room(employeeId)).emit(event, payload);
  }

  private room(employeeId: number): string {
    return `employee:${employeeId}`;
  }

  private extractToken(client: Socket): string {
    const fromAuth = client.handshake.auth?.token as string | undefined;
    const fromHeader = client.handshake.headers?.authorization;
    const raw = fromAuth ?? fromHeader;
    if (!raw) throw new Error('missing token');
    return String(raw).replace(/^Bearer\s+/i, '');
  }
}
