import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AcademicHoliday } from '../admin/entities/academic-holiday.entity';
import { HolidaysReadService } from './holidays-read.service';

/**
 * Read-only academic-calendar layer shared by the student and employee
 * surfaces. Kept separate from the admin module (which owns holiday writes)
 * so consumers pull in only the calendar reads.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AcademicHoliday])],
  providers: [HolidaysReadService],
  exports: [HolidaysReadService],
})
export class HolidaysReadModule {}
