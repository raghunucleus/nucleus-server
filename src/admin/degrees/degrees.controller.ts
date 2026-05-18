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
import { CreateDegreeDto } from '../dto/create-degree.dto';
import { ListDegreesDto } from '../dto/list-degrees.dto';
import { UpdateDegreeDto } from '../dto/update-degree.dto';
import { Degree } from '../entities/degree.entity';
import { DegreesService, ListDegreesResult } from './degrees.service';

@ApiTags('degrees')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/degrees')
export class DegreesController {
  constructor(private readonly degrees: DegreesService) {}

  @Get()
  @ApiOperation({
    summary: 'List degrees with server-side pagination, search, and sort.',
  })
  list(@Query() query: ListDegreesDto): Promise<ListDegreesResult> {
    return this.degrees.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single degree by ID.' })
  getOne(@Param('id', ParseIntPipe) id: number): Promise<Degree> {
    return this.degrees.getOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new degree.' })
  create(@Body() dto: CreateDegreeDto): Promise<Degree> {
    return this.degrees.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a degree.' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDegreeDto,
  ): Promise<Degree> {
    return this.degrees.update(id, dto);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a degree.' })
  activate(@Param('id', ParseIntPipe) id: number): Promise<Degree> {
    return this.degrees.setActive(id, true);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a degree.' })
  deactivate(@Param('id', ParseIntPipe) id: number): Promise<Degree> {
    return this.degrees.setActive(id, false);
  }
}
