import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AccountInviteService,
  ValidateInviteResult,
} from './account-invite.service';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { ValidateInviteDto } from './dto/validate-invite.dto';
import type { InviteSubjectType } from './entities/account-invite.entity';

/**
 * The public half of the invite flow — reached by someone who has no account
 * yet, so deliberately unguarded, exactly like the forgot/reset-password
 * handlers on the two auth controllers.
 *
 * Both routes are POST rather than GET so the token never lands in an access
 * log or a `Referer` header on the way to an analytics script.
 */
@ApiTags('account-invite')
@Controller('account-invite')
export class AccountInviteController {
  constructor(private readonly invites: AccountInviteService) {}

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Check an invitation token and, when it is good, return who it belongs ' +
      'to so the set-password screen can greet them. Always 200 — an expired ' +
      'invite is a state to render, not an error.',
  })
  validate(
    @Body() dto: ValidateInviteDto,
    @Ip() ip: string,
  ): Promise<ValidateInviteResult> {
    return this.invites.validateToken(dto.token, ip);
  }

  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Set the account password using an invitation token. The token is ' +
      'single-use and revokes any existing sessions.',
  })
  async accept(
    @Body() dto: AcceptInviteDto,
    @Ip() ip: string,
  ): Promise<{ message: string; subject_type: InviteSubjectType }> {
    const { subject_type } = await this.invites.acceptInvite(
      dto.token,
      dto.newPassword,
      ip,
    );
    return {
      message: 'Your password has been set. You can now sign in.',
      subject_type,
    };
  }
}
