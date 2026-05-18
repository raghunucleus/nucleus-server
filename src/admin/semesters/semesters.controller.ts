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
import { CreateSemesterDto } from '../dto/create-semester.dto';
import { ListSemestersDto } from '../dto/list-semesters.dto';
import { UpdateSemesterDto } from '../dto/update-semester.dto';
import { Semester } from '../entities/semester.entity';
import { ListSemestersResult, SemestersService } from './semesters.service';

@ApiTags('semesters')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/semesters')
export class SemestersController {
  constructor(private readonly semesters: SemestersService) {}

  @Get()
  @ApiOperation({
    summary: 'List semesters with server-side pagination, search, and sort.',
  })
  list(@Query() query: ListSemestersDto): Promise<ListSemestersResult> {
    return this.semesters.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single semester by ID.' })
  getOne(@Param('id', ParseIntPipe) id: number): Promise<Semester> {
    return this.semesters.getOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new semester.' })
  create(@Body() dto: CreateSemesterDto): Promise<Semester> {
    return this.semesters.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a semester.' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSemesterDto,
  ): Promise<Semester> {
    return this.semesters.update(id, dto);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a semester.' })
  activate(@Param('id', ParseIntPipe) id: number): Promise<Semester> {
    return this.semesters.setActive(id, true);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a semester.' })
  deactivate(@Param('id', ParseIntPipe) id: number): Promise<Semester> {
    return this.semesters.setActive(id, false);
  }
}
