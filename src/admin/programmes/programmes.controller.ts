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
import { CreateProgrammeDto } from '../dto/create-programme.dto';
import { ListProgrammesDto } from '../dto/list-programmes.dto';
import { UpdateProgrammeDto } from '../dto/update-programme.dto';
import { Programme } from '../entities/programme.entity';
import { ListProgrammesResult, ProgrammesService } from './programmes.service';

@ApiTags('programmes')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/programmes')
export class ProgrammesController {
  constructor(private readonly programmes: ProgrammesService) {}

  @Get()
  @ApiOperation({
    summary: 'List programmes with server-side pagination, search, and sort.',
  })
  list(@Query() query: ListProgrammesDto): Promise<ListProgrammesResult> {
    return this.programmes.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single programme by ID.' })
  getOne(@Param('id', ParseIntPipe) id: number): Promise<Programme> {
    return this.programmes.getOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new programme.' })
  create(@Body() dto: CreateProgrammeDto): Promise<Programme> {
    return this.programmes.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a programme.' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProgrammeDto,
  ): Promise<Programme> {
    return this.programmes.update(id, dto);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a programme.' })
  activate(@Param('id', ParseIntPipe) id: number): Promise<Programme> {
    return this.programmes.setActive(id, true);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a programme.' })
  deactivate(@Param('id', ParseIntPipe) id: number): Promise<Programme> {
    return this.programmes.setActive(id, false);
  }
}
