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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireTotpEnrolledGuard } from '../auth/require-totp-enrolled.guard';
import { CreateProgrammeSemesterSubjectDto } from '../dto/create-programme-semester-subject.dto';
import { ListFacultyMatrixDto } from '../dto/list-faculty-matrix.dto';
import { ListProgrammeSemesterSubjectsDto } from '../dto/list-programme-semester-subjects.dto';
import { SetProgrammeSemesterSubjectGroupFacultyDto } from '../dto/set-programme-semester-subject-group-faculty.dto';
import { SetProgrammeSemesterSubjectOptionFacultyDto } from '../dto/set-programme-semester-subject-option-faculty.dto';
import { UpdateProgrammeSemesterSubjectDto } from '../dto/update-programme-semester-subject.dto';
import { ProgrammeSemesterSubject } from '../entities/programme-semester-subject.entity';
import {
  FacultyMatrixResult,
  ListProgrammeSemesterSubjectsResult,
  ProgrammeSemesterSubjectsService,
} from './programme-semester-subjects.service';

@ApiTags('programme-semester-subjects')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/programme-semester-subjects')
export class ProgrammeSemesterSubjectsController {
  constructor(private readonly entries: ProgrammeSemesterSubjectsService) {}

  @Get()
  @ApiOperation({
    summary:
      'List subject entries (real subjects + elective slots) attached to a programme-semester.',
  })
  list(
    @Query() query: ListProgrammeSemesterSubjectsDto,
  ): Promise<ListProgrammeSemesterSubjectsResult> {
    return this.entries.list({
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      status: query.status,
      programmeSemesterId: query.programmeSemesterId,
      attendanceGroupId: query.attendanceGroupId,
    });
  }

  // Placed before `:id` so the literal path segment wins over the param.
  @Get('faculty-matrix')
  @ApiOperation({
    summary:
      "Faculty configuration matrix: real subjects, the batch's attendance groups, and existing (subject × group) cell assignments.",
  })
  facultyMatrix(
    @Query() query: ListFacultyMatrixDto,
  ): Promise<FacultyMatrixResult> {
    return this.entries.getFacultyMatrix({
      programmeSemesterId: query.programmeSemesterId,
      programmeId: query.programmeId,
      admissionYearId: query.admissionYearId,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single subject entry by ID.' })
  getOne(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ProgrammeSemesterSubject> {
    return this.entries.getOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Attach a subject (real or open-elective slot) to a programme-semester.',
  })
  create(
    @Body() dto: CreateProgrammeSemesterSubjectDto,
  ): Promise<ProgrammeSemesterSubject> {
    return this.entries.create(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Update a subject entry. programme_semester_id is fixed at creation.',
  })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProgrammeSemesterSubjectDto,
  ): Promise<ProgrammeSemesterSubject> {
    return this.entries.update(id, dto);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a subject entry.' })
  activate(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ProgrammeSemesterSubject> {
    return this.entries.setActive(id, true);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a subject entry.' })
  deactivate(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ProgrammeSemesterSubject> {
    return this.entries.setActive(id, false);
  }

  @Put(':id/groups/:groupId/faculty')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Set (or clear) the teacher for one (subject, attendance-group) cell. employee_id null clears it.",
  })
  setGroupFaculty(
    @Param('id', ParseIntPipe) id: number,
    @Param('groupId', ParseIntPipe) groupId: number,
    @Body() dto: SetProgrammeSemesterSubjectGroupFacultyDto,
  ): Promise<FacultyMatrixResult> {
    return this.entries.setGroupFaculty({
      programmeSemesterSubjectId: id,
      attendanceGroupId: groupId,
      employeeId: dto.employee_id,
    });
  }

  @Put('options/:optionId/faculty')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Replace the faculty roster for one candidate subject of an open-elective slot. Send the full list; an empty list clears it.",
  })
  setOptionFaculty(
    @Param('optionId', ParseIntPipe) optionId: number,
    @Body() dto: SetProgrammeSemesterSubjectOptionFacultyDto,
  ): Promise<ProgrammeSemesterSubject> {
    return this.entries.setOptionFaculty(optionId, dto.employee_ids);
  }
}
