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
import { CreateProgrammeRegulationDto } from '../dto/create-programme-regulation.dto';
import { ListProgrammeRegulationsDto } from '../dto/list-programme-regulations.dto';
import { UpdateProgrammeRegulationDto } from '../dto/update-programme-regulation.dto';
import { ProgrammeRegulation } from '../entities/programme-regulation.entity';
import {
  ListProgrammeRegulationsResult,
  ProgrammeRegulationsService,
} from './programme-regulations.service';

@ApiTags('programme-regulations')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/programme-regulations')
export class ProgrammeRegulationsController {
  constructor(private readonly links: ProgrammeRegulationsService) {}

  @Get()
  @ApiOperation({
    summary:
      'List programme-regulation assignments with server-side pagination, sort, and filters.',
  })
  list(
    @Query() query: ListProgrammeRegulationsDto,
  ): Promise<ListProgrammeRegulationsResult> {
    return this.links.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single programme-regulation by ID.' })
  getOne(@Param('id', ParseIntPipe) id: number): Promise<ProgrammeRegulation> {
    return this.links.getOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Assign a regulation to a (programme, admission year) batch. Rejects if one already exists for that batch.',
  })
  create(
    @Body() dto: CreateProgrammeRegulationDto,
  ): Promise<ProgrammeRegulation> {
    return this.links.create(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Change the regulation on an existing assignment. The (programme, admission year) pair is fixed.',
  })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProgrammeRegulationDto,
  ): Promise<ProgrammeRegulation> {
    return this.links.update(id, dto);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate an assignment.' })
  activate(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ProgrammeRegulation> {
    return this.links.setActive(id, true);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate an assignment.' })
  deactivate(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ProgrammeRegulation> {
    return this.links.setActive(id, false);
  }
}
