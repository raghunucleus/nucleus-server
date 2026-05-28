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
  Patch,
  Post,
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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireTotpEnrolledGuard } from '../auth/require-totp-enrolled.guard';
import { BulkCreateStudentsDto } from '../dto/bulk-create-students.dto';
import { CreateStudentDto } from '../dto/create-student.dto';
import { ListStudentsDto } from '../dto/list-students.dto';
import { SetStudentPasswordDto } from '../dto/set-student-password.dto';
import { UpdateStudentDto } from '../dto/update-student.dto';
import { Student } from '../entities/student.entity';
import {
  ListStudentsResult,
  StudentsService,
} from './students.service';

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
    summary: 'List every student_id in the table — for bulk-upload client-side dedupe.',
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

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a student.' })
  activate(@Param('id', ParseIntPipe) id: number): Promise<Student> {
    return this.students.setActive(id, true);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a student.' })
  deactivate(@Param('id', ParseIntPipe) id: number): Promise<Student> {
    return this.students.setActive(id, false);
  }
}
