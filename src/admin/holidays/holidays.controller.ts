import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireTotpEnrolledGuard } from '../auth/require-totp-enrolled.guard';
import { CreateAcademicHolidayDto } from '../dto/create-academic-holiday.dto';
import { ListAcademicHolidaysDto } from '../dto/list-academic-holidays.dto';
import { UpdateAcademicHolidayDto } from '../dto/update-academic-holiday.dto';
import { AcademicHoliday } from '../entities/academic-holiday.entity';
import { DeclareResult, HolidaysService } from './holidays.service';

@ApiTags('academic-holidays')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/academic-holidays')
export class HolidaysController {
  constructor(private readonly holidays: HolidaysService) {}

  @Get()
  @ApiOperation({
    summary:
      'List institution-wide holidays, optionally filtered by date range.',
  })
  list(@Query() query: ListAcademicHolidaysDto): Promise<AcademicHoliday[]> {
    return this.holidays.list(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Declare a holiday. Already-scheduled sessions on matching dates are cancelled in the same transaction.',
  })
  declare(
    @Body() dto: CreateAcademicHolidayDto,
    @Req() req: { user?: { id?: string | number } },
  ): Promise<DeclareResult> {
    const adminId =
      req.user?.id !== undefined ? Number(req.user.id) : undefined;
    return this.holidays.declare(dto, { admin_id: adminId });
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Edit a holiday. Scheduled sessions newly caught by the edited range are cancelled; previously-cancelled sessions are never restored.',
  })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAcademicHolidayDto,
    @Req() req: { user?: { id?: string | number } },
  ): Promise<DeclareResult> {
    const adminId =
      req.user?.id !== undefined ? Number(req.user.id) : undefined;
    return this.holidays.update(id, dto, { admin_id: adminId });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Remove a holiday. Sessions cancelled by it stay cancelled — re-opening a class is a separate group-incharge action.',
  })
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.holidays.remove(id);
  }
}
