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
import type { SessionRow } from '../../auth-sessions/auth-sessions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireTotpEnrolledGuard } from '../auth/require-totp-enrolled.guard';
import { BulkUploadGuardiansDto } from '../dto/bulk-upload-guardians.dto';
import { CreateGuardianDto } from '../dto/create-guardian.dto';
import { ListGuardiansDto } from '../dto/list-guardians.dto';
import {
  GuardianMobileDto,
  SetGuardianPasswordDto,
} from '../dto/set-guardian-password.dto';
import { UpdateGuardianDto } from '../dto/update-guardian.dto';
import { StudentGuardian } from '../../guardian/entities/student-guardian.entity';
import {
  BulkUploadResult,
  GuardiansService,
  ListGuardiansResult,
} from './guardians.service';

@ApiTags('guardians')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/guardians')
export class GuardiansController {
  constructor(private readonly guardians: GuardiansService) {}

  @Get()
  @ApiOperation({
    summary:
      'List guardian contacts (per-student) with pagination and search by ' +
      'name, mobile, or student roll.',
  })
  list(@Query() query: ListGuardiansDto): Promise<ListGuardiansResult> {
    return this.guardians.list(query);
  }

  @Get('by-student/:studentId')
  @ApiOperation({ summary: 'All guardian contacts for a student.' })
  byStudent(
    @Param('studentId', ParseIntPipe) studentId: number,
  ): Promise<StudentGuardian[]> {
    return this.guardians.listForStudent(studentId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a guardian contact to a student.' })
  create(@Body() dto: CreateGuardianDto): Promise<StudentGuardian> {
    return this.guardians.create(dto);
  }

  @Post('bulk-upload')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Bulk-upsert guardian contacts from a per-student sheet (father/mother/' +
      'guardian). Stored per-student; no cross-student dedup. All-or-nothing ' +
      'with per-row errors.',
  })
  bulkUpload(@Body() dto: BulkUploadGuardiansDto): Promise<BulkUploadResult> {
    return this.guardians.bulkUpload(dto.rows);
  }

  @Post('set-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Set the login password for a mobile number (out-of-band fallback). ' +
      'Forces a change on first sign-in and revokes active sessions.',
  })
  setPassword(@Body() dto: SetGuardianPasswordDto): Promise<void> {
    return this.guardians.setLoginPassword(dto.mobile_number, dto.password);
  }

  @Post('send-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Trigger a password OTP to a mobile via the first usable channel.',
  })
  async sendOtp(@Body() dto: GuardianMobileDto): Promise<{ message: string }> {
    await this.guardians.sendOtp(dto.mobile_number);
    return { message: 'If a delivery channel is available, a code was sent.' };
  }

  @Get('sessions')
  @ApiOperation({
    summary:
      "List a parent login's signed-in devices (with login IP), by mobile.",
  })
  listSessions(@Query() dto: GuardianMobileDto): Promise<SessionRow[]> {
    return this.guardians.listSessions(dto.mobile_number);
  }

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Force-sign-out one of a parent login's devices." })
  async revokeSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Query() dto: GuardianMobileDto,
  ): Promise<void> {
    await this.guardians.revokeSession(dto.mobile_number, sessionId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a guardian contact.' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGuardianDto,
  ): Promise<StudentGuardian> {
    return this.guardians.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Remove a guardian contact (revokes that mobile’s sessions if it is ' +
      'no longer attached to any student).',
  })
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.guardians.remove(id);
  }
}
