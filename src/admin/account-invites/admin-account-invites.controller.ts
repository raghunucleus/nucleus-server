import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AccountInviteService,
  InviteHistoryRow,
  InvitePreviewRow,
  SendInvitesResult,
} from '../../account-invites/account-invite.service';
import type { BatchFilter } from '../../account-invites/account-invite-subjects';
import { GetAdmin } from '../auth/get-admin.decorator';
import type { AuthenticatedAdmin } from '../auth/jwt.strategy';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireTotpEnrolledGuard } from '../auth/require-totp-enrolled.guard';
import {
  ListAccountInvitesDto,
  PreviewAccountInvitesDto,
  RevokeAccountInviteDto,
  SendAccountInvitesDto,
} from './dto/send-account-invites.dto';

@ApiTags('account-invites')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/account-invites')
export class AdminAccountInvitesController {
  constructor(private readonly invites: AccountInviteService) {}

  @Post('send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Send account invitations to an explicit list of employees/students or ' +
      'to a whole programme/department batch. Resolves 200 with a per-recipient ' +
      'summary even when individual sends fail — the summary is the point.',
  })
  send(
    @Body() dto: SendAccountInvitesDto,
    @GetAdmin() admin: AuthenticatedAdmin,
  ): Promise<SendInvitesResult> {
    return this.invites.sendInvites(
      {
        subject_type: dto.subject_type,
        subject_ids: dto.subject_ids,
        filter: dto.filter,
        only_uninvited: dto.only_uninvited,
        resend: dto.resend,
      },
      Number(admin.id),
    );
  }

  @Get('preview')
  @ApiOperation({
    summary:
      'How many people a whole-batch send would reach, plus the first ten, so ' +
      'the confirmation dialog can show what is about to happen.',
  })
  preview(
    @Query() dto: PreviewAccountInvitesDto,
  ): Promise<{ total: number; sample: InvitePreviewRow[] }> {
    const filter: BatchFilter =
      dto.subject_type === 'student'
        ? {
            programme_id: dto.programme_id as number,
            admission_year_id: dto.admission_year_id as number,
          }
        : { department_id: dto.department_id as number };
    return this.invites.previewBatch(
      dto.subject_type,
      filter,
      dto.only_uninvited,
    );
  }

  @Get()
  @ApiOperation({ summary: 'Invitation history for one employee or student.' })
  list(@Query() dto: ListAccountInvitesDto): Promise<InviteHistoryRow[]> {
    return this.invites.listForSubject(dto.subject_type, dto.subject_id);
  }

  @Post('revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Kill any outstanding invitation for one person without sending a new one.',
  })
  revoke(@Body() dto: RevokeAccountInviteDto): Promise<void> {
    return this.invites.revokeOutstanding(dto.subject_type, dto.subject_id);
  }
}
