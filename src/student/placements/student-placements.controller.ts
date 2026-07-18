import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetStudent } from '../auth/get-student.decorator';
import { RequirePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { StudentJwtAuthGuard } from '../auth/student-jwt-auth.guard';
import type { AuthenticatedStudent } from '../auth/student-jwt.strategy';
import { RejectDriveInviteDto } from './dto/reject-drive-invite.dto';
import { StudentPlacementsService } from './student-placements.service';

/**
 * The student Placements module: invitations to answer and the drives the
 * student accepted. Everything is scoped to the JWT's student — there is no id
 * parameter for "which student" anywhere.
 */
@ApiTags('student-placements')
@ApiBearerAuth('student-access-token')
@UseGuards(StudentJwtAuthGuard, RequirePasswordChangedGuard)
@Controller('student/placements')
export class StudentPlacementsController {
  constructor(private readonly svc: StudentPlacementsService) {}

  @Get('invites')
  @ApiOperation({
    summary:
      'Pending drive invitations plus the denied history, newest first.',
  })
  invites(@GetStudent() s: AuthenticatedStudent) {
    return this.svc.invites(s.id);
  }

  @Get('drives')
  @ApiOperation({
    summary:
      'Every drive the student was invited to — the full history with each ' +
      "row's current/final status. Clients filter this list themselves.",
  })
  drives(@GetStudent() s: AuthenticatedStudent) {
    return this.svc.myDrives(s.id);
  }

  @Get('drives/:driveId')
  @ApiOperation({
    summary:
      'Full drive detail (JD, designations, package, attachments) plus the ' +
      "student's own action history for a drive they were invited to. " +
      '404 unless invited.',
  })
  driveDetail(
    @GetStudent() s: AuthenticatedStudent,
    @Param('driveId', ParseIntPipe) driveId: number,
  ) {
    return this.svc.driveDetail(s.id, driveId);
  }

  @Post('invites/:driveId/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accept a pending invitation (20 → 30).' })
  accept(
    @GetStudent() s: AuthenticatedStudent,
    @Param('driveId', ParseIntPipe) driveId: number,
  ) {
    return this.svc.accept(s.id, driveId);
  }

  @Post('invites/:driveId/reject')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Deny a pending invitation with a reason (20 → 40).',
  })
  reject(
    @GetStudent() s: AuthenticatedStudent,
    @Param('driveId', ParseIntPipe) driveId: number,
    @Body() dto: RejectDriveInviteDto,
  ) {
    return this.svc.reject(s.id, driveId, dto.reason);
  }
}
