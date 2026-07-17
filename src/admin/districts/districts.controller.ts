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
import { CreateDistrictDto } from '../dto/create-district.dto';
import { ListDistrictsDto } from '../dto/list-districts.dto';
import { UpdateDistrictDto } from '../dto/update-district.dto';
import { District } from '../entities/district.entity';
import { DistrictsService, ListDistrictsResult } from './districts.service';

// No delete route by design — deactivate only, matching every other admin
// master list.
@ApiTags('districts')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/districts')
export class DistrictsController {
  constructor(private readonly districts: DistrictsService) {}

  @Get()
  @ApiOperation({
    summary:
      "List districts with server-side pagination, search, and sort. `status` filters on the row's own is_active; `effectiveActive` filters on the whole district -> state -> country chain and is what consumer pickers should use.",
  })
  list(@Query() query: ListDistrictsDto): Promise<ListDistrictsResult> {
    return this.districts.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a single district by ID, with its state and country.',
  })
  getOne(@Param('id', ParseIntPipe) id: number): Promise<District> {
    return this.districts.getOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new district under a state.' })
  create(@Body() dto: CreateDistrictDto): Promise<District> {
    return this.districts.create(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a district. Passing state_id re-parents it.',
  })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDistrictDto,
  ): Promise<District> {
    return this.districts.update(id, dto);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a district.' })
  activate(@Param('id', ParseIntPipe) id: number): Promise<District> {
    return this.districts.setActive(id, true);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a district.' })
  deactivate(@Param('id', ParseIntPipe) id: number): Promise<District> {
    return this.districts.setActive(id, false);
  }
}
