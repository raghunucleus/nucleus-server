import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireScreen } from '../rbac/require-screen.decorator';
import { ScreenAccessGuard } from '../rbac/screen-access.guard';
import { EmployeeJwtAuthGuard } from '../employee/auth/employee-jwt-auth.guard';
import type { AuthenticatedEmployee } from '../employee/auth/employee-jwt.strategy';
import { GetEmployee } from '../employee/auth/get-employee.decorator';
import { RequireEmployeePasswordChangedGuard } from '../employee/auth/require-password-changed.guard';
import {
  ApprovalRequestDetailView,
  ApprovalRequestsService,
  ApprovalRequestView,
  PaginatedApprovals,
  RequesterRequestView,
  RequestStatusCounts,
} from './approval-requests.service';
import { DecideDto, DecisionDto, SendBackDto } from './dto/decision.dto';
import { EmployeeListApprovalsDto } from './dto/list-requests.dto';
import { RequestCatalogModule } from './request-type.registry';

const APPROVALS_KEY = 'requests.approvals.review';
const MINE_KEY = 'requests.mine.view';

/**
 * Employee side of the approval-requests framework.
 *
 * Both screens are DERIVED, never role-assigned: `requests.mine.view` is
 * granted to every employee, `requests.approvals.review` to profile verifiers
 * (see PermissionsService.deriveRequestScreens). The screens carry no RBAC
 * attributes — row scope comes from the verifier table itself, which the
 * service INNER JOINs on every approvals query/mutation.
 */
@ApiTags('employee-requests')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/requests')
export class EmployeeRequestsController {
  constructor(private readonly requests: ApprovalRequestsService) {}

  @Get('approvals')
  @RequireScreen(APPROVALS_KEY, 'view')
  @ApiOperation({
    summary:
      "Approval inbox — requests from students of batches the caller verifies. Defaults to status 'pending'.",
  })
  listApprovals(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Query() query: EmployeeListApprovalsDto,
  ): Promise<PaginatedApprovals> {
    return this.requests.listApprovals(emp.id, query);
  }

  @Get('approvals/counts')
  @RequireScreen(APPROVALS_KEY, 'view')
  @ApiOperation({
    summary:
      'Count of visible requests per status, across every type — drives the status chips.',
  })
  approvalCounts(
    @GetEmployee() emp: AuthenticatedEmployee,
  ): Promise<RequestStatusCounts> {
    return this.requests.countsForApprovals(emp.id);
  }

  // After 'approvals/counts', or ':id' would swallow it.
  @Get('approvals/:id')
  @RequireScreen(APPROVALS_KEY, 'view')
  @ApiOperation({
    summary:
      'Full view of one request from a batch the caller verifies — state, approvers and history.',
  })
  getApproval(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ApprovalRequestDetailView> {
    return this.requests.getApprovalDetail(emp.id, id);
  }

  @Post('approvals/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequireScreen(APPROVALS_KEY, 'approve')
  @ApiOperation({
    summary:
      "Approve a pending request in full — applies the request's effect (e.g. writes the profile changes) in the same transaction.",
  })
  approve(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DecisionDto,
  ): Promise<ApprovalRequestView> {
    return this.requests.decide(emp.id, id, { verdict: 'approved' }, dto.note);
  }

  @Post('approvals/:id/reject')
  @HttpCode(HttpStatus.OK)
  @RequireScreen(APPROVALS_KEY, 'reject')
  @ApiOperation({
    summary: 'Reject a pending request in full, optionally with a note.',
  })
  reject(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DecisionDto,
  ): Promise<ApprovalRequestView> {
    return this.requests.decide(emp.id, id, { verdict: 'rejected' }, dto.note);
  }

  // Gated on 'approve': a mixed decision includes approvals, and the derived
  // verifier screen always grants approve+reject together anyway.
  @Post('approvals/:id/decide')
  @HttpCode(HttpStatus.OK)
  @RequireScreen(APPROVALS_KEY, 'approve')
  @ApiOperation({
    summary:
      'Decide a pending request per item — approve some fields, reject others. Every item needs a verdict; mixed verdicts need the `overall` status the approver picked.',
  })
  decideMixed(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DecideDto,
  ): Promise<ApprovalRequestView> {
    return this.requests.decide(
      emp.id,
      id,
      { verdicts: dto.decisions, overall: dto.overall },
      dto.note,
    );
  }

  @Post('approvals/:id/send-back')
  @HttpCode(HttpStatus.OK)
  @RequireScreen(APPROVALS_KEY, 'send_back')
  @ApiOperation({
    summary:
      'Return a pending request to the student for changes. Not a decision — nothing is applied; the request parks with them until they resubmit or cancel. The note is required.',
  })
  sendBack(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SendBackDto,
  ): Promise<ApprovalRequestView> {
    return this.requests.sendBack(emp.id, id, dto.note);
  }

  // Gated on My Requests, not Approvals: every employee has the former, only
  // verifiers the latter, and BOTH screens render the tree. The catalog is
  // just the list of request types that exist — nothing per-employee in it.
  @Get('catalog')
  @RequireScreen(MINE_KEY, 'view')
  @ApiOperation({
    summary:
      'The request types that exist, grouped into modules — drives the Modules tree.',
  })
  catalog(): RequestCatalogModule[] {
    return this.requests.catalog();
  }

  @Get('mine')
  @RequireScreen(MINE_KEY, 'view')
  @ApiOperation({
    summary:
      "The caller's own submitted requests (no employee-creatable types yet — empty list).",
  })
  listMine(
    @GetEmployee() emp: AuthenticatedEmployee,
  ): Promise<RequesterRequestView[]> {
    return this.requests.listMine(emp.id);
  }
}
