import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const PORT = process.env.PORT ?? 4000
  Logger.log(`Server is Running in PORT: ${PORT}`)
  await app.listen(PORT);
}
bootstrap();
