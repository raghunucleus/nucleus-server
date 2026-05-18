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
import { CreateRegulationDto } from '../dto/create-regulation.dto';
import { ListRegulationsDto } from '../dto/list-regulations.dto';
import { UpdateRegulationDto } from '../dto/update-regulation.dto';
import { Regulation } from '../entities/regulation.entity';
import { ListRegulationsResult, RegulationsService } from './regulations.service';

@ApiTags('regulations')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/regulations')
export class RegulationsController {
  constructor(private readonly regulations: RegulationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List regulations with server-side pagination, search, and sort.',
  })
  list(@Query() query: ListRegulationsDto): Promise<ListRegulationsResult> {
    return this.regulations.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single regulation by ID.' })
  getOne(@Param('id', ParseIntPipe) id: number): Promise<Regulation> {
    return this.regulations.getOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new regulation.' })
  create(@Body() dto: CreateRegulationDto): Promise<Regulation> {
    return this.regulations.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a regulation.' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRegulationDto,
  ): Promise<Regulation> {
    return this.regulations.update(id, dto);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a regulation.' })
  activate(@Param('id', ParseIntPipe) id: number): Promise<Regulation> {
    return this.regulations.setActive(id, true);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a regulation.' })
  deactivate(@Param('id', ParseIntPipe) id: number): Promise<Regulation> {
    return this.regulations.setActive(id, false);
  }
}
