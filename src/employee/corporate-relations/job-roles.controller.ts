import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequireScreen } from '../../rbac/require-screen.decorator';
import { ScreenAccessGuard } from '../../rbac/screen-access.guard';
import { EmployeeJwtAuthGuard } from '../auth/employee-jwt-auth.guard';
import { GetEmployee } from '../auth/get-employee.decorator';
import type { AuthenticatedEmployee } from '../auth/employee-jwt.strategy';
import { RequireEmployeePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { CorporateRelationsService } from './corporate-relations.service';
import { CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';
import { MyJobRoleListQueryDto } from './dto/job-role.dto';

const KEY = 'corporate_relations.job_roles.manage';

/**
 * Roles or Designations — the desk-level view of the company catalog: the job
 * roles the CALLER is accountable for, and adding a company for approval.
 *
 * Scoped by the acting employee, not by RBAC attributes: the list filters on
 * `responsible_employee_id = <token employee>`, which is never a parameter.
 *
 * The write endpoints deliberately duplicate Company Management's rather than
 * sharing them — `@RequireScreen` takes a single key, and the whole point of
 * this screen is that holding it does NOT hand over the manager's catalog. Each
 * one is a thin delegation to the same service method, so no logic is copied;
 * what differs is the guard, and `assertOwnDraftCompany` narrows the two
 * by-id routes to the caller's own not-yet-live company (the draft they just
 * created, and the send-back they have to resubmit).
 */
@ApiTags('corporate-relations/job-roles')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/corporate-relations/job-roles')
export class JobRolesController {
  constructor(private readonly svc: CorporateRelationsService) {}

  @Get()
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'The job roles the caller is accountable for, each with its company. Unpaginated — the screen groups by company.',
  })
  list(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Query() query: MyJobRoleListQueryDto,
  ) {
    return this.svc.listMyJobRoles(emp.id, query);
  }

  @Get('form-options')
  @RequireScreen(KEY, 'create')
  @ApiOperation({
    summary:
      'Category lookups for the add-company form, plus the caller — who the form defaults every job role to.',
  })
  formOptions(@GetEmployee() emp: AuthenticatedEmployee) {
    return this.svc.formOptions(emp);
  }

  @Get('companies/:id')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'One company the caller is accountable for a role on (or created) — what the edit form loads. 404s for any other.',
  })
  async get(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.svc.assertCompanyVisibleToOwner(id, emp.id);
    return this.svc.getCompany(id);
  }

  @Get('companies/:id/request')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      "The company's open approval request with its approvers and history, or null. `can_act` is true when the caller may also decide it.",
  })
  async request(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.svc.assertCompanyVisibleToOwner(id, emp.id);
    return this.svc.getCompanyRequest(id, emp.id);
  }

  @Post('companies')
  @RequireScreen(KEY, 'create')
  @ApiOperation({
    summary:
      'Add a company and send it for approval. It stays out of the live catalog until an approver signs it off.',
  })
  create(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Body() dto: CreateCompanyDto,
  ) {
    return this.svc.createCompany(dto, emp.id);
  }

  @Patch('companies/:id')
  @RequireScreen(KEY, 'create')
  @ApiOperation({
    summary:
      "Edit the caller's own company while it is still awaiting approval — the resubmit path after an approver sends a request back. 404s for anyone else's company and for one that is already live.",
  })
  async update(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCompanyDto,
  ) {
    await this.svc.assertOwnDraftCompany(id, emp.id);
    return this.svc.updateCompany(id, dto, emp.id);
  }

  @Post('companies/:id/logo')
  @HttpCode(HttpStatus.OK)
  @RequireScreen(KEY, 'create')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary:
      "Upload the logo for the caller's own company while it is still awaiting approval. The form calls this right after creating the row, which has no id until then.",
  })
  async setLogo(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 2 * 1024 * 1024 })],
      }),
    )
    file: Express.Multer.File,
  ) {
    await this.svc.assertOwnDraftCompany(id, emp.id);
    return this.svc.setLogo(id, file);
  }
}
