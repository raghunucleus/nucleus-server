import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import { ServerOptions, Server } from 'socket.io';
import { REDIS_KEY_PREFIX } from './redis-namespace';
import { REDIS_CLIENT } from './redis.module';

/**
 * Socket.IO adapter backed by Redis pub/sub. This is the cross-instance fan-out
 * layer: an `emit` on one server instance is published to a Redis channel and
 * re-emitted on every other instance, so a recipient reaches their socket no
 * matter which node holds it. Only tiny, transient broadcast frames travel
 * through Redis — message bodies live in Postgres, never here.
 *
 * On a single instance the channels are effectively idle, but wiring it now
 * means scaling out later is zero code change.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger('RedisIoAdapter');
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(private readonly app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    // Reuse the app's configured Redis connection settings (host/port/password)
    // by duplicating the shared client into dedicated pub/sub connections — a
    // single connection cannot both subscribe and run normal commands.
    const base = this.app.get<Redis>(REDIS_CLIENT);
    const pubClient = base.duplicate();
    const subClient = base.duplicate();
    pubClient.on('error', (e) => this.logger.error(e.message));
    subClient.on('error', (e) => this.logger.error(e.message));
    // The adapter defaults to a bare `socket.io` channel prefix, and the Redis
    // instance is shared with central-server, which runs the same adapter on
    // the same default. Channels are not keys, so the client's `keyPrefix`
    // does not reach them (and pub/sub is not DB-scoped either) — this has to
    // be set explicitly, or a namespace name colliding with central's would
    // cross-deliver broadcasts between the two apps.
    this.adapterConstructor = createAdapter(pubClient, subClient, {
      key: `${REDIS_KEY_PREFIX}socket.io`,
    });
    this.logger.log('Socket.IO Redis pub/sub adapter ready');
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}
