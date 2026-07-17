import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  MaxFileSizeValidator,
  ParseFilePipe,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { GetStudent } from '../auth/get-student.decorator';
import { RequirePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { StudentJwtAuthGuard } from '../auth/student-jwt-auth.guard';
import type { AuthenticatedStudent } from '../auth/student-jwt.strategy';
import { SetResumeExternalUrlDto } from './dto/set-resume-external-url.dto';
import {
  RESUME_MAX_BYTES,
  ResumeView,
  StudentResumeService,
} from './student-resume.service';

/**
 * The acting student's own resume (NO_APPROVAL — saved directly). Student id
 * from the JWT only. Two INDEPENDENT sources, both live at once: the hosted
 * PDF (shared via the permanent tokenized public link) and an external URL —
 * recruiters get both, so one failing still leaves a working copy.
 */
@ApiTags('student-profile')
@ApiBearerAuth('student-access-token')
@UseGuards(StudentJwtAuthGuard, RequirePasswordChangedGuard)
@Controller('student/profile/resume')
export class StudentResumeController {
  constructor(private readonly resumes: StudentResumeService) {}

  @Put()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary:
      "Upload (or replace) the caller's resume. PDF only, < 2 MB. The " +
      'permanent share link stays the same across replaces.',
  })
  setResume(
    @GetStudent() s: AuthenticatedStudent,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: RESUME_MAX_BYTES })],
      }),
    )
    file: Express.Multer.File,
  ): Promise<ResumeView> {
    return this.resumes.setResume(s.id, file);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      "Remove the caller's hosted resume file. The permanent share link 404s " +
      'until a new file is uploaded (the same link then works again).',
  })
  removeResume(@GetStudent() s: AuthenticatedStudent): Promise<void> {
    return this.resumes.removeResume(s.id);
  }

  @Put('external-url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Set a second, independent resume link (Drive, personal site, …). It ' +
      'does not replace the hosted PDF — both links stay live so one failing ' +
      'still leaves recruiters a working copy.',
  })
  setExternalUrl(
    @GetStudent() s: AuthenticatedStudent,
    @Body() dto: SetResumeExternalUrlDto,
  ): Promise<ResumeView> {
    return this.resumes.setExternalUrl(s.id, dto.url);
  }

  @Delete('external-url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Clear the external resume link. The hosted PDF (if any) keeps working — ' +
      'it was never masked by the external link.',
  })
  clearExternalUrl(@GetStudent() s: AuthenticatedStudent): Promise<ResumeView> {
    return this.resumes.setExternalUrl(s.id, null);
  }
}
