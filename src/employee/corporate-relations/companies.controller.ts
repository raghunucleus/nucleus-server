import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireScreen } from '../../rbac/require-screen.decorator';
import { ScreenAccessGuard } from '../../rbac/screen-access.guard';
import { EmployeeJwtAuthGuard } from '../auth/employee-jwt-auth.guard';
import { GetEmployee } from '../auth/get-employee.decorator';
import type { AuthenticatedEmployee } from '../auth/employee-jwt.strategy';
import { RequireEmployeePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { CorporateRelationsService } from './corporate-relations.service';
import {
  ActivityQueryDto,
  ContactDto,
  InteractionDto,
  InteractionQueryDto,
  MilestoneDto,
  UpdateContactDto,
  UpdateInteractionDto,
} from './dto/activity.dto';
import { CompanyListQueryDto, UpdateCompanyDto } from './dto/company.dto';

const KEY = 'corporate_relations.companies.view';

/**
 * Responsible-officer surface. Every handler is scoped to the acting employee:
 * the service `ensureAccess(companyId, emp.id)` guard rejects any company whose
 * `responsible_employee_id` isn't the caller. The officer can read everything
 * and record interactions / milestones / contacts (`record` action) but can
 * NOT edit the company master fields, logo, status, or assignment — those
 * endpoints live only on the manager controller.
 */
@ApiTags('corporate-relations/companies')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/corporate-relations/companies')
export class CompaniesController {
  constructor(private readonly svc: CorporateRelationsService) {}

  @Get()
  @RequireScreen(KEY, 'view')
  @ApiOperation({ summary: 'Companies assigned to the signed-in officer.' })
  list(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Query() query: CompanyListQueryDto,
  ) {
    return this.svc.listCompanies(query, emp.id);
  }

  @Get('form-options')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary: 'Enums (interaction/milestone types) for the record forms.',
  })
  formOptions() {
    return this.svc.formOptions();
  }

  @Get(':id')
  @RequireScreen(KEY, 'view')
  @ApiOperation({ summary: 'One assigned company with full detail.' })
  get(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.svc.getCompany(id, emp.id);
  }

  @Patch(':id')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'Edit descriptive fields of your assigned company (name + officer are locked).',
  })
  update(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.svc.updateCompanyAsOfficer(id, dto, emp.id);
  }

  // ---- Contacts ------------------------------------------------------------

  @Get(':id/contacts')
  @RequireScreen(KEY, 'view')
  contacts(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.svc.listContacts(id, emp.id);
  }

  @Post(':id/contacts')
  @RequireScreen(KEY, 'view')
  addContact(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ContactDto,
  ) {
    return this.svc.createContact(id, dto, emp.id, emp.id);
  }

  @Patch(':id/contacts/:contactId')
  @RequireScreen(KEY, 'view')
  editContact(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Param('contactId', ParseIntPipe) contactId: number,
    @Body() dto: UpdateContactDto,
  ) {
    return this.svc.updateContact(id, contactId, dto, emp.id, emp.id);
  }

  @Delete(':id/contacts/:contactId')
  @RequireScreen(KEY, 'view')
  removeContact(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Param('contactId', ParseIntPipe) contactId: number,
  ) {
    return this.svc.deleteContact(id, contactId, emp.id, emp.id);
  }

  // ---- Interactions --------------------------------------------------------

  @Get(':id/interactions')
  @RequireScreen(KEY, 'view')
  interactions(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: InteractionQueryDto,
  ) {
    return this.svc.listInteractions(id, query, emp.id);
  }

  @Post(':id/interactions')
  @RequireScreen(KEY, 'view')
  addInteraction(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: InteractionDto,
  ) {
    return this.svc.createInteraction(id, dto, emp.id, emp.id);
  }

  @Patch(':id/interactions/:interactionId')
  @RequireScreen(KEY, 'view')
  editInteraction(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Param('interactionId', ParseIntPipe) interactionId: number,
    @Body() dto: UpdateInteractionDto,
  ) {
    return this.svc.updateInteraction(id, interactionId, dto, emp.id, emp.id);
  }

  @Delete(':id/interactions/:interactionId')
  @RequireScreen(KEY, 'view')
  removeInteraction(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Param('interactionId', ParseIntPipe) interactionId: number,
  ) {
    return this.svc.deleteInteraction(id, interactionId, emp.id, emp.id);
  }

  // ---- Relationship milestones ---------------------------------------------

  @Get(':id/milestones')
  @RequireScreen(KEY, 'view')
  milestones(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.svc.listMilestones(id, emp.id);
  }

  @Post(':id/milestones')
  @RequireScreen(KEY, 'view')
  addMilestone(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MilestoneDto,
  ) {
    return this.svc.createMilestone(id, dto, emp.id, emp.id);
  }

  @Delete(':id/milestones/:milestoneId')
  @RequireScreen(KEY, 'view')
  removeMilestone(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Param('milestoneId', ParseIntPipe) milestoneId: number,
  ) {
    return this.svc.deleteMilestone(id, milestoneId, emp.id, emp.id);
  }

  // ---- Drives --------------------------------------------------------------

  @Get(':id/drives')
  @RequireScreen(KEY, 'view')
  @ApiOperation({ summary: 'Placement drives for one assigned company.' })
  drives(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.svc.listCompanyDrives(id, emp.id);
  }

  // ---- Activity log --------------------------------------------------------

  @Get(':id/activity')
  @RequireScreen(KEY, 'view')
  @ApiOperation({ summary: 'Unified audit feed for one assigned company.' })
  activity(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ActivityQueryDto,
  ) {
    return this.svc.listActivity(id, query, emp.id);
  }
}
