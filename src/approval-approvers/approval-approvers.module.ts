import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Employee } from '../admin/entities/employee.entity';
import { AdminApprovalApproversController } from './admin-approval-approvers.controller';
import { assertValidApprovalActionCatalog } from './approval-actions';
import { ApprovalApproversService } from './approval-approvers.service';
import { ApprovalActionApprover } from './entities/approval-action-approver.entity';

/**
 * Who approves what.
 *
 * Owns the static action catalog (`approval-actions.ts`), the
 * `approval_action_approvers` join table, and the admin "Assign approvers"
 * screen behind it. Standalone rather than folded into AdminModule so the
 * domain modules that will consume the approver lists — corporate relations
 * first — can inject {@link ApprovalApproversService} without pulling in the
 * entire admin surface.
 *
 * The admin guards resolve here without importing AdminModule: passport
 * strategies are app-wide and RequireTotpEnrolledGuard only needs Reflector.
 * Same precedent as RequestsModule's student guards.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ApprovalActionApprover, Employee])],
  controllers: [AdminApprovalApproversController],
  providers: [ApprovalApproversService],
  exports: [ApprovalApproversService],
})
export class ApprovalApproversModule implements OnModuleInit {
  onModuleInit(): void {
    // Crash at boot on a typo'd group key or a duplicate action key rather
    // than serving a half-broken screen.
    assertValidApprovalActionCatalog();
  }
}
