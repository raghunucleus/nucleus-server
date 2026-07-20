import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetStudent } from '../auth/get-student.decorator';
import { RequirePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { StudentJwtAuthGuard } from '../auth/student-jwt-auth.guard';
import type { AuthenticatedStudent } from '../auth/student-jwt.strategy';
import { SetResumeExternalUrlDto } from './dto/set-resume-external-url.dto';
import { ResumeView, StudentResumeService } from './student-resume.service';

/**
 * The acting student's own resume link (NO_APPROVAL — saved directly). Student
 * id from the JWT only. The resume is a single externally-hosted link; we never
 * host the file ourselves.
 */
@ApiTags('student-profile')
@ApiBearerAuth('student-access-token')
@UseGuards(StudentJwtAuthGuard, RequirePasswordChangedGuard)
@Controller('student/profile/resume')
export class StudentResumeController {
  constructor(private readonly resumes: StudentResumeService) {}

  @Put('external-url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Set the caller's resume link (Drive, personal site, …). Must be a " +
      'publicly reachable https URL — recruiters open it directly.',
  })
  setExternalUrl(
    @GetStudent() s: AuthenticatedStudent,
    @Body() dto: SetResumeExternalUrlDto,
  ): Promise<ResumeView> {
    return this.resumes.setExternalUrl(s.id, dto.url);
  }

  @Delete('external-url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clear the resume link.' })
  clearExternalUrl(@GetStudent() s: AuthenticatedStudent): Promise<ResumeView> {
    return this.resumes.setExternalUrl(s.id, null);
  }
}
