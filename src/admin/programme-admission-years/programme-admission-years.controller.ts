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
import { CreateProgrammeAdmissionYearDto } from '../dto/create-programme-admission-year.dto';
import { ListProgrammeAdmissionYearsDto } from '../dto/list-programme-admission-years.dto';
import { SetProfileVerifiersDto } from '../dto/set-profile-verifiers.dto';
import { UpdateProgrammeAdmissionYearDto } from '../dto/update-programme-admission-year.dto';
import { ProgrammeAdmissionYear } from '../entities/programme-admission-year.entity';
import {
  ListProgrammeAdmissionYearsResult,
  ProgrammeAdmissionYearsService,
} from './programme-admission-years.service';

@ApiTags('programme-admission-years')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/programme-admission-years')
export class ProgrammeAdmissionYearsController {
  constructor(private readonly links: ProgrammeAdmissionYearsService) {}

  @Get()
  @ApiOperation({
    summary:
      'List programme-admission-year assignments with server-side pagination, sort, and filters.',
  })
  list(
    @Query() query: ListProgrammeAdmissionYearsDto,
  ): Promise<ListProgrammeAdmissionYearsResult> {
    return this.links.list(query);
  }

  @Get('matrix')
  @ApiOperation({
    summary:
      'Slim, unpaginated list of every (programme, admission year) cell. Used to render the bulk-upload selector matrix.',
  })
  matrix(): Promise<
    Array<{
      id: number;
      programme_id: number;
      programme_name: string;
      programme_code: string;
      admission_year_id: number;
      admission_year_display: string;
      admission_year_value: number;
      is_active: boolean;
    }>
  > {
    return this.links.matrix();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single programme-admission-year by ID.' })
  getOne(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ProgrammeAdmissionYear> {
    return this.links.getOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create a (programme, admission year) entry with its regulation. Rejects if one already exists for that batch.',
  })
  create(
    @Body() dto: CreateProgrammeAdmissionYearDto,
  ): Promise<ProgrammeAdmissionYear> {
    return this.links.create(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Change the regulation on an existing entry. The (programme, admission year) pair is fixed.',
  })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProgrammeAdmissionYearDto,
  ): Promise<ProgrammeAdmissionYear> {
    return this.links.update(id, dto);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate an entry.' })
  activate(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ProgrammeAdmissionYear> {
    return this.links.setActive(id, true);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate an entry.' })
  deactivate(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ProgrammeAdmissionYear> {
    return this.links.setActive(id, false);
  }

  @Get(':id/profile-verifiers')
  @ApiOperation({
    summary:
      "List the employees who verify this batch's students' profile details.",
  })
  getProfileVerifiers(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<
    Array<{ id: number; emp_code: string; emp_display_name: string }>
  > {
    return this.links.getProfileVerifiers(id);
  }

  @Put(':id/profile-verifiers')
  @ApiOperation({
    summary:
      "Replace the batch's profile verifiers with the given set of employees.",
  })
  setProfileVerifiers(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetProfileVerifiersDto,
  ): Promise<
    Array<{ id: number; emp_code: string; emp_display_name: string }>
  > {
    return this.links.setProfileVerifiers(
      id,
      dto.profile_verifier_employee_ids,
    );
  }
}
