import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger, LoggerErrorInterceptor } from 'nestjs-pino';
import { ZodValidationPipe, cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.useGlobalInterceptors(new LoggerErrorInterceptor());
  app.enableShutdownHooks();
  app.useGlobalPipes(new ZodValidationPipe());

  // Default Nest/body-parser limit is ~100 KB, which the bulk-upload
  // endpoints blow past easily (1000 student rows is ~300–500 KB of JSON).
  // 10 MB covers the documented row cap (1000) with generous headroom and
  // still trips well before any DoS-shaped payload becomes interesting.
  app.useBodyParser('json', { limit: '10mb' });
  app.useBodyParser('urlencoded', { limit: '10mb', extended: true });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Nucleus Server')
    .setDescription('Nucleus backend API')
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'admin-access-token',
    )
    .build();
  const document = cleanupOpenApiDoc(
    SwaggerModule.createDocument(app, swaggerConfig),
  );
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const PORT = process.env.PORT ?? 4000;
  await app.listen(PORT);
  logger.log(`Server is running on port ${PORT}`, 'Bootstrap');
  logger.log(`Swagger UI: http://localhost:${PORT}/docs`, 'Bootstrap');
}
bootstrap();
