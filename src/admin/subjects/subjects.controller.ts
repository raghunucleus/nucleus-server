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
import { CreateSubjectDto } from '../dto/create-subject.dto';
import { ListSubjectsDto } from '../dto/list-subjects.dto';
import { UpdateSubjectDto } from '../dto/update-subject.dto';
import { Subject } from '../entities/subject.entity';
import { ListSubjectsResult, SubjectsService } from './subjects.service';

@ApiTags('subjects')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/subjects')
export class SubjectsController {
  constructor(private readonly subjects: SubjectsService) {}

  @Get()
  @ApiOperation({
    summary: 'List subjects with server-side pagination, search, and filters.',
  })
  list(@Query() query: ListSubjectsDto): Promise<ListSubjectsResult> {
    return this.subjects.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single subject by ID.' })
  getOne(@Param('id', ParseIntPipe) id: number): Promise<Subject> {
    return this.subjects.getOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new subject under a regulation.' })
  create(@Body() dto: CreateSubjectDto): Promise<Subject> {
    return this.subjects.create(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Update a subject. Regulation is fixed at creation and cannot be changed.',
  })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSubjectDto,
  ): Promise<Subject> {
    return this.subjects.update(id, dto);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a subject.' })
  activate(@Param('id', ParseIntPipe) id: number): Promise<Subject> {
    return this.subjects.setActive(id, true);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a subject.' })
  deactivate(@Param('id', ParseIntPipe) id: number): Promise<Subject> {
    return this.subjects.setActive(id, false);
  }
}
