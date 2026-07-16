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
import { CreateEntranceExamDto } from '../dto/create-entrance-exam.dto';
import { ListEntranceExamsDto } from '../dto/list-entrance-exams.dto';
import { UpdateEntranceExamDto } from '../dto/update-entrance-exam.dto';
import { EntranceExam } from '../entities/entrance-exam.entity';
import {
  EntranceExamsService,
  ListEntranceExamsResult,
} from './entrance-exams.service';

@ApiTags('entrance-exams')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/entrance-exams')
export class EntranceExamsController {
  constructor(private readonly exams: EntranceExamsService) {}

  @Get()
  @ApiOperation({
    summary:
      'List entrance exams with server-side pagination, search, and sort.',
  })
  list(@Query() query: ListEntranceExamsDto): Promise<ListEntranceExamsResult> {
    return this.exams.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single entrance exam by ID.' })
  getOne(@Param('id', ParseIntPipe) id: number): Promise<EntranceExam> {
    return this.exams.getOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new entrance exam.' })
  create(@Body() dto: CreateEntranceExamDto): Promise<EntranceExam> {
    return this.exams.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an entrance exam.' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEntranceExamDto,
  ): Promise<EntranceExam> {
    return this.exams.update(id, dto);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate an entrance exam.' })
  activate(@Param('id', ParseIntPipe) id: number): Promise<EntranceExam> {
    return this.exams.setActive(id, true);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate an entrance exam.' })
  deactivate(@Param('id', ParseIntPipe) id: number): Promise<EntranceExam> {
    return this.exams.setActive(id, false);
  }
}
