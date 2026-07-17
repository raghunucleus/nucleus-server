import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Student } from '../admin/entities/student.entity';
import { assertRegistryValid } from './registry/student-attributes';
import { StudentQueryService } from './student-query.service';

/**
 * Shared student query engine. No controllers of its own — the admin and
 * employee search endpoints (and future programmatic consumers like drive
 * eligibility) import this module and call StudentQueryService directly.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Student])],
  providers: [StudentQueryService],
  exports: [StudentQueryService],
})
export class StudentQueryModule {
  constructor() {
    // A malformed registry entry must fail startup, not emit bad SQL later.
    assertRegistryValid();
  }
}
