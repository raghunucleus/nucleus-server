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
import { CreateDiplomaBoardDto } from '../dto/create-diploma-board.dto';
import { ListDiplomaBoardsDto } from '../dto/list-diploma-boards.dto';
import { UpdateDiplomaBoardDto } from '../dto/update-diploma-board.dto';
import { DiplomaBoard } from '../entities/diploma-board.entity';
import {
  DiplomaBoardsService,
  ListDiplomaBoardsResult,
} from './diploma-boards.service';

@ApiTags('diploma-boards')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/diploma-boards')
export class DiplomaBoardsController {
  constructor(private readonly boards: DiplomaBoardsService) {}

  @Get()
  @ApiOperation({
    summary:
      'List diploma boards with server-side pagination, search, and sort.',
  })
  list(@Query() query: ListDiplomaBoardsDto): Promise<ListDiplomaBoardsResult> {
    return this.boards.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single diploma board by ID.' })
  getOne(@Param('id', ParseIntPipe) id: number): Promise<DiplomaBoard> {
    return this.boards.getOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new diploma board.' })
  create(@Body() dto: CreateDiplomaBoardDto): Promise<DiplomaBoard> {
    return this.boards.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a diploma board.' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDiplomaBoardDto,
  ): Promise<DiplomaBoard> {
    return this.boards.update(id, dto);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a diploma board.' })
  activate(@Param('id', ParseIntPipe) id: number): Promise<DiplomaBoard> {
    return this.boards.setActive(id, true);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a diploma board.' })
  deactivate(@Param('id', ParseIntPipe) id: number): Promise<DiplomaBoard> {
    return this.boards.setActive(id, false);
  }
}
