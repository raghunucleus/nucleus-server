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
} from '../auth-sessions/auth-sessions.service';
import { GetStudent } from './auth/get-student.decorator';
import { RequirePasswordChangedGuard } from './auth/require-password-changed.guard';
import { StudentJwtAuthGuard } from './auth/student-jwt-auth.guard';
import type { AuthenticatedStudent } from './auth/student-jwt.strategy';

/**
 * "My devices" for a student: where they are signed in, and signing one out.
 * The student is always the token's — the `:id` is a session id, looked up
 * scoped to that student, so another student's session is indistinguishable
 * from an unknown one (404). No IP in the rows; that is admin-only.
 */
@ApiTags('student-sessions')
@ApiBearerAuth('student-access-token')
@UseGuards(StudentJwtAuthGuard, RequirePasswordChangedGuard)
@Controller('student/sessions')
export class StudentSessionsController {
  constructor(private readonly sessions: AuthSessionsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Devices this student is signed in on, most recently active first; ' +
      '`current` marks the calling device.',
  })
  list(@GetStudent() s: AuthenticatedStudent): Promise<SessionRow[]> {
    return this.sessions.list('student', s.id, { currentSid: s.sid });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Sign one of your devices out. Signing out the current device ends ' +
      'this session too.',
  })
  async revoke(
    @GetStudent() s: AuthenticatedStudent,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    const ok = await this.sessions.revokeById('student', s.id, id, 'user');
    if (!ok) throw new NotFoundException('Session not found');
  }
}
