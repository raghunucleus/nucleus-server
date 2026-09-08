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
import { CreateLeaveTypeDto } from '../dto/create-leave-type.dto';
import { ListLeaveTypesDto } from '../dto/list-leave-types.dto';
import { UpdateLeaveTypeDto } from '../dto/update-leave-type.dto';
import { LeaveType } from '../entities/leave-type.entity';
import { LeaveTypesService, ListLeaveTypesResult } from './leave-types.service';

@ApiTags('leave-types')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/leave-types')
export class LeaveTypesController {
  constructor(private readonly leaveTypes: LeaveTypesService) {}

  @Get()
  @ApiOperation({
    summary: 'List leave types with server-side pagination, search, and sort.',
  })
  list(@Query() query: ListLeaveTypesDto): Promise<ListLeaveTypesResult> {
    return this.leaveTypes.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single leave type by ID.' })
  getOne(@Param('id', ParseIntPipe) id: number): Promise<LeaveType> {
    return this.leaveTypes.getOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new leave type.' })
  create(@Body() dto: CreateLeaveTypeDto): Promise<LeaveType> {
    return this.leaveTypes.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a leave type.' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLeaveTypeDto,
  ): Promise<LeaveType> {
    return this.leaveTypes.update(id, dto);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a leave type.' })
  activate(@Param('id', ParseIntPipe) id: number): Promise<LeaveType> {
    return this.leaveTypes.setActive(id, true);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a leave type.' })
  deactivate(@Param('id', ParseIntPipe) id: number): Promise<LeaveType> {
    return this.leaveTypes.setActive(id, false);
  }
}
