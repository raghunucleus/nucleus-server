import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { join } from 'path';
import { AdminModule } from './admin/admin.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { FakeDelayMiddleware } from './common/middleware/fake-delay.middleware';
import { EmployeeModule } from './employee/employee.module';
import { GuardianModule } from './guardian/guardian.module';
import { HealthModule } from './health/health.module';
import { MailModule } from './mail/mail.module';
import { RbacModule } from './rbac/rbac.module';
import { RedisModule } from './redis/redis.module';
import { RequestsModule } from './requests/requests.module';
import { StorageModule } from './storage/storage.module';
import { StudentModule } from './student/student.module';
import { StudentNotificationModule } from './student/notification/student-notification.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
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
    StudentNotificationModule,
    GuardianModule,
    EmployeeModule,
    RbacModule,
    RequestsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Inject artificial latency on every route, but only in dev so the
    // front-ends can exercise their loading states. No-op everywhere else.
    if (process.env.NODE_ENV === 'dev') {
      consumer.apply(FakeDelayMiddleware).forRoutes('*');
    }
  }
}
