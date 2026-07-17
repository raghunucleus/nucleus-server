import {
  BadRequestException,
  Controller,
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
import { storageKey } from '../../storage/storage.constants';
import { StorageService } from '../../storage/storage.service';

const CERTIFICATE_MAX_BYTES = 5 * 1024 * 1024;
const CERTIFICATE_EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/**
 * Stage a certificate file for a certification approval request. The upload
 * returns only the object key — no DB row exists until an approver approves
 * the request that references it. The key embeds the student id
 * (`student-certificates/<id>/<uuid>.<ext>`), which is how the request flow
 * proves ownership: keys outside the requester's own folder are rejected.
 * Files stay PRIVATE (presigned reads for approvers/admins only).
 */
@ApiTags('student-profile')
@ApiBearerAuth('student-access-token')
@UseGuards(StudentJwtAuthGuard, RequirePasswordChangedGuard)
@Controller('student/profile/certifications')
export class StudentCertificateFileController {
  constructor(private readonly storage: StorageService) {}

  @Post('files')
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
      'Stage a supporting certificate file (PDF/JPEG/PNG, ≤ 5 MB) and get its ' +
      'key to submit inside a certification approval request.',
  })
  async uploadFile(
    @GetStudent() s: AuthenticatedStudent,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: CERTIFICATE_MAX_BYTES }),
        ],
      }),
    )
    file: Express.Multer.File,
  ): Promise<{ certificate_file_key: string }> {
    const ext = CERTIFICATE_EXT_BY_MIME[file.mimetype];
    if (!ext) {
      throw new BadRequestException(
        'Unsupported file type. Use PDF, JPEG, or PNG.',
      );
    }
    const key = storageKey.studentCertificate(s.id, ext);
    await this.storage.putObject(key, file.buffer, file.mimetype);
    return { certificate_file_key: key };
  }
}
