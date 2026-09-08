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
import { storageKey } from '../../storage/storage.constants';
import { StorageService } from '../../storage/storage.service';
import { GetStudent } from '../auth/get-student.decorator';
import { RequirePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { StudentJwtAuthGuard } from '../auth/student-jwt-auth.guard';
import type { AuthenticatedStudent } from '../auth/student-jwt.strategy';
import { LEAVE_ATTACHMENT_MAX_BYTES } from './dto/create-student-leave.dto';

const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

export interface StagedLeaveFile {
  key: string;
  name: string;
  mime: string;
  size: number;
}

/**
 * Stage a proof file for a leave application. Returns only the object key
 * (plus the metadata the client echoes back in `attachments[]`) — nothing is
 * recorded until the application referencing it is filed. The key embeds the
 * student id (`student-leaves/<id>/<uuid>.<ext>`), which is how the apply
 * flow proves ownership. Files stay PRIVATE (presigned reads only).
 *
 * Declared before the `:id` routes of StudentLeavesController would matter
 * only if they shared a class; as separate controllers Nest matches the
 * literal `files` segment first regardless.
 */
@ApiTags('student-leaves')
@ApiBearerAuth('student-access-token')
@UseGuards(StudentJwtAuthGuard, RequirePasswordChangedGuard)
@Controller('student/leaves')
export class StudentLeaveFileController {
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
      'Stage a proof file (PDF/JPEG/PNG, ≤ 5 MB) and get the attachment entry to submit inside a leave application.',
  })
  async uploadFile(
    @GetStudent() s: AuthenticatedStudent,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: LEAVE_ATTACHMENT_MAX_BYTES }),
        ],
      }),
    )
    file: Express.Multer.File,
  ): Promise<StagedLeaveFile> {
    const ext = EXT_BY_MIME[file.mimetype];
    if (!ext) {
      throw new BadRequestException(
        'Unsupported file type. Use PDF, JPEG, or PNG.',
      );
    }
    const key = storageKey.studentLeaveAttachment(s.id, ext);
    await this.storage.putObject(key, file.buffer, file.mimetype);
    return {
      key,
      name: file.originalname || `proof.${ext}`,
      mime: file.mimetype,
      size: file.size,
    };
  }
}
