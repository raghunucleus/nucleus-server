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
import { ListProgrammeSemesterSubjectsDto } from '../dto/list-programme-semester-subjects.dto';
import { SetProgrammeSemesterSubjectFacultyDto } from '../dto/set-programme-semester-subject-faculty.dto';
import { UpdateProgrammeSemesterSubjectDto } from '../dto/update-programme-semester-subject.dto';
import { ProgrammeSemesterSubject } from '../entities/programme-semester-subject.entity';
import {
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
    return this.entries.list(query);
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

  @Put(':id/faculty')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Replace the faculty allocated to a real-subject entry. Send the full list; an empty list clears it.',
  })
  setFaculty(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetProgrammeSemesterSubjectFacultyDto,
  ): Promise<ProgrammeSemesterSubject> {
    return this.entries.setFaculty(id, dto.employee_ids);
  }

  @Put('options/:optionId/faculty')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Replace the faculty allocated to one candidate subject of an open-elective slot. Send the full list; an empty list clears it.",
  })
  setOptionFaculty(
    @Param('optionId', ParseIntPipe) optionId: number,
    @Body() dto: SetProgrammeSemesterSubjectFacultyDto,
  ): Promise<ProgrammeSemesterSubject> {
    return this.entries.setOptionFaculty(optionId, dto.employee_ids);
  }
}
