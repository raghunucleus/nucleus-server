import { BadRequestException, Logger as NestLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import helmet from 'helmet';
import { Logger, LoggerErrorInterceptor } from 'nestjs-pino';
import { createZodValidationPipe, cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module';
import { isDev, isProduction, nodeEnv } from './common/runtime-env';
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

  // Behind a reverse proxy, read the real client IP from X-Forwarded-For so
  // logs name the caller rather than the proxy. Opt-in: trusting XFF when NOT
  // behind a proxy lets any client spoof its own address.
  const trustProxy = (process.env.TRUST_PROXY ?? '').trim();
  if (trustProxy) {
    const hops = Number(trustProxy);
    app.set('trust proxy', Number.isInteger(hops) ? hops : trustProxy);
  }

  // CSP is off here deliberately: this API serves no HTML, and the portals ship
  // their own policy from their static host (see each UI's SECURITY-HEADERS.md).
  app.use(
    helmet({
      contentSecurityPolicy: false,
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: false },
      // Presigned S3 URLs are fetched cross-origin by the portals.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(compression());

  // The student/parent and employee front-ends run on a separate origin (Vite
  // dev server, or a static host in prod). In dev, reflect any origin so the
  // exact host (localhost / 127.0.0.1 / *.localhost / a LAN IP) doesn't matter;
  // outside dev, restrict to an explicit allowlist (override via CORS_ORIGINS).
  const corsOrigins = (
    process.env.CORS_ORIGINS ??
    'http://localhost:5000,http://app.localhost:5000,http://parent.localhost:5000,http://employee.localhost:5000'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: isDev() ? true : corsOrigins,
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

  // /docs publishes the complete API surface — every route, every DTO shape —
  // which is a free reconnaissance map for an attacker. Off in production unless
  // someone deliberately asks for it.
  const docsEnabled =
    !isProduction() || process.env.ENABLE_SWAGGER_IN_PRODUCTION === 'true';
  if (docsEnabled) {
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
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'guardian-access-token',
      )
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'employee-access-token',
      )
      .build();
    const document = cleanupOpenApiDoc(
      SwaggerModule.createDocument(app, swaggerConfig),
    );
    SwaggerModule.setup('docs', app, document, {
      customSiteTitle: 'Nucleus API',
      // Served by BrandController from the generated brand assets.
      customfavIcon: '/brand/favicon.svg',
      swaggerOptions: { persistAuthorization: true },
    });
    if (isProduction()) {
      logger.warn(
        'ENABLE_SWAGGER_IN_PRODUCTION=true — /docs is publicly exposing the full API surface.',
        'Bootstrap',
      );
    }
  }

  const PORT = process.env.PORT ?? 3000;
  await app.listen(PORT);
  logger.log(`Server is running on port ${PORT} (env: ${nodeEnv()})`, 'Bootstrap');
  if (docsEnabled) {
    logger.log(`Swagger UI: http://localhost:${PORT}/docs`, 'Bootstrap');
  }
}

// Without this, a failed boot (bad env, unreachable Redis) surfaces as an
// unhandled rejection with no message and, on older Node, exit code 0 — which
// reads to Docker as a clean shutdown rather than a crash to restart.
bootstrap().catch((err) => {
  new NestLogger('Bootstrap').error(
    `Failed to start: ${err instanceof Error ? err.message : String(err)}`,
    err instanceof Error ? err.stack : undefined,
  );
  process.exit(1);
});
