import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireTotpEnrolledGuard } from '../auth/require-totp-enrolled.guard';
import { BulkCreateProgrammeSemestersDto } from '../dto/bulk-create-programme-semesters.dto';
import { ListProgrammeSemestersDto } from '../dto/list-programme-semesters.dto';
import { SetProgrammeSemesterDatesDto } from '../dto/set-programme-semester-dates.dto';
import { ProgrammeSemester } from '../entities/programme-semester.entity';
import {
  BulkCreateProgrammeSemestersResult,
  ListProgrammeSemestersResult,
  ProgrammeSemestersService,
} from './programme-semesters.service';

@ApiTags('programme-semesters')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/programme-semesters')
export class ProgrammeSemestersController {
  constructor(private readonly links: ProgrammeSemestersService) {}

  @Get()
  @ApiOperation({
    summary:
      'List programme-semester links with server-side pagination, sort, and filters.',
  })
  list(
    @Query() query: ListProgrammeSemestersDto,
  ): Promise<ListProgrammeSemestersResult> {
    return this.links.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single programme-semester link by ID.' })
  getOne(@Param('id', ParseIntPipe) id: number): Promise<ProgrammeSemester> {
    return this.links.getOne(id);
  }

  @Post('bulk')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Link multiple semesters to a (programme, admission year) batch in one call. Already-existing combinations are reported in `skipped` instead of erroring.',
  })
  bulkCreate(
    @Body() dto: BulkCreateProgrammeSemestersDto,
  ): Promise<BulkCreateProgrammeSemestersResult> {
    return this.links.bulkCreate(dto);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a programme-semester link.' })
  activate(@Param('id', ParseIntPipe) id: number): Promise<ProgrammeSemester> {
    return this.links.setActive(id, true);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a programme-semester link.' })
  deactivate(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ProgrammeSemester> {
    return this.links.setActive(id, false);
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Move a programme-semester from 'upcoming' to 'ongoing'. Rejected if it's already 'ongoing' or 'completed'.",
  })
  start(@Param('id', ParseIntPipe) id: number): Promise<ProgrammeSemester> {
    return this.links.setStatus(id, 'ongoing');
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Move a programme-semester from 'ongoing' to 'completed'. Rejected if it isn't currently 'ongoing'.",
  })
  complete(@Param('id', ParseIntPipe) id: number): Promise<ProgrammeSemester> {
    return this.links.setStatus(id, 'completed');
  }

  @Post(':id/dates')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Set the planned start/end dates that gate the session seeder. Pass null on either field to clear it.',
  })
  setDates(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetProgrammeSemesterDatesDto,
  ): Promise<ProgrammeSemester> {
    return this.links.setDates(id, dto);
  }

  @Post(':id/trim-sessions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Delete still-scheduled sessions past planned_end_date. Completed sessions are left untouched.',
  })
  trimSessions(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ deleted: number; cancelled: number }> {
    return this.links.trimSessionsPastPlannedEnd(id);
  }
}
