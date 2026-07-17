import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetAdmin } from '../../admin/auth/get-admin.decorator';
import { JwtAuthGuard } from '../../admin/auth/jwt-auth.guard';
import { RequireTotpEnrolledGuard } from '../../admin/auth/require-totp-enrolled.guard';
import type { AuthenticatedAdmin } from '../../admin/auth/jwt.strategy';
import type { Catalog, PickerOption } from '../catalog';
import { CatalogService } from '../catalog.service';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { ListAssignmentsDto } from './dto/list-assignments.dto';
import { ListRolesDto } from './dto/list-roles.dto';
import { UpdateAssignmentDto } from './dto/update-assignment.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import {
  AssignmentDetail,
  ListAssignmentsResult,
  ListRolesResult,
  RbacAdminService,
  RoleDetail,
} from './rbac-admin.service';

@ApiTags('rbac-admin')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/rbac')
export class RbacAdminController {
  constructor(
    private readonly rbac: RbacAdminService,
    private readonly catalog: CatalogService,
  ) {}

  // --- Catalog -----------------------------------------------------------

  @Get('catalog')
  @ApiOperation({
    summary:
      'Return the full static RBAC catalog (modules, role types, attribute ' +
      'types, screens). Drives the role builder + assignment editor UIs.',
  })
  getCatalog(): Catalog {
    return this.catalog.getCatalog();
  }

  @Get('attribute-options')
  @ApiOperation({
    summary:
      'Return the picker options ({ id, label }) for a catalog attribute ' +
      'type. The admin-ui assignment editor calls this when rendering an ' +
      'attribute picker — it never has to know which backing endpoint or ' +
      'entity feeds the options. Custom (non-DB) attributes can return a ' +
      'static list from their fetcher.',
  })
  getAttributeOptions(@Query('type') typeKey: string): Promise<PickerOption[]> {
    return this.rbac.getAttributeOptions(typeKey);
  }

  // --- Roles -------------------------------------------------------------

  @Get('roles')
  @ApiOperation({ summary: 'List composed roles.' })
  listRoles(@Query() query: ListRolesDto): Promise<ListRolesResult> {
    return this.rbac.listRoles(query);
  }

  @Get('roles/:id')
  @ApiOperation({ summary: 'Get a role with its screens.' })
  getRole(@Param('id', ParseIntPipe) id: number): Promise<RoleDetail> {
    return this.rbac.getRole(id);
  }

  @Post('roles')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new composed role.' })
  createRole(@Body() dto: CreateRoleDto): Promise<RoleDetail> {
    return this.rbac.createRole({
      code: dto.code,
      name: dto.name,
      description: dto.description,
      role_type_keys: dto.role_type_keys,
      screens: dto.screens,
    });
  }

  @Patch('roles/:id')
  @ApiOperation({ summary: "Update a role's metadata and/or screen set." })
  updateRole(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRoleDto,
  ): Promise<RoleDetail> {
    return this.rbac.updateRole(id, dto);
  }

  @Post('roles/:id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a role.' })
  activateRole(@Param('id', ParseIntPipe) id: number): Promise<RoleDetail> {
    return this.rbac.setRoleActive(id, true);
  }

  @Post('roles/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a role.' })
  deactivateRole(@Param('id', ParseIntPipe) id: number): Promise<RoleDetail> {
    return this.rbac.setRoleActive(id, false);
  }

  // --- Assignments -------------------------------------------------------

  @Get('assignments')
  @ApiOperation({ summary: 'List role assignments (filterable).' })
  listAssignments(
    @Query() query: ListAssignmentsDto,
  ): Promise<ListAssignmentsResult> {
    return this.rbac.listAssignments(query);
  }

  @Get('assignments/:id')
  @ApiOperation({
    summary: 'Get a single role assignment with its attributes.',
  })
  getAssignment(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AssignmentDetail> {
    return this.rbac.getAssignment(id);
  }

  @Post('assignments')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Assign a role to an employee with the per-screen attribute values that ' +
      'scope the role for that employee.',
  })
  createAssignment(
    @Body() dto: CreateAssignmentDto,
    @GetAdmin() admin: AuthenticatedAdmin,
  ): Promise<AssignmentDetail> {
    return this.rbac.createAssignment({
      role_id: dto.role_id,
      employee_id: dto.employee_id,
      attributes: dto.attributes,
      assigned_by_admin_id: Number(admin.id),
    });
  }

  @Patch('assignments/:id')
  @ApiOperation({
    summary: "Update an assignment's attribute values or activation state.",
  })
  updateAssignment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAssignmentDto,
  ): Promise<AssignmentDetail> {
    return this.rbac.updateAssignment(id, dto);
  }

  @Delete('assignments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Revoke a role assignment (soft — sets is_active=false and invalidates ' +
      "the employee's permissions cache).",
  })
  revokeAssignment(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.rbac.revokeAssignment(id);
  }
}
