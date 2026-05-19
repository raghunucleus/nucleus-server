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
import { CreateDesignationDto } from '../dto/create-designation.dto';
import { ListDesignationsDto } from '../dto/list-designations.dto';
import { UpdateDesignationDto } from '../dto/update-designation.dto';
import { Designation } from '../entities/designation.entity';
import {
  DesignationsService,
  ListDesignationsResult,
} from './designations.service';

@ApiTags('designations')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/designations')
export class DesignationsController {
  constructor(private readonly designations: DesignationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List designations with server-side pagination, search, and sort.',
  })
  list(@Query() query: ListDesignationsDto): Promise<ListDesignationsResult> {
    return this.designations.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single designation by ID.' })
  getOne(@Param('id', ParseIntPipe) id: number): Promise<Designation> {
    return this.designations.getOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new designation.' })
  create(@Body() dto: CreateDesignationDto): Promise<Designation> {
    return this.designations.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a designation.' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDesignationDto,
  ): Promise<Designation> {
    return this.designations.update(id, dto);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a designation.' })
  activate(@Param('id', ParseIntPipe) id: number): Promise<Designation> {
    return this.designations.setActive(id, true);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a designation.' })
  deactivate(@Param('id', ParseIntPipe) id: number): Promise<Designation> {
    return this.designations.setActive(id, false);
  }
}
