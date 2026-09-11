import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthSessionsService,
  SessionRow,
} from '../../auth-sessions/auth-sessions.service';
import { EmployeeJwtAuthGuard } from './employee-jwt-auth.guard';
import type { AuthenticatedEmployee } from './employee-jwt.strategy';
import { GetEmployee } from './get-employee.decorator';
import { RequireEmployeePasswordChangedGuard } from './require-password-changed.guard';

/**
 * "My devices" for an employee: where they are signed in, and signing one out.
 *
 * No `@RequireScreen` here on purpose: this is the caller's OWN account, not
 * per-attribute institutional data, so there is nothing for RBAC to scope —
 * the same carve-out as the academic-holidays read (see nucleus-server
 * CLAUDE.md). The employee is always the token's; the `:id` is a session id
 * looked up scoped to that employee, so a foreign one is a 404.
 */
@ApiTags('employee-sessions')
@ApiBearerAuth('employee-access-token')
@UseGuards(EmployeeJwtAuthGuard, RequireEmployeePasswordChangedGuard)
@Controller('employee/sessions')
export class EmployeeSessionsController {
  constructor(private readonly sessions: AuthSessionsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Devices this employee is signed in on, most recently active first; ' +
      '`current` marks the calling device.',
  })
  list(@GetEmployee() e: AuthenticatedEmployee): Promise<SessionRow[]> {
    return this.sessions.list('employee', e.id, { currentSid: e.sid });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Sign one of your devices out. Signing out the current device ends ' +
      'this session too.',
  })
  async revoke(
    @GetEmployee() e: AuthenticatedEmployee,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    const ok = await this.sessions.revokeById('employee', e.id, id, 'user');
    if (!ok) throw new NotFoundException('Session not found');
  }
}
