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
import { CreateIndustryCertificationDto } from '../dto/create-industry-certification.dto';
import { ListIndustryCertificationsDto } from '../dto/list-industry-certifications.dto';
import { UpdateIndustryCertificationDto } from '../dto/update-industry-certification.dto';
import { IndustryCertification } from '../entities/industry-certification.entity';
import {
  IndustryCertificationsService,
  ListIndustryCertificationsResult,
} from './industry-certifications.service';

@ApiTags('industry-certifications')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/industry-certifications')
export class IndustryCertificationsController {
  constructor(
    private readonly certifications: IndustryCertificationsService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'List industry certifications with server-side pagination, search, and sort.',
  })
  list(
    @Query() query: ListIndustryCertificationsDto,
  ): Promise<ListIndustryCertificationsResult> {
    return this.certifications.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single industry certification by ID.' })
  getOne(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<IndustryCertification> {
    return this.certifications.getOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new industry certification.' })
  create(
    @Body() dto: CreateIndustryCertificationDto,
  ): Promise<IndustryCertification> {
    return this.certifications.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an industry certification.' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateIndustryCertificationDto,
  ): Promise<IndustryCertification> {
    return this.certifications.update(id, dto);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate an industry certification.' })
  activate(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<IndustryCertification> {
    return this.certifications.setActive(id, true);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate an industry certification.' })
  deactivate(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<IndustryCertification> {
    return this.certifications.setActive(id, false);
  }
}
