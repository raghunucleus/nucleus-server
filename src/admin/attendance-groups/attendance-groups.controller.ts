import {
  Body,
  Controller,
  Delete,
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
import { AddAttendanceGroupStudentsDto } from '../dto/add-attendance-group-students.dto';
import { CreateAttendanceGroupDto } from '../dto/create-attendance-group.dto';
import { ListAttendanceGroupsDto } from '../dto/list-attendance-groups.dto';
import { UpdateAttendanceGroupDto } from '../dto/update-attendance-group.dto';
import { AttendanceGroup } from '../entities/attendance-group.entity';
import { Student } from '../entities/student.entity';
import { AttendanceGroupsService } from './attendance-groups.service';

@ApiTags('attendance-groups')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/attendance-groups')
export class AttendanceGroupsController {
  constructor(private readonly groups: AttendanceGroupsService) {}

  @Get()
  @ApiOperation({
    summary:
      'List attendance groups (with their student members) for a programme × admission-year batch.',
  })
  list(@Query() query: ListAttendanceGroupsDto): Promise<AttendanceGroup[]> {
    return this.groups.list(query.programmeId, query.admissionYearId);
  }

  @Get('eligible-students')
  @ApiOperation({
    summary:
      "Students eligible for a batch's attendance groups — active students of the programme × admission year not yet in any group.",
  })
  listEligibleStudents(
    @Query() query: ListAttendanceGroupsDto,
  ): Promise<Student[]> {
    return this.groups.listEligibleStudents(
      query.programmeId,
      query.admissionYearId,
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create an attendance group within a programme × admission-year batch.',
  })
  create(@Body() dto: CreateAttendanceGroupDto): Promise<AttendanceGroup> {
    return this.groups.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename an attendance group.' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAttendanceGroupDto,
  ): Promise<AttendanceGroup> {
    return this.groups.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an attendance group. Its students become unassigned.',
  })
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.groups.remove(id);
  }

  @Post(':id/students')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Add students to a group. A student already in another group of the same batch is moved here.',
  })
  addStudents(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddAttendanceGroupStudentsDto,
  ): Promise<AttendanceGroup> {
    return this.groups.addStudents(id, dto.student_ids);
  }

  @Delete(':id/students/:studentId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove a student from a group — they become unassigned.',
  })
  removeStudent(
    @Param('id', ParseIntPipe) id: number,
    @Param('studentId', ParseIntPipe) studentId: number,
  ): Promise<AttendanceGroup> {
    return this.groups.removeStudent(id, studentId);
  }
}
