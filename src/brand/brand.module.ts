import { Module } from '@nestjs/common';
import { BrandController } from './brand.controller';

/** Serves the generated Nucleus logo assets under /brand/* (see brand.controller.ts). */
@Module({
  controllers: [BrandController],
})
export class BrandModule {}
