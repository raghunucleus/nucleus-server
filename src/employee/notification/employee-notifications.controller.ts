import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { EmployeeJwtAuthGuard } from '../auth/employee-jwt-auth.guard';
import type { AuthenticatedEmployee } from '../auth/employee-jwt.strategy';
import { GetEmployee } from '../auth/get-employee.decorator';
import { RequireEmployeePasswordChangedGuard } from '../auth/require-password-changed.guard';
import {
  EmployeeNotificationModuleKeySchema,
  RegisterPushTokenDto,
  UnregisterPushTokenDto,
  UpdateNotificationPreferenceDto,
} from './dto/employee-notification.dto';
import { EmployeeNotificationService } from './employee-notification.service';
import type {
  EmployeeNotificationModuleKey,
  EmployeeNotificationPreferenceDto,
  EmployeeNotificationsPage,
} from './employee-notification.types';

const MAX_PAGE = 100;

/**
 * REST surface for employee notifications — the history/list reads, mark-read,
 * device push-token management and delivery preferences that complement the
 * realtime gateway.
 *
 * No ScreenAccessGuard here on purpose: every route is self-scoped to the
 * caller's own notifications, taken ONLY from the JWT (`@GetEmployee()`). No
 * route param, query or body ever identifies the employee, so there is nothing
 * to scope and no RBAC screen to gate. This is the same shape as the student
 * notifications controller.
 */
@ApiTags('employee-notifications')
@ApiBearerAuth('employee-access-token')
@UseGuards(EmployeeJwtAuthGuard, RequireEmployeePasswordChangedGuard)
@Controller('employee/notifications')
export class EmployeeNotificationsController {
  constructor(private readonly notifications: EmployeeNotificationService) {}

  @Get()
  @ApiOperation({
    summary:
      "A page of the caller's notifications (newest first) with the unread " +
      'total. Seek older pages with `before=<oldest id seen>`.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Page size (1–100, default 30).',
  })
  @ApiQuery({
    name: 'before',
    required: false,
    description: 'Return notifications with id < this.',
  })
  @ApiQuery({
    name: 'unread',
    required: false,
    description: 'When "true", only unread notifications.',
  })
  list(
    @GetEmployee() e: AuthenticatedEmployee,
    @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit: number,
    @Query('before', new ParseIntPipe({ optional: true })) before?: number,
    @Query('unread') unread?: string,
  ): Promise<EmployeeNotificationsPage> {
    return this.notifications.list(e.id, {
      limit: clamp(limit, 1, MAX_PAGE),
      before,
      unread: unread === 'true',
    });
  }

  @Get('unread-count')
  @ApiOperation({
    summary: 'Unread notification count — for the header/tab badge.',
  })
  async unread(
    @GetEmployee() e: AuthenticatedEmployee,
  ): Promise<{ total: number }> {
    return { total: await this.notifications.unreadCount(e.id) };
  }

  @Get('preferences')
  @ApiOperation({
    summary:
      "The caller's effective per-module delivery preferences — every module, " +
      'with stored overrides layered over the defaults.',
  })
  getPreferences(
    @GetEmployee() e: AuthenticatedEmployee,
  ): Promise<EmployeeNotificationPreferenceDto[]> {
    return this.notifications.getPreferences(e.id);
  }

  @Patch('preferences/:moduleKey')
  @ApiOperation({
    summary:
      "Mute or unmute a channel for one module. In-app can't be switched off.",
  })
  setPreference(
    @GetEmployee() e: AuthenticatedEmployee,
    @Param('moduleKey') moduleKey: string,
    @Body() dto: UpdateNotificationPreferenceDto,
  ): Promise<EmployeeNotificationPreferenceDto> {
    return this.notifications.setPreference(
      e.id,
      parseModuleKey(moduleKey),
      dto,
    );
  }

  @Patch('read-all')
  @ApiOperation({ summary: "Mark all the caller's notifications as read." })
  markAllRead(
    @GetEmployee() e: AuthenticatedEmployee,
  ): Promise<{ unread: number }> {
    return this.notifications.markAllRead(e.id);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one notification (the caller owns) as read.' })
  markRead(
    @GetEmployee() e: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ unread: number }> {
    return this.notifications.markRead(e.id, id);
  }

  @Post('push-tokens')
  @HttpCode(204)
  @ApiOperation({
    summary:
      "Register (or refresh) this device's Expo push token for the caller.",
  })
  async register(
    @GetEmployee() e: AuthenticatedEmployee,
    @Body() dto: RegisterPushTokenDto,
  ): Promise<void> {
    await this.notifications.registerPushToken(e.id, dto);
  }

  @Delete('push-tokens')
  @HttpCode(204)
  @ApiOperation({ summary: "Unregister this device's Expo push token." })
  async unregister(
    @GetEmployee() e: AuthenticatedEmployee,
    @Body() dto: UnregisterPushTokenDto,
  ): Promise<void> {
    await this.notifications.unregisterPushToken(e.id, dto.expoPushToken);
  }
}

function parseModuleKey(raw: string): EmployeeNotificationModuleKey {
  const parsed = EmployeeNotificationModuleKeySchema.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequestException(`Unknown notification module "${raw}".`);
  }
  return parsed.data as EmployeeNotificationModuleKey;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}
