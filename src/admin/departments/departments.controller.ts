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
import { CreateDepartmentDto } from '../dto/create-department.dto';
import { ListDepartmentsDto } from '../dto/list-departments.dto';
import { UpdateDepartmentDto } from '../dto/update-department.dto';
import { Department } from '../entities/department.entity';
import {
  DepartmentsService,
  ListDepartmentsResult,
} from './departments.service';

@ApiTags('departments')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  @ApiOperation({
    summary: 'List departments with server-side pagination, search, and sort.',
  })
  list(@Query() query: ListDepartmentsDto): Promise<ListDepartmentsResult> {
    return this.departments.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single department by ID.' })
  getOne(@Param('id', ParseIntPipe) id: number): Promise<Department> {
    return this.departments.getOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new department.' })
  create(@Body() dto: CreateDepartmentDto): Promise<Department> {
    return this.departments.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a department.' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDepartmentDto,
  ): Promise<Department> {
    return this.departments.update(id, dto);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a department.' })
  activate(@Param('id', ParseIntPipe) id: number): Promise<Department> {
    return this.departments.setActive(id, true);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a department.' })
  deactivate(@Param('id', ParseIntPipe) id: number): Promise<Department> {
    return this.departments.setActive(id, false);
  }
}
