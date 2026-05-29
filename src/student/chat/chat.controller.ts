import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
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
  ChatConversationSummary,
  ChatMessagesPage,
  ChatService,
} from './chat.service';
import { StartConversationDto } from './dto/chat.dto';

const MAX_PAGE = 100;

/**
 * REST surface for student chat — the history/list reads that complement the
 * realtime gateway. The acting student is taken ONLY from the JWT
 * (`@GetStudent()`); no route param, query or body identifies the caller. The
 * one body-supplied id (`POST /conversations`) is the *other* participant, i.e.
 * legitimate "who do I want to talk to" input, and is access-checked server-side.
 */
@ApiTags('student-chat')
@ApiBearerAuth('student-access-token')
@UseGuards(StudentJwtAuthGuard, RequirePasswordChangedGuard)
@Controller('student/chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('config')
  @ApiOperation({
    summary:
      'Client-facing chat settings. `retention_days` mirrors the server env ' +
      'so the UI can tell students how long messages are kept before deletion.',
  })
  config(): { retention_days: number } {
    return { retention_days: this.chat.retentionDays() };
  }

  @Get('contacts')
  @ApiOperation({
    summary:
      "Active classmates in the caller's own attendance group (from the JWT) " +
      'that they can start a one-to-one chat with.',
  })
  contacts(@GetStudent() s: AuthenticatedStudent) {
    return this.chat.listContacts(s.id);
  }

  @Get('conversations')
  @ApiOperation({
    summary:
      "The caller's existing conversations (those with at least one message), " +
      'newest first, each with the other participant, a preview and unread count.',
  })
  conversations(
    @GetStudent() s: AuthenticatedStudent,
  ): Promise<ChatConversationSummary[]> {
    return this.chat.listConversations(s.id);
  }

  @Post('conversations')
  @ApiOperation({
    summary:
      'Open (find or create) the one-to-one conversation between the caller ' +
      'and `studentId`. Rejected unless both share an attendance group.',
  })
  async open(
    @GetStudent() s: AuthenticatedStudent,
    @Body() dto: StartConversationDto,
  ): Promise<{ id: number; other_id: number }> {
    const conv = await this.chat.getOrCreateConversation(s.id, dto.studentId);
    return { id: conv.id, other_id: this.chat.otherParticipant(conv, s.id) };
  }

  @Get('conversations/:id/messages')
  @ApiOperation({
    summary:
      'A page of message history (newest first) for a conversation the caller ' +
      'participates in. Seek older pages with `before=<oldest id seen>`.',
  })
  @ApiQuery({ name: 'limit', required: false, description: 'Page size (1–100, default 30).' })
  @ApiQuery({ name: 'before', required: false, description: 'Return messages with id < this.' })
  messages(
    @GetStudent() s: AuthenticatedStudent,
    @Param('id', ParseIntPipe) id: number,
    @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit: number,
    @Query('before', new ParseIntPipe({ optional: true })) before?: number,
  ): Promise<ChatMessagesPage> {
    return this.chat.listMessages(s.id, id, before, clamp(limit, 1, MAX_PAGE));
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Total unread messages across all conversations — for the Connect badge.' })
  async unread(
    @GetStudent() s: AuthenticatedStudent,
  ): Promise<{ total: number }> {
    return { total: await this.chat.totalUnread(s.id) };
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}
