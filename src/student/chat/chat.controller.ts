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
import { ChatGateway } from './chat.gateway';
import {
  ChatContactsPage,
  ChatConversationMeta,
  ChatConversationSummary,
  ChatMessagesPage,
  ChatRequestSummary,
  ChatService,
} from './chat.service';
import { AcceptRequestDto, StartConversationDto } from './dto/chat.dto';

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
  constructor(
    private readonly chat: ChatService,
    private readonly gateway: ChatGateway,
  ) {}

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
      'that they can start a one-to-one chat with. Name-ordered, with ' +
      'server-side search (`q` over name or roll number) and offset pagination.',
  })
  @ApiQuery({ name: 'q', required: false, description: 'Search over display name or roll number.' })
  @ApiQuery({ name: 'limit', required: false, description: 'Page size (1–100, default 30).' })
  @ApiQuery({ name: 'offset', required: false, description: 'Rows to skip (default 0).' })
  contacts(
    @GetStudent() s: AuthenticatedStudent,
    @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('q') q?: string,
  ): Promise<ChatContactsPage> {
    return this.chat.listContacts(s.id, {
      limit: clamp(limit, 1, MAX_PAGE),
      offset: Number.isFinite(offset) && offset > 0 ? Math.trunc(offset) : 0,
      q,
    });
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

  @Get('requests')
  @ApiOperation({
    summary:
      'Incoming message requests — people who messaged the caller and whose ' +
      'conversation the caller has not yet accepted. The Requests inbox.',
  })
  requests(
    @GetStudent() s: AuthenticatedStudent,
  ): Promise<ChatRequestSummary[]> {
    return this.chat.listRequests(s.id);
  }

  @Get('restricted')
  @ApiOperation({
    summary:
      'Conversations the caller has muted and/or blocked (any status) — the ' +
      '"Blocked & muted" management list. Also the only place a request the ' +
      'caller declined by blocking can be found and unblocked.',
  })
  restricted(
    @GetStudent() s: AuthenticatedStudent,
  ): Promise<ChatConversationSummary[]> {
    return this.chat.listRestricted(s.id);
  }

  @Post('conversations/:id/accept')
  @ApiOperation({
    summary:
      'Accept an incoming request, unlocking the conversation for both sides. ' +
      'Pass `{ "mute": true }` to accept and mute in one step.',
  })
  async accept(
    @GetStudent() s: AuthenticatedStudent,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AcceptRequestDto,
  ): Promise<{ ok: true }> {
    const { otherId } = await this.chat.acceptRequest(s.id, id, dto.mute ?? false);
    // Unlock the inviter's thread in realtime (no-op if they're offline).
    this.gateway.notifyAccepted(otherId, id, s.id);
    return { ok: true };
  }

  @Post('conversations/:id/block')
  @ApiOperation({
    summary:
      'Block the other participant. Their future messages are silently dropped ' +
      '(they are never told). Works on a pending request (declines it) or an ' +
      'accepted conversation.',
  })
  async block(
    @GetStudent() s: AuthenticatedStudent,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ ok: true }> {
    await this.chat.blockConversation(s.id, id);
    return { ok: true };
  }

  @Post('conversations/:id/unblock')
  @ApiOperation({ summary: 'Unblock the other participant.' })
  async unblock(
    @GetStudent() s: AuthenticatedStudent,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ ok: true }> {
    await this.chat.unblockConversation(s.id, id);
    return { ok: true };
  }

  @Post('conversations/:id/mute')
  @ApiOperation({
    summary:
      'Mute the conversation — suppresses the caller\'s push notifications. ' +
      'Messages still arrive and accrue unread.',
  })
  async mute(
    @GetStudent() s: AuthenticatedStudent,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ ok: true }> {
    await this.chat.muteConversation(s.id, id);
    return { ok: true };
  }

  @Post('conversations/:id/unmute')
  @ApiOperation({ summary: 'Unmute the conversation.' })
  async unmute(
    @GetStudent() s: AuthenticatedStudent,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ ok: true }> {
    await this.chat.unmuteConversation(s.id, id);
    return { ok: true };
  }

  @Get('conversations/:id')
  @ApiOperation({
    summary:
      "The caller's consent/block/mute state for one conversation (status, " +
      'whether they initiated it, muted, blocked-by-me) — drives the thread ' +
      'composer state. 404 if the caller is not a participant.',
  })
  conversationMeta(
    @GetStudent() s: AuthenticatedStudent,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ChatConversationMeta> {
    return this.chat.conversationMeta(s.id, id);
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

  @Get('conversations/:id/messages/search')
  @ApiOperation({
    summary:
      "Search a conversation's full history for messages whose body contains " +
      '`q` (case-insensitive, newest first). Scoped to a conversation the ' +
      'caller participates in. Page older matches with `before=<oldest id seen>`.',
  })
  @ApiQuery({ name: 'q', required: true, description: 'Search term (min 1 char).' })
  @ApiQuery({ name: 'limit', required: false, description: 'Page size (1–100, default 30).' })
  @ApiQuery({ name: 'before', required: false, description: 'Return matches with id < this.' })
  searchMessages(
    @GetStudent() s: AuthenticatedStudent,
    @Param('id', ParseIntPipe) id: number,
    @Query('q') q: string,
    @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit: number,
    @Query('before', new ParseIntPipe({ optional: true })) before?: number,
  ): Promise<ChatMessagesPage> {
    return this.chat.searchMessages(s.id, id, q ?? '', clamp(limit, 1, MAX_PAGE), before);
  }

  @Get('unread-count')
  @ApiOperation({
    summary:
      'Total unread messages across accepted conversations (for the Connect ' +
      'badge) plus the number of pending incoming requests (for the Requests badge).',
  })
  async unread(
    @GetStudent() s: AuthenticatedStudent,
  ): Promise<{ total: number; pending_requests: number }> {
    const [total, pending_requests] = await Promise.all([
      this.chat.totalUnread(s.id),
      this.chat.pendingRequestCount(s.id),
    ]);
    return { total, pending_requests };
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}
