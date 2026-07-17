import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { StudentJwtAuthGuard } from '../auth/student-jwt-auth.guard';
import { StudentLookupsService } from './student-lookups.service';

class ListStatesQueryDto extends createZodDto(
  z.object({ country_id: z.coerce.number().int().positive().optional() }),
) {}

class ListDistrictsQueryDto extends createZodDto(
  z.object({ state_id: z.coerce.number().int().positive().optional() }),
) {}

/**
 * Dropdown options for the student profile forms — active rows of the
 * admin-managed master lists, id+name only. Read-only; no per-student data, so
 * no scoping beyond authentication.
 */
@ApiTags('student-lookups')
@ApiBearerAuth('student-access-token')
@UseGuards(StudentJwtAuthGuard, RequirePasswordChangedGuard)
@Controller('student/lookups')
export class StudentLookupsController {
  constructor(private readonly lookups: StudentLookupsService) {}

  @Get('countries')
  @ApiOperation({ summary: 'Active countries.' })
  countries() {
    return this.lookups.listCountries();
  }

  @Get('states')
  @ApiOperation({
    summary: 'Active states (whole chain active), optionally per country.',
  })
  states(@Query() q: ListStatesQueryDto) {
    return this.lookups.listStates(q.country_id);
  }

  @Get('districts')
  @ApiOperation({
    summary: 'Active districts (whole chain active), optionally per state.',
  })
  districts(@Query() q: ListDistrictsQueryDto) {
    return this.lookups.listDistricts(q.state_id);
  }

  @Get('entrance-exams')
  @ApiOperation({ summary: 'Active entrance exams.' })
  entranceExams() {
    return this.lookups.listEntranceExams();
  }

  @Get('industry-certifications')
  @ApiOperation({ summary: 'Active industry certifications.' })
  industryCertifications() {
    return this.lookups.listIndustryCertifications();
  }

  @Get('school-boards-x')
  @ApiOperation({ summary: 'Active 10th boards.' })
  schoolBoardsX() {
    return this.lookups.listSchoolBoardsX();
  }

  @Get('school-boards-xii')
  @ApiOperation({ summary: 'Active 12th boards.' })
  schoolBoardsXii() {
    return this.lookups.listSchoolBoardsXii();
  }

  @Get('diploma-boards')
  @ApiOperation({ summary: 'Active diploma boards.' })
  diplomaBoards() {
    return this.lookups.listDiplomaBoards();
  }
}
