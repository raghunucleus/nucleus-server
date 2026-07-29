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
import {
  CompanyListQueryDto,
  CreateCompanyDto,
  UpdateCompanyDto,
} from './dto/company.dto';

const KEY = 'corporate_relations.company_management.manage';

/**
 * Placement-manager surface: CRUD over the company catalog. Unscoped — every
 * company is visible to anyone holding the `company_management.manage` screen.
 */
@ApiTags('corporate-relations/management')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/corporate-relations/management')
export class CompanyManagementController {
  constructor(private readonly svc: CorporateRelationsService) {}

  @Get('companies')
  @RequireScreen(KEY, 'view')
  @ApiOperation({ summary: 'List all companies (filters + pagination).' })
  list(@Query() query: CompanyListQueryDto) {
    return this.svc.listCompanies(query);
  }

  @Get('companies/form-options')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'Category lookups for the company form, plus the caller — who the form defaults every job role to.',
  })
  formOptions(@GetEmployee() emp: AuthenticatedEmployee) {
    return this.svc.formOptions(emp);
  }

  @Post('companies')
  @RequireScreen(KEY, 'create')
  @ApiOperation({
    summary:
      'Create a company and send it for approval. It stays out of the live catalog until an approver signs it off.',
  })
  create(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Body() dto: CreateCompanyDto,
  ) {
    return this.svc.createCompany(dto, emp.id);
  }

  @Get('companies/:id')
  @RequireScreen(KEY, 'view')
  @ApiOperation({ summary: 'One company.' })
  get(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getCompany(id);
  }

  @Get('companies/:id/request')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      "The company's open approval request with its approvers and history, or null. `can_act` is true when the caller may also decide it.",
  })
  request(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.svc.getCompanyRequest(id, emp.id);
  }

  @Patch('companies/:id')
  @RequireScreen(KEY, 'edit')
  @ApiOperation({
    summary:
      'Edit a company. An APPROVED company is not written — the change is staged on an approval request and applied when someone approves it. A pending/rejected one is written directly and re-sent for approval.',
  })
  update(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.svc.updateCompany(id, dto, emp.id);
  }

  @Post('companies/:id/logo')
  @HttpCode(HttpStatus.OK)
  @RequireScreen(KEY, 'edit')
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
      'Upload a logo. For an approved company the object is only STAGED — put the returned `logo_key` in the edit payload and it lands when the change is approved.',
  })
  setLogo(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 2 * 1024 * 1024 })],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.svc.setLogo(id, file);
  }
}
