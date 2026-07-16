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
import { CreateSchoolBoardXiiDto } from '../dto/create-school-board-xii.dto';
import { ListSchoolBoardsXiiDto } from '../dto/list-school-boards-xii.dto';
import { UpdateSchoolBoardXiiDto } from '../dto/update-school-board-xii.dto';
import { SchoolBoardXii } from '../entities/school-board-xii.entity';
import {
  ListSchoolBoardsXiiResult,
  SchoolBoardsXiiService,
} from './school-boards-xii.service';

@ApiTags('school-boards-xii')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/school-boards-xii')
export class SchoolBoardsXiiController {
  constructor(private readonly boards: SchoolBoardsXiiService) {}

  @Get()
  @ApiOperation({
    summary: 'List XIIth boards with server-side pagination, search, and sort.',
  })
  list(
    @Query() query: ListSchoolBoardsXiiDto,
  ): Promise<ListSchoolBoardsXiiResult> {
    return this.boards.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single XIIth board by ID.' })
  getOne(@Param('id', ParseIntPipe) id: number): Promise<SchoolBoardXii> {
    return this.boards.getOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new XIIth board.' })
  create(@Body() dto: CreateSchoolBoardXiiDto): Promise<SchoolBoardXii> {
    return this.boards.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a XIIth board.' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSchoolBoardXiiDto,
  ): Promise<SchoolBoardXii> {
    return this.boards.update(id, dto);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a XIIth board.' })
  activate(@Param('id', ParseIntPipe) id: number): Promise<SchoolBoardXii> {
    return this.boards.setActive(id, true);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a XIIth board.' })
  deactivate(@Param('id', ParseIntPipe) id: number): Promise<SchoolBoardXii> {
    return this.boards.setActive(id, false);
  }
}
