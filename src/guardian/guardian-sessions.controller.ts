import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthSessionsService,
  SessionRow,
} from '../auth-sessions/auth-sessions.service';
import { GetGuardian } from './auth/get-guardian.decorator';
import { GuardianJwtAuthGuard } from './auth/guardian-jwt-auth.guard';
import type { AuthenticatedGuardian } from './auth/guardian-jwt.strategy';
import { GuardianRequirePasswordChangedGuard } from './auth/require-password-changed.guard';
import { GuardianAuthService } from './guardian-auth.service';

/**
 * "My devices" for a parent login: where this mobile number is signed in, and
 * signing one out. The subject is always the token's mobile (resolved to its
 * credential row); the `:id` is a session id looked up scoped to it, so a
 * foreign one is a 404.
 */
@ApiTags('guardian-sessions')
@ApiBearerAuth('guardian-access-token')
@UseGuards(GuardianJwtAuthGuard, GuardianRequirePasswordChangedGuard)
@Controller('guardian/sessions')
export class GuardianSessionsController {
  constructor(
    private readonly sessions: AuthSessionsService,
    private readonly auth: GuardianAuthService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Devices this parent login is signed in on, most recently active ' +
      'first; `current` marks the calling device.',
  })
  async list(@GetGuardian() g: AuthenticatedGuardian): Promise<SessionRow[]> {
    const credId = await this.auth.credentialIdFor(g.mobile_number);
    if (credId === null) return [];
    return this.sessions.list('guardian', credId, { currentSid: g.sid });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Sign one of your devices out. Signing out the current device ends ' +
      'this session too.',
  })
  async revoke(
    @GetGuardian() g: AuthenticatedGuardian,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    const credId = await this.auth.credentialIdFor(g.mobile_number);
    const ok =
      credId !== null &&
      (await this.sessions.revokeById('guardian', credId, id, 'user'));
    if (!ok) throw new NotFoundException('Session not found');
  }
}
