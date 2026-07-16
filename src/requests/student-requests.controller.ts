import {
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
import { GetStudent } from '../student/auth/get-student.decorator';
import { RequirePasswordChangedGuard } from '../student/auth/require-password-changed.guard';
import { StudentJwtAuthGuard } from '../student/auth/student-jwt-auth.guard';
import type { AuthenticatedStudent } from '../student/auth/student-jwt.strategy';
import {
  ApprovalRequestsService,
  RequesterRequestDetailView,
  RequesterRequestView,
  RequestStatusCounts,
} from './approval-requests.service';
import { StudentListRequestsDto } from './dto/list-requests.dto';
import { RequestCatalogModule } from './request-type.registry';

/**
 * The student's "My Requests" surface — the generic lifecycle endpoints (list,
 * cancel). Creating a request lives with the request type's own module (e.g.
 * POST /student/requests/profile-update in the student-profile module).
 * The student id comes only from the JWT (`@GetStudent()`).
 */
@ApiTags('student-requests')
@ApiBearerAuth('student-access-token')
@UseGuards(StudentJwtAuthGuard, RequirePasswordChangedGuard)
@Controller('student/requests')
export class StudentRequestsController {
  constructor(private readonly requests: ApprovalRequestsService) {}

  @Get()
  @ApiOperation({
    summary:
      "The caller's own approval requests, newest first, optionally narrowed by status/type.",
  })
  list(
    @GetStudent() s: AuthenticatedStudent,
    @Query() query: StudentListRequestsDto,
  ): Promise<RequesterRequestView[]> {
    return this.requests.listForStudent(s.id, query);
  }

  @Get('catalog')
  @ApiOperation({
    summary:
      'The request types that exist, grouped into modules — drives the Modules tree.',
  })
  catalog(): RequestCatalogModule[] {
    return this.requests.catalog();
  }

  @Get('counts')
  @ApiOperation({
    summary:
      "Count of the caller's own requests per status, across every type — drives the status chips.",
  })
  counts(
    @GetStudent() s: AuthenticatedStudent,
  ): Promise<RequestStatusCounts> {
    return this.requests.countsForStudent(s.id);
  }

  // Declared after the literal routes above, or ':id' would swallow
  // /catalog and /counts.
  @Get(':id')
  @ApiOperation({
    summary:
      'Full view of one of your own requests — state, approvers and history. 404 if it is not yours.',
  })
  get(
    @GetStudent() s: AuthenticatedStudent,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<RequesterRequestDetailView> {
    return this.requests.getForStudent(s.id, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Cancel your own request while it is still open — pending, or sent back to you.',
  })
  cancel(
    @GetStudent() s: AuthenticatedStudent,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<RequesterRequestView> {
    return this.requests.cancelForStudent(s.id, id);
  }
}
