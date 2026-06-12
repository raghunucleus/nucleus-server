import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  MaxFileSizeValidator,
  ParseFilePipe,
  Post,
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
import { StudentPhotoService } from './student-photo.service';

/**
 * The acting student's own profile photo. The student id comes only from the
 * JWT (`@GetStudent()`); a student can only ever change their own photo.
 */
@ApiTags('student-profile')
@ApiBearerAuth('student-access-token')
@UseGuards(StudentJwtAuthGuard, RequirePasswordChangedGuard)
@Controller('student/profile/photo')
export class StudentPhotoController {
  constructor(private readonly photos: StudentPhotoService) {}

  @Post()
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
      "Upload (or replace) the caller's own profile photo. Compressed " +
      'server-side to a square WebP; the same photo appears on the ID card, ' +
      'profile, and (unless hidden via privacy settings) to chat peers.',
  })
  setPhoto(
    @GetStudent() s: AuthenticatedStudent,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          // 1 MB cap — clients crop + compress before uploading, so anything
          // larger is a misbehaving client, not a legitimate photo.
          new MaxFileSizeValidator({ maxSize: 1024 * 1024 }),
        ],
      }),
    )
    file: Express.Multer.File,
  ): Promise<{ photo_url: string }> {
    return this.photos.setPhoto(s.id, file);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Remove the caller's own profile photo." })
  removePhoto(@GetStudent() s: AuthenticatedStudent): Promise<void> {
    return this.photos.removePhoto(s.id);
  }
}
