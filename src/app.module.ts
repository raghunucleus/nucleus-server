import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { join } from 'path';
import { AdminModule } from './admin/admin.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EmployeeModule } from './employee/employee.module';
import { HealthModule } from './health/health.module';
import { MailModule } from './mail/mail.module';
import { RbacModule } from './rbac/rbac.module';
import { RedisModule } from './redis/redis.module';
import { StorageModule } from './storage/storage.module';
import { StudentModule } from './student/student.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProd = config.get<string>('NODE_ENV') === 'production';
        return {
          pinoHttp: {
            level:
              config.get<string>('LOG_LEVEL') ?? (isProd ? 'info' : 'debug'),
            transport: isProd
              ? undefined
              : {
                  target: 'pino-pretty',
                  options: {
                    singleLine: true,
                    colorize: true,
                    translateTime: 'SYS:HH:MM:ss.l',
                    ignore: 'pid,hostname,req,res,responseTime',
                    messageFormat:
                      '[{context}] {msg} {req.method} {req.url} {res.statusCode} ({responseTime}ms)',
                  },
                },
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.body.password',
                'req.body.oldPassword',
                'req.body.newPassword',
                'req.body.refreshToken',
                'req.body.challengeToken',
                'req.body.code',
              ],
              censor: '***',
            },
            customProps: () => ({ context: 'HTTP' }),
            serializers: {
              req: (req) => ({
                method: req.method,
                url: req.url,
                remoteAddress: req.remoteAddress,
              }),
              res: (res) => ({ statusCode: res.statusCode }),
            },
          },
        };
      },
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('POSTGRES_HOST', 'localhost'),
        port: config.get<number>('POSTGRES_PORT', 5432),
        username: config.get<string>('POSTGRES_USER'),
        password: config.get<string>('POSTGRES_PASSWORD'),
        database: config.get<string>('POSTGRES_DB'),
        autoLoadEntities: true,
        synchronize: false,
        migrations: [join(__dirname, 'migrations', '*.{js,ts}')],
        migrationsTableName: 'migrations',
        migrationsRun: false,
      }),
    }),
    RedisModule,
    StorageModule,
    MailModule,
    HealthModule,
    AdminModule,
    StudentModule,
    EmployeeModule,
    RbacModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
