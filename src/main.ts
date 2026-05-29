import { BadRequestException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger, LoggerErrorInterceptor } from 'nestjs-pino';
import { createZodValidationPipe, cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './redis/redis-io.adapter';

// nestjs-zod's default validation exception reports a generic
// "Validation failed" message and tucks the real Zod issues into a separate
// field that clients rarely read. This pipe folds the actual issue text into
// the `message` so the UI can show a useful reason.
const AppZodValidationPipe = createZodValidationPipe({
  createValidationException: (error: unknown) => {
    const issues =
      error && typeof error === 'object' && 'issues' in error
        ? (
            error as {
              issues?: Array<{
                path?: Array<string | number>;
                message?: string;
              }>;
            }
          ).issues
        : undefined;
    if (Array.isArray(issues) && issues.length > 0) {
      const message = issues
        .map((issue) => {
          const path = (issue.path ?? []).join('.');
          return path ? `${path}: ${issue.message}` : issue.message;
        })
        .filter(Boolean)
        .join('; ');
      if (message) return new BadRequestException(message);
    }
    return new BadRequestException('Validation failed');
  },
});

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.useGlobalInterceptors(new LoggerErrorInterceptor());
  app.enableShutdownHooks();
  app.useGlobalPipes(new AppZodValidationPipe());

  // The student/parent and employee front-ends run on a separate origin (Vite
  // dev server, or a static host in prod). In dev, reflect any origin so the
  // exact host (localhost / 127.0.0.1 / *.localhost / a LAN IP) doesn't matter;
  // outside dev, restrict to an explicit allowlist (override via CORS_ORIGINS).
  const isDev = process.env.NODE_ENV === 'dev';
  const corsOrigins = (
    process.env.CORS_ORIGINS ??
    'http://localhost:5000,http://app.localhost:5000,http://employee.localhost:5000'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: isDev ? true : corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Default Nest/body-parser limit is ~100 KB, which the bulk-upload
  // endpoints blow past easily (1000 student rows is ~300–500 KB of JSON).
  // 10 MB covers the documented row cap (1000) with generous headroom and
  // still trips well before any DoS-shaped payload becomes interesting.
  app.useBodyParser('json', { limit: '10mb' });
  app.useBodyParser('urlencoded', { limit: '10mb', extended: true });

  // Socket.IO transport for student chat, fanned out across instances via Redis
  // pub/sub. Idle on a single instance, but ready for horizontal scaling.
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Nucleus Server')
    .setDescription('Nucleus backend API')
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'admin-access-token',
    )
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'student-access-token',
    )
    .build();
  const document = cleanupOpenApiDoc(
    SwaggerModule.createDocument(app, swaggerConfig),
  );
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const PORT = process.env.PORT ?? 3000;
  await app.listen(PORT);
  logger.log(`Server is running on port ${PORT}`, 'Bootstrap');
  logger.log(`Swagger UI: http://localhost:${PORT}/docs`, 'Bootstrap');
}
bootstrap();
