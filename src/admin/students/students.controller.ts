import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
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
import type { SessionRow } from '../../auth-sessions/auth-sessions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireTotpEnrolledGuard } from '../auth/require-totp-enrolled.guard';
import { BulkCreateStudentsDto } from '../dto/bulk-create-students.dto';
import { CreateStudentDto } from '../dto/create-student.dto';
import { ListStudentsDto } from '../dto/list-students.dto';
import { SetStudentPasswordDto } from '../dto/set-student-password.dto';
import { UpdateStudentDto } from '../dto/update-student.dto';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { SetResumeExternalUrlDto } from '../../student/profile/dto/set-resume-external-url.dto';
import { ResumeView } from '../../student/profile/student-resume.service';
import { Student } from '../entities/student.entity';
import {
  AdminStudentCertification,
  ListStudentsResult,
  StudentsService,
} from './students.service';

class AddStudentCertificationDto extends createZodDto(
  z.object({
    industry_certification_id: z.coerce.number().int().positive(),
  }),
) {}

@ApiTags('students')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/students')
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @Get()
  @ApiOperation({
    summary: 'List students with server-side pagination, search, and sort.',
  })
  list(@Query() query: ListStudentsDto): Promise<ListStudentsResult> {
    return this.students.list(query);
  }

  @Get('student-ids')
  @ApiOperation({
    summary:
      'List every student_id in the table — for bulk-upload client-side dedupe.',
  })
  listStudentIds(): Promise<{ ids: string[] }> {
    return this.students.listStudentIds().then((ids) => ({ ids }));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single student by ID.' })
  getOne(@Param('id', ParseIntPipe) id: number): Promise<Student> {
    return this.students.getOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new student.' })
  create(@Body() dto: CreateStudentDto): Promise<Student> {
    return this.students.create(dto);
  }

  @Post('bulk')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Bulk-create students for a single (programme, admission year) batch in one transaction. Returns 400 with per-row errors on validation failure; commits all or none.',
  })
  bulkCreate(@Body() dto: BulkCreateStudentsDto): Promise<{ created: number }> {
    return this.students.bulkCreate(
      dto.programme_id,
      dto.admission_year_id,
      dto.rows,
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a student.' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStudentDto,
  ): Promise<Student> {
    return this.students.update(id, dto);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Provision or reset the student's login: emails a temporary password to " +
      'their registered address and forces a change on first sign-in.',
  })
  resetPassword(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ email: string }> {
    return this.students.resetLoginPassword(id);
  }

  @Post(':id/set-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      "Directly set the student's login password to a chosen value (no email " +
      'is sent). Forces a change on first sign-in and revokes active sessions.',
  })
  setPassword(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetStudentPasswordDto,
  ): Promise<void> {
    return this.students.setLoginPassword(id, dto.password);
  }

  @Post(':id/photo')
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
      "Upload (or replace) the student's ID-card photo. Stored in object " +
      'storage under a random key; served to clients via presigned URLs only.',
  })
  setPhoto(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          // 5 MB cap. Mime/type is validated in the service against the
          // allowed set (JPEG/PNG/WebP) so the key extension stays trusted.
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
        ],
      }),
    )
    file: Express.Multer.File,
  ): Promise<Student> {
    return this.students.setPhoto(id, file);
  }

  @Delete(':id/photo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Remove the student's ID-card photo." })
  removePhoto(@Param('id', ParseIntPipe) id: number): Promise<Student> {
    return this.students.removePhoto(id);
  }

  @Get(':id/certifications')
  @ApiOperation({
    summary:
      "The student's industry certifications (with presigned certificate URLs).",
  })
  listCertifications(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AdminStudentCertification[]> {
    return this.students.listCertifications(id);
  }

  @Post(':id/certifications')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        industry_certification_id: { type: 'number' },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({
    summary:
      'Add a certification with its supporting file (PDF/JPEG/PNG, ≤ 5 MB). ' +
      'Direct — no approval flow.',
  })
  addCertification(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddStudentCertificationDto,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 })],
      }),
    )
    file: Express.Multer.File,
  ): Promise<AdminStudentCertification[]> {
    return this.students.addCertification(
      id,
      dto.industry_certification_id,
      file,
    );
  }

  @Delete(':id/certifications/:certRowId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a certification entry (and its file).' })
  removeCertification(
    @Param('id', ParseIntPipe) id: number,
    @Param('certRowId', ParseIntPipe) certRowId: number,
  ): Promise<void> {
    return this.students.removeCertification(id, certRowId);
  }

  @Put(':id/resume/external-url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Set the student's resume link (Drive, personal site, …). Must be a " +
      'publicly reachable https URL.',
  })
  setResumeExternalUrl(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetResumeExternalUrlDto,
  ): Promise<ResumeView> {
    return this.students.setResumeExternalUrl(id, dto.url);
  }

  @Delete(':id/resume/external-url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Clear the student's resume link." })
  clearResumeExternalUrl(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ResumeView> {
    return this.students.setResumeExternalUrl(id, null);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a student.' })
  activate(@Param('id', ParseIntPipe) id: number): Promise<Student> {
    return this.students.setActive(id, true);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Deactivate a student. Signs them out of every device.',
  })
  deactivate(@Param('id', ParseIntPipe) id: number): Promise<Student> {
    return this.students.setActive(id, false);
  }

  @Get(':id/sessions')
  @ApiOperation({
    summary: "List the student's signed-in devices (with login IP).",
  })
  listSessions(@Param('id', ParseIntPipe) id: number): Promise<SessionRow[]> {
    return this.students.listSessions(id);
  }

  @Delete(':id/sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Force-sign-out one of the student’s devices.' })
  async revokeSession(
    @Param('id', ParseIntPipe) id: number,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ): Promise<void> {
    await this.students.revokeSession(id, sessionId);
  }
}
