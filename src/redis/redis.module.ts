import { Global, Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { redisTlsOptions } from '../config/datastore-ssl';
import { REDIS_KEY_PREFIX } from './redis-namespace';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const logger = new Logger('Redis');
        const client = new Redis({
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get<string>('REDIS_PASSWORD'),
          // The instance is shared with central-server, which owns the bare
          // `admin:`/`employee:`/`rbac:`/... namespaces on the same DB 0. This
          // one option namespaces every command's keys, so no service builds
          // the prefix into its key strings — doing that would double it up.
          // It does NOT cover pub/sub channels or SCAN match patterns; see
          // `redis-namespace.ts`.
          keyPrefix: REDIS_KEY_PREFIX,
          // Undefined for a plaintext connection (dev); set when REDIS_TLS=true,
          // which ElastiCache requires with encryption-in-transit enabled.
          // RedisIoAdapter builds its pub/sub pair with `.duplicate()`, so the
          // Socket.IO fan-out inherits this automatically.
          tls: redisTlsOptions(),
          lazyConnect: false,
          maxRetriesPerRequest: 3,
        });
        client.on('error', (err) =>
          logger.error(err.message || 'Nothing to display'),
        );
        client.on('connect', () => logger.log('connected'));
        client.on('reconnecting', () => logger.warn('reconnecting'));
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
