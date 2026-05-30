import {
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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { GetStudent } from '../auth/get-student.decorator';
import { RequirePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { StudentJwtAuthGuard } from '../auth/student-jwt-auth.guard';
import type { AuthenticatedStudent } from '../auth/student-jwt.strategy';
import {
  RegisterPushTokenDto,
  UnregisterPushTokenDto,
} from './dto/student-notification.dto';
import { StudentNotificationService } from './student-notification.service';
import type { StudentNotificationsPage } from './student-notification.types';

const MAX_PAGE = 100;

/**
 * REST surface for student notifications — the history/list reads, mark-read,
 * and device push-token management that complement the realtime gateway. The
 * acting student is taken ONLY from the JWT (`@GetStudent()`); no route param,
 * query or body ever identifies the caller (student-isolation contract).
 */
@ApiTags('student-notifications')
@ApiBearerAuth('student-access-token')
@UseGuards(StudentJwtAuthGuard, RequirePasswordChangedGuard)
@Controller('student/notifications')
export class StudentNotificationsController {
  constructor(private readonly notifications: StudentNotificationService) {}

  @Get()
  @ApiOperation({
    summary:
      "A page of the caller's notifications (newest first) with the unread " +
      'total. Seek older pages with `before=<oldest id seen>`.',
  })
  @ApiQuery({ name: 'limit', required: false, description: 'Page size (1–100, default 30).' })
  @ApiQuery({ name: 'before', required: false, description: 'Return notifications with id < this.' })
  @ApiQuery({ name: 'unread', required: false, description: 'When "true", only unread notifications.' })
  list(
    @GetStudent() s: AuthenticatedStudent,
    @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit: number,
    @Query('before', new ParseIntPipe({ optional: true })) before?: number,
    @Query('unread') unread?: string,
  ): Promise<StudentNotificationsPage> {
    return this.notifications.list(s.id, {
      limit: clamp(limit, 1, MAX_PAGE),
      before,
      unread: unread === 'true',
    });
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread notification count — for the header/tab badge.' })
  async unread(
    @GetStudent() s: AuthenticatedStudent,
  ): Promise<{ total: number }> {
    return { total: await this.notifications.unreadCount(s.id) };
  }

  @Patch('read-all')
  @ApiOperation({ summary: "Mark all the caller's notifications as read." })
  markAllRead(
    @GetStudent() s: AuthenticatedStudent,
  ): Promise<{ unread: number }> {
    return this.notifications.markAllRead(s.id);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one notification (the caller owns) as read.' })
  markRead(
    @GetStudent() s: AuthenticatedStudent,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ unread: number }> {
    return this.notifications.markRead(s.id, id);
  }

  @Post('push-tokens')
  @HttpCode(204)
  @ApiOperation({
    summary: "Register (or refresh) this device's Expo push token for the caller.",
  })
  async register(
    @GetStudent() s: AuthenticatedStudent,
    @Body() dto: RegisterPushTokenDto,
  ): Promise<void> {
    await this.notifications.registerPushToken(s.id, dto);
  }

  @Delete('push-tokens')
  @HttpCode(204)
  @ApiOperation({ summary: "Unregister this device's Expo push token." })
  async unregister(
    @GetStudent() s: AuthenticatedStudent,
    @Body() dto: UnregisterPushTokenDto,
  ): Promise<void> {
    await this.notifications.unregisterPushToken(s.id, dto.expoPushToken);
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}
