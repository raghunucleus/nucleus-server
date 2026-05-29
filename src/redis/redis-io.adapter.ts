import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import { ServerOptions, Server } from 'socket.io';
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
    this.adapterConstructor = createAdapter(pubClient, subClient);
    this.logger.log('Socket.IO Redis pub/sub adapter ready');
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}
