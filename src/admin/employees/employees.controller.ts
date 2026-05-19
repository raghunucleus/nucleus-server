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
import { BulkCreateEmployeesDto } from '../dto/bulk-create-employees.dto';
import { CreateEmployeeDto } from '../dto/create-employee.dto';
import { ListEmployeesDto } from '../dto/list-employees.dto';
import { UpdateEmployeeDto } from '../dto/update-employee.dto';
import { Employee } from '../entities/employee.entity';
import {
  EmployeesService,
  ListEmployeesResult,
} from './employees.service';

@ApiTags('employees')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @ApiOperation({
    summary: 'List employees with server-side pagination, search, and sort.',
  })
  list(@Query() query: ListEmployeesDto): Promise<ListEmployeesResult> {
    return this.employees.list(query);
  }

  @Get('emp-codes')
  @ApiOperation({
    summary: 'List every emp_code in the table — for bulk-upload validation.',
  })
  listEmpCodes(): Promise<{ codes: string[] }> {
    return this.employees
      .listEmpCodes()
      .then((codes) => ({ codes }));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single employee by ID.' })
  getOne(@Param('id', ParseIntPipe) id: number): Promise<Employee> {
    return this.employees.getOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new employee.' })
  create(@Body() dto: CreateEmployeeDto): Promise<Employee> {
    return this.employees.create(dto);
  }

  @Post('bulk')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Bulk-create employees in a single transaction. Returns 400 with per-row errors on validation failure; commits all or none.',
  })
  bulkCreate(
    @Body() dto: BulkCreateEmployeesDto,
  ): Promise<{ created: number }> {
    return this.employees.bulkCreate(dto.rows);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an employee.' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEmployeeDto,
  ): Promise<Employee> {
    return this.employees.update(id, dto);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate an employee.' })
  activate(@Param('id', ParseIntPipe) id: number): Promise<Employee> {
    return this.employees.setActive(id, true);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate an employee.' })
  deactivate(@Param('id', ParseIntPipe) id: number): Promise<Employee> {
    return this.employees.setActive(id, false);
  }
}
