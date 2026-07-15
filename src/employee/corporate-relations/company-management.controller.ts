import {
  Body,
  Controller,
  Delete,
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
  ContactDto,
  InteractionDto,
  InteractionQueryDto,
  MilestoneDto,
  UpdateContactDto,
  UpdateInteractionDto,
} from './dto/activity.dto';
import {
  CompanyListQueryDto,
  CompanyStatusDto,
  CreateCompanyDto,
  UpdateCompanyDto,
} from './dto/company.dto';

const KEY = 'corporate_relations.company_management.manage';

/**
 * Placement-manager surface: full CRUD over the company catalog plus the CRM
 * activity sub-resources. Unscoped — the manager sees and edits every company
 * (ownership scoping applies only to the officer surface). Guarded by the
 * `company_management.manage` screen; `record` gates activity writes.
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

  // ---- Companies -----------------------------------------------------------

  @Get('companies')
  @RequireScreen(KEY, 'view')
  @ApiOperation({ summary: 'List all companies (filters + pagination).' })
  list(@Query() query: CompanyListQueryDto) {
    return this.svc.listCompanies(query);
  }

  @Get('companies/form-options')
  @RequireScreen(KEY, 'view')
  @ApiOperation({ summary: 'Lookups, departments and enums for the company form.' })
  formOptions() {
    return this.svc.formOptions();
  }

  @Get('companies/assignable-employees')
  @RequireScreen(KEY, 'view')
  @ApiOperation({ summary: 'Active employees for the responsible-officer picker.' })
  assignableEmployees() {
    return this.svc.assignableEmployees();
  }

  @Post('companies')
  @RequireScreen(KEY, 'create')
  @ApiOperation({ summary: 'Create a company.' })
  create(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Body() dto: CreateCompanyDto,
  ) {
    return this.svc.createCompany(dto, emp.id);
  }

  @Get('companies/:id')
  @RequireScreen(KEY, 'view')
  @ApiOperation({ summary: 'One company with full detail.' })
  get(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getCompany(id);
  }

  @Patch('companies/:id')
  @RequireScreen(KEY, 'edit')
  @ApiOperation({ summary: 'Edit company fields, classifiers and responsible officer.' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.svc.updateCompany(id, dto);
  }

  @Patch('companies/:id/status')
  @RequireScreen(KEY, 'activate')
  @ApiOperation({ summary: 'Activate / deactivate a company.' })
  setStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CompanyStatusDto,
  ) {
    return this.svc.setCompanyStatus(id, dto.is_active);
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
  @ApiOperation({ summary: 'Upload / replace the company logo.' })
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

  // ---- Contacts (SPOCs) ----------------------------------------------------

  @Get('companies/:id/contacts')
  @RequireScreen(KEY, 'view')
  contacts(@Param('id', ParseIntPipe) id: number) {
    return this.svc.listContacts(id);
  }

  @Post('companies/:id/contacts')
  @RequireScreen(KEY, 'record')
  addContact(@Param('id', ParseIntPipe) id: number, @Body() dto: ContactDto) {
    return this.svc.createContact(id, dto);
  }

  @Patch('companies/:id/contacts/:contactId')
  @RequireScreen(KEY, 'record')
  editContact(
    @Param('id', ParseIntPipe) id: number,
    @Param('contactId', ParseIntPipe) contactId: number,
    @Body() dto: UpdateContactDto,
  ) {
    return this.svc.updateContact(id, contactId, dto);
  }

  @Delete('companies/:id/contacts/:contactId')
  @RequireScreen(KEY, 'record')
  removeContact(
    @Param('id', ParseIntPipe) id: number,
    @Param('contactId', ParseIntPipe) contactId: number,
  ) {
    return this.svc.deleteContact(id, contactId);
  }

  // ---- Interactions --------------------------------------------------------

  @Get('companies/:id/interactions')
  @RequireScreen(KEY, 'view')
  interactions(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: InteractionQueryDto,
  ) {
    return this.svc.listInteractions(id, query);
  }

  @Post('companies/:id/interactions')
  @RequireScreen(KEY, 'record')
  addInteraction(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: InteractionDto,
  ) {
    return this.svc.createInteraction(id, dto, emp.id);
  }

  @Patch('companies/:id/interactions/:interactionId')
  @RequireScreen(KEY, 'record')
  editInteraction(
    @Param('id', ParseIntPipe) id: number,
    @Param('interactionId', ParseIntPipe) interactionId: number,
    @Body() dto: UpdateInteractionDto,
  ) {
    return this.svc.updateInteraction(id, interactionId, dto);
  }

  @Delete('companies/:id/interactions/:interactionId')
  @RequireScreen(KEY, 'record')
  removeInteraction(
    @Param('id', ParseIntPipe) id: number,
    @Param('interactionId', ParseIntPipe) interactionId: number,
  ) {
    return this.svc.deleteInteraction(id, interactionId);
  }

  // ---- Relationship milestones ---------------------------------------------

  @Get('companies/:id/milestones')
  @RequireScreen(KEY, 'view')
  milestones(@Param('id', ParseIntPipe) id: number) {
    return this.svc.listMilestones(id);
  }

  @Post('companies/:id/milestones')
  @RequireScreen(KEY, 'record')
  addMilestone(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MilestoneDto,
  ) {
    return this.svc.createMilestone(id, dto, emp.id);
  }

  @Delete('companies/:id/milestones/:milestoneId')
  @RequireScreen(KEY, 'record')
  removeMilestone(
    @Param('id', ParseIntPipe) id: number,
    @Param('milestoneId', ParseIntPipe) milestoneId: number,
  ) {
    return this.svc.deleteMilestone(id, milestoneId);
  }
}
