import { Global, Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { redisTlsOptions } from '../config/datastore-ssl';

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
