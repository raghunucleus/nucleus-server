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
import { CreateSchoolBoardXDto } from '../dto/create-school-board-x.dto';
import { ListSchoolBoardsXDto } from '../dto/list-school-boards-x.dto';
import { UpdateSchoolBoardXDto } from '../dto/update-school-board-x.dto';
import { SchoolBoardX } from '../entities/school-board-x.entity';
import {
  ListSchoolBoardsXResult,
  SchoolBoardsXService,
} from './school-boards-x.service';

@ApiTags('school-boards-x')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/school-boards-x')
export class SchoolBoardsXController {
  constructor(private readonly boards: SchoolBoardsXService) {}

  @Get()
  @ApiOperation({
    summary: 'List Xth boards with server-side pagination, search, and sort.',
  })
  list(@Query() query: ListSchoolBoardsXDto): Promise<ListSchoolBoardsXResult> {
    return this.boards.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single Xth board by ID.' })
  getOne(@Param('id', ParseIntPipe) id: number): Promise<SchoolBoardX> {
    return this.boards.getOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new Xth board.' })
  create(@Body() dto: CreateSchoolBoardXDto): Promise<SchoolBoardX> {
    return this.boards.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an Xth board.' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSchoolBoardXDto,
  ): Promise<SchoolBoardX> {
    return this.boards.update(id, dto);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate an Xth board.' })
  activate(@Param('id', ParseIntPipe) id: number): Promise<SchoolBoardX> {
    return this.boards.setActive(id, true);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate an Xth board.' })
  deactivate(@Param('id', ParseIntPipe) id: number): Promise<SchoolBoardX> {
    return this.boards.setActive(id, false);
  }
}
