import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireTotpEnrolledGuard } from '../auth/require-totp-enrolled.guard';
import { BulkSetSlotEnrollmentsDto } from '../dto/bulk-set-slot-enrollments.dto';
import {
  SlotEnrollmentsService,
  type SlotEnrollmentView,
} from './slot-enrollments.service';

// Endpoints are nested under /programme-semester-subjects/:slotId/enrollments
// to keep the existing PSS controller focused. The slot row IS the parent
// resource so this isn't a violation of REST nesting — it's the only place
// these enrollments live.
@ApiTags('programme-semester-subject-enrollments')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/programme-semester-subjects')
export class SlotEnrollmentsController {
  constructor(private readonly svc: SlotEnrollmentsService) {}

  @Get(':slotId/enrollments')
  @ApiOperation({
    summary:
      "Enrollment matrix for a slot: candidates (with faculty/student counts), the slot's batch student roster, and each student's current pick.",
  })
  getView(
    @Param('slotId', ParseIntPipe) slotId: number,
  ): Promise<SlotEnrollmentView> {
    return this.svc.getView(slotId);
  }

  @Post(':slotId/enrollments/bulk')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Bulk-set enrollments for a slot. Each row replaces the listed student's pick for the slot; students NOT in the payload are untouched. Returns 400 with per-row errors on validation failure.",
  })
  bulkSet(
    @Param('slotId', ParseIntPipe) slotId: number,
    @Body() dto: BulkSetSlotEnrollmentsDto,
  ): Promise<{ applied: number; cleared: number }> {
    return this.svc.bulkSetForSlot(slotId, dto.rows);
  }
}
