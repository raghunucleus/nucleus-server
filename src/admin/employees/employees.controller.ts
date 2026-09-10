import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
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
import { SetEmployeePasswordDto } from '../dto/set-employee-password.dto';
import { UpdateEmployeeDto } from '../dto/update-employee.dto';
import { Employee } from '../entities/employee.entity';
import {
  EmployeeSessionsView,
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
    return this.employees.listEmpCodes().then((codes) => ({ codes }));
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

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Provision or reset the employee's login: emails a temporary password " +
      'to their registered address and forces a change on first sign-in.',
  })
  resetPassword(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ email: string }> {
    return this.employees.resetLoginPassword(id);
  }

  @Post(':id/set-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      "Directly set the employee's login password to a chosen value (no " +
      'email is sent). Forces a change on first sign-in and revokes sessions.',
  })
  setPassword(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetEmployeePasswordDto,
  ): Promise<void> {
    return this.employees.setLoginPassword(id, dto.password);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate an employee.' })
  activate(@Param('id', ParseIntPipe) id: number): Promise<Employee> {
    return this.employees.setActive(id, true);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Deactivate an employee. Signs them out of every device.',
  })
  deactivate(@Param('id', ParseIntPipe) id: number): Promise<Employee> {
    return this.employees.setActive(id, false);
  }

  @Get(':id/sessions')
  @ApiOperation({
    summary:
      "List the employee's signed-in devices (with login IP) and the device " +
      'limit they count against.',
  })
  listSessions(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<EmployeeSessionsView> {
    return this.employees.listSessions(id);
  }

  @Delete(':id/sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Force-sign-out one of the employee’s devices.' })
  async revokeSession(
    @Param('id', ParseIntPipe) id: number,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ): Promise<void> {
    await this.employees.revokeSession(id, sessionId);
  }
}
