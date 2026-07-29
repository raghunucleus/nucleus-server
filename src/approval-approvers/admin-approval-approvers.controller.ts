import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../admin/auth/jwt-auth.guard';
import { RequireTotpEnrolledGuard } from '../admin/auth/require-totp-enrolled.guard';
import {
  ApprovalActionDetail,
  ApprovalActionGroupSummary,
  ApprovalApproversService,
  ApprovalApproverSummary,
} from './approval-approvers.service';
import { SetApprovalApproversDto } from './dto/set-approval-approvers.dto';

@ApiTags('approval-approvers')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/approval-approvers')
export class AdminApprovalApproversController {
  constructor(private readonly approvers: ApprovalApproversService) {}

  @Get('actions')
  @ApiOperation({
    summary:
      'The static catalog of approvable actions, grouped, with each action’s current approver count and name preview.',
  })
  listActions(): Promise<ApprovalActionGroupSummary[]> {
    return this.approvers.listActions();
  }

  @Get('actions/:actionKey')
  @ApiOperation({
    summary: 'One action and its full approver list. 404 if the key is not in the catalog.',
  })
  getAction(
    @Param('actionKey') actionKey: string,
  ): Promise<ApprovalActionDetail> {
    return this.approvers.getActionDetail(actionKey);
  }

  @Put('actions/:actionKey')
  @ApiOperation({
    summary:
      'Replace the action’s approver set wholesale. An empty list clears every approver.',
  })
  setApprovers(
    @Param('actionKey') actionKey: string,
    @Body() body: SetApprovalApproversDto,
  ): Promise<ApprovalApproverSummary[]> {
    return this.approvers.setApprovers(actionKey, body.employee_ids);
  }
}
