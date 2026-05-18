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
import { CreateAdmissionYearDto } from '../dto/create-admission-year.dto';
import { ListAdmissionYearsDto } from '../dto/list-admission-years.dto';
import { UpdateAdmissionYearDto } from '../dto/update-admission-year.dto';
import { AdmissionYear } from '../entities/admission-year.entity';
import {
  AdmissionYearsService,
  ListAdmissionYearsResult,
} from './admission-years.service';

@ApiTags('admission-years')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/admission-years')
export class AdmissionYearsController {
  constructor(private readonly years: AdmissionYearsService) {}

  @Get()
  @ApiOperation({
    summary:
      'List admission years with server-side pagination, search, and sort.',
  })
  list(@Query() query: ListAdmissionYearsDto): Promise<ListAdmissionYearsResult> {
    return this.years.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single admission year by ID.' })
  getOne(@Param('id', ParseIntPipe) id: number): Promise<AdmissionYear> {
    return this.years.getOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new admission year.' })
  create(@Body() dto: CreateAdmissionYearDto): Promise<AdmissionYear> {
    return this.years.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an admission year.' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAdmissionYearDto,
  ): Promise<AdmissionYear> {
    return this.years.update(id, dto);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate an admission year.' })
  activate(@Param('id', ParseIntPipe) id: number): Promise<AdmissionYear> {
    return this.years.setActive(id, true);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate an admission year.' })
  deactivate(@Param('id', ParseIntPipe) id: number): Promise<AdmissionYear> {
    return this.years.setActive(id, false);
  }
}
