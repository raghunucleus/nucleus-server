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
import { CreateSubjectTypeDto } from '../dto/create-subject-type.dto';
import { ListSubjectTypesDto } from '../dto/list-subject-types.dto';
import { UpdateSubjectTypeDto } from '../dto/update-subject-type.dto';
import { SubjectType } from '../entities/subject-type.entity';
import {
  ListSubjectTypesResult,
  SubjectTypesService,
} from './subject-types.service';

@ApiTags('subject-types')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/subject-types')
export class SubjectTypesController {
  constructor(private readonly subjectTypes: SubjectTypesService) {}

  @Get()
  @ApiOperation({
    summary:
      'List subject types with server-side pagination, search, and sort.',
  })
  list(@Query() query: ListSubjectTypesDto): Promise<ListSubjectTypesResult> {
    return this.subjectTypes.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single subject type by ID.' })
  getOne(@Param('id', ParseIntPipe) id: number): Promise<SubjectType> {
    return this.subjectTypes.getOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new subject type.' })
  create(@Body() dto: CreateSubjectTypeDto): Promise<SubjectType> {
    return this.subjectTypes.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a subject type.' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSubjectTypeDto,
  ): Promise<SubjectType> {
    return this.subjectTypes.update(id, dto);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a subject type.' })
  activate(@Param('id', ParseIntPipe) id: number): Promise<SubjectType> {
    return this.subjectTypes.setActive(id, true);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a subject type.' })
  deactivate(@Param('id', ParseIntPipe) id: number): Promise<SubjectType> {
    return this.subjectTypes.setActive(id, false);
  }
}
