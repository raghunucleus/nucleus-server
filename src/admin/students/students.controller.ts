import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireTotpEnrolledGuard } from '../auth/require-totp-enrolled.guard';
import { BulkCreateStudentsDto } from '../dto/bulk-create-students.dto';
import { CreateStudentDto } from '../dto/create-student.dto';
import { ListStudentsDto } from '../dto/list-students.dto';
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
