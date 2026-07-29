import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Admin } from '../admin/entities/admin.entity';
import { JwtStrategy } from '../admin/auth/jwt.strategy';
import { RequireTotpEnrolledGuard } from '../admin/auth/require-totp-enrolled.guard';
import { Employee } from '../admin/entities/employee.entity';
import { ProgrammeAdmissionYearProfileVerifier } from '../admin/entities/programme-admission-year-profile-verifier.entity';
import { ApprovalActionApprover } from '../approval-approvers/entities/approval-action-approver.entity';
import { EmployeeAuthModule } from '../employee/auth/employee-auth.module';
import { RbacAdminController } from './admin/rbac-admin.controller';
import { RbacAdminService } from './admin/rbac-admin.service';
import { CatalogService } from './catalog.service';
import { MeAccessController } from './employee/me-access.controller';
import { RoleAssignmentAttribute } from './entities/role-assignment-attribute.entity';
import { RoleAssignment } from './entities/role-assignment.entity';
import { RoleScreen } from './entities/role-screen.entity';
import { Role } from './entities/role.entity';
import { PermissionsService } from './permissions.service';
import { ScreenAccessGuard } from './screen-access.guard';

/**
 * RBAC module — owns the static catalog accessor, the dynamic role/assignment
 * tables, the effective-access resolver, the admin CRUD endpoints, and the
 * employee /me/access endpoint.
 *
 * Admin endpoints (`/admin/rbac/*`) are guarded by the admin JWT, which is why
 * this module pulls in the admin JwtStrategy and TOTP guard. The strategy is
 * also registered in AdminModule — registering it again here is harmless and
 * keeps RbacModule self-contained so AdminModule could one day be slimmed.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Role,
      RoleScreen,
      RoleAssignment,
      RoleAssignmentAttribute,
      Employee,
      Admin,
      // The Requests screens are derived from profile-verifier membership and
      // from approval-action approver membership — see
      // PermissionsService.deriveRequestScreens. Both entities are owned by
      // other modules and repo-injected here rather than imported as modules:
      // ApprovalApproversModule imports RbacModule (to bust the cache when the
      // approver set changes), so the dependency must only go one way.
      ProgrammeAdmissionYearProfileVerifier,
      ApprovalActionApprover,
    ]),
    ConfigModule,
    PassportModule,
    JwtModule.register({}),
    EmployeeAuthModule,
  ],
  controllers: [RbacAdminController, MeAccessController],
  providers: [
    CatalogService,
    PermissionsService,
    RbacAdminService,
    ScreenAccessGuard,
    JwtStrategy,
    RequireTotpEnrolledGuard,
  ],
  exports: [CatalogService, PermissionsService, ScreenAccessGuard],
})
export class RbacModule {}
