import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { GetStudent } from '../auth/get-student.decorator';
import { RequirePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { StudentJwtAuthGuard } from '../auth/student-jwt-auth.guard';
import type { AuthenticatedStudent } from '../auth/student-jwt.strategy';
import {
  BirthdayPage,
  StudentBirthdaysService,
} from './student-birthdays.service';

const MAX_LIMIT = 100;

@ApiTags('student-birthdays')
@ApiBearerAuth('student-access-token')
@UseGuards(StudentJwtAuthGuard, RequirePasswordChangedGuard)
@Controller('student/birthdays')
export class StudentBirthdaysController {
  constructor(private readonly birthdays: StudentBirthdaysService) {}

  @Get()
  @ApiOperation({
    summary:
      "A page of the signed-in student's classmates' birthdays, ordered by " +
      "how soon they fall (today first). The cohort is locked to the caller's " +
      'own attendance group (from the JWT) so a student never sees another ' +
      'section. Paginated (limit/offset) for load-on-scroll; search (q) spans ' +
      'the whole roster. Birth year is never returned.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Page size (1–100, default 30).',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    description: 'Rows to skip (default 0).',
  })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'Search by name or roll number.',
  })
  list(
    @GetStudent() student: AuthenticatedStudent,
    @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('q') q?: string,
  ): Promise<BirthdayPage> {
    const trimmed = q?.trim();
    return this.birthdays.list(student.id, {
      limit: clamp(limit, 1, MAX_LIMIT),
      offset: Math.max(0, offset),
      q: trimmed ? trimmed : undefined,
    });
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}
