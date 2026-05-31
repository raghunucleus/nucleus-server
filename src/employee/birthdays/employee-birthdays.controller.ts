import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RequireScreen } from '../../rbac/require-screen.decorator';
import { ScreenAccessGuard } from '../../rbac/screen-access.guard';
import { EmployeeJwtAuthGuard } from '../auth/employee-jwt-auth.guard';
import { GetEmployee } from '../auth/get-employee.decorator';
import { RequireEmployeePasswordChangedGuard } from '../auth/require-password-changed.guard';
import type { AuthenticatedEmployee } from '../auth/employee-jwt.strategy';
import {
  BirthdayPage,
  EmployeeBirthdaysService,
} from './employee-birthdays.service';

const SCREEN_KEY = 'employee.birthdays.view';
const MAX_LIMIT = 100;

/**
 * Birthdays of the signed-in employee's colleagues. The cohort is locked to the
 * caller's OWN department (derived server-side from the JWT), so an employee
 * never sees another department's roster — the screen has no attribute scope
 * because the department is intrinsically self-scoped, but it is still gated by
 * the RBAC screen so it only appears for roles granted `employee.birthdays.view`.
 */
@ApiTags('employee-birthdays')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/birthdays')
export class EmployeeBirthdaysController {
  constructor(private readonly birthdays: EmployeeBirthdaysService) {}

  @Get()
  @RequireScreen(SCREEN_KEY, 'view')
  @ApiOperation({
    summary:
      "A page of the signed-in employee's colleagues' birthdays, ordered by " +
      "how soon they fall (today first). The cohort is locked to the caller's " +
      'own department (from the JWT) so an employee never sees another ' +
      'department. Paginated (limit/offset) for load-on-scroll; search (q) ' +
      'spans the whole department. Birth year is never returned.',
  })
  @ApiQuery({ name: 'limit', required: false, description: 'Page size (1–100, default 30).' })
  @ApiQuery({ name: 'offset', required: false, description: 'Rows to skip (default 0).' })
  @ApiQuery({ name: 'q', required: false, description: 'Search by name or employee code.' })
  list(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('q') q?: string,
  ): Promise<BirthdayPage> {
    const trimmed = q?.trim();
    return this.birthdays.list(employee.id, {
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
