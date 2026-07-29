import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Employee } from '../admin/entities/employee.entity';
import { PermissionsService } from '../rbac/permissions.service';
import {
  ApprovalActionDef,
  APPROVAL_ACTION_BY_KEY,
  APPROVAL_ACTION_GROUPS,
  APPROVAL_ACTION_GROUP_BY_KEY,
  sortedApprovalActions,
} from './approval-actions';
import { ApprovalActionApprover } from './entities/approval-action-approver.entity';

/** An approver as shown in the admin screen and (later) "who it's with" lists. */
export interface ApprovalApproverSummary {
  id: number;
  emp_code: string;
  emp_display_name: string;
  designation: string | null;
  department: string | null;
}

export interface ApprovalActionSummary extends ApprovalActionDef {
  group_label: string;
  approver_count: number;
  /** First few approver names, for an at-a-glance list cell. */
  approver_preview: string[];
}

export interface ApprovalActionGroupSummary {
  key: string;
  label: string;
  order: number;
  actions: ApprovalActionSummary[];
}

export interface ApprovalActionDetail {
  action: ApprovalActionDef & { group_label: string };
  approvers: ApprovalApproverSummary[];
}

const PREVIEW_LIMIT = 3;

@Injectable()
export class ApprovalApproversService {
  constructor(
    @InjectRepository(ApprovalActionApprover)
    private readonly approvers: Repository<ApprovalActionApprover>,
    @InjectRepository(Employee)
    private readonly employees: Repository<Employee>,
    private readonly dataSource: DataSource,
    private readonly permissions: PermissionsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Admin surface — the "Assign approvers" screen.
  // ---------------------------------------------------------------------------

  /**
   * The whole static catalog, each action carrying its current approver count
   * and a short name preview. One grouped query for the counts, one for the
   * preview names — never N+1 over the catalog.
   */
  async listActions(): Promise<ApprovalActionGroupSummary[]> {
    const rows = await this.approvers
      .createQueryBuilder('a')
      .leftJoin('a.employee', 'e')
      .select('a.action_key', 'action_key')
      .addSelect('e.emp_display_name', 'emp_display_name')
      .orderBy('a.action_key', 'ASC')
      .addOrderBy('e.emp_display_name', 'ASC')
      .getRawMany<{ action_key: string; emp_display_name: string }>();

    const byAction = new Map<string, string[]>();
    for (const r of rows) {
      const list = byAction.get(r.action_key);
      if (list) list.push(r.emp_display_name);
      else byAction.set(r.action_key, [r.emp_display_name]);
    }

    const groups = new Map<string, ApprovalActionGroupSummary>();
    for (const g of [...APPROVAL_ACTION_GROUPS].sort(
      (a, b) => a.order - b.order,
    )) {
      groups.set(g.key, { key: g.key, label: g.label, order: g.order, actions: [] });
    }

    for (const action of sortedApprovalActions()) {
      const names = byAction.get(action.key) ?? [];
      const group = groups.get(action.group_key);
      group?.actions.push({
        ...action,
        group_label: group.label,
        approver_count: names.length,
        approver_preview: names.slice(0, PREVIEW_LIMIT),
      });
    }

    return [...groups.values()];
  }

  async getActionDetail(actionKey: string): Promise<ApprovalActionDetail> {
    const action = this.actionOr404(actionKey);
    return {
      action: {
        ...action,
        group_label:
          APPROVAL_ACTION_GROUP_BY_KEY.get(action.group_key)?.label ?? '',
      },
      approvers: await this.approversFor(actionKey),
    };
  }

  /**
   * Replace the action's approver set wholesale. Nothing references join-row
   * ids, so a delete-then-insert inside one transaction keeps the logic trivial
   * and the result idempotent (re-sending the same ids is a no-op).
   */
  async setApprovers(
    actionKey: string,
    employeeIds: number[],
  ): Promise<ApprovalApproverSummary[]> {
    this.actionOr404(actionKey);
    await this.assertEmployeesExist(employeeIds);

    // Captured BEFORE the swap: someone REMOVED from the action needs their
    // cache busted just as much as someone added.
    const before = await this.approvers.find({
      where: { action_key: actionKey },
      select: { employee_id: true },
    });

    await this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(ApprovalActionApprover);
      await repo.delete({ action_key: actionKey });
      if (employeeIds.length > 0) {
        await repo.save(
          employeeIds.map((eid) =>
            repo.create({ action_key: actionKey, employee_id: eid, level: 1 }),
          ),
        );
      }
    });

    // `requests.approvals.review` is derived from these rows
    // (PermissionsService.deriveRequestScreens), so the cached blob is stale
    // for everyone on either side of the swap. Invalidate rather than patch:
    // an employee dropped from THIS action may still approve another one, and
    // the recompute settles that. Same pattern as
    // ProgrammeAdmissionYearsService.setProfileVerifiers.
    const affected = new Set([
      ...before.map((b) => b.employee_id),
      ...employeeIds,
    ]);
    await Promise.all(
      [...affected].map((id) => this.permissions.invalidate(id)),
    );

    return this.approversFor(actionKey);
  }

  // ---------------------------------------------------------------------------
  // Reuse seam — what the actual approval screens will call. Keep these stable.
  // ---------------------------------------------------------------------------

  /** Full approver rows for an action, ordered by name. */
  async approversFor(actionKey: string): Promise<ApprovalApproverSummary[]> {
    const rows = await this.approvers
      .createQueryBuilder('a')
      .leftJoin('a.employee', 'e')
      .leftJoin('e.designation', 'des')
      .leftJoin('e.department', 'dep')
      .select('e.id', 'id')
      .addSelect('e.emp_code', 'emp_code')
      .addSelect('e.emp_display_name', 'emp_display_name')
      .addSelect('des.name', 'designation')
      .addSelect('dep.name', 'department')
      .where('a.action_key = :actionKey', { actionKey })
      .orderBy('e.emp_display_name', 'ASC')
      .getRawMany<ApprovalApproverSummary>();

    return rows.map((r) => ({ ...r, id: Number(r.id) }));
  }

  /** Just the ids — for notification fan-out and `IN (...)` filters. */
  async getApproverEmployeeIds(actionKey: string): Promise<number[]> {
    const rows = await this.approvers.find({
      where: { action_key: actionKey },
      select: { employee_id: true },
    });
    return rows.map((r) => r.employee_id);
  }

  /**
   * Single indexed existence check — the act-time authority guard. Pass the
   * caller's `manager` when deciding inside a transaction, so the check runs on
   * the same connection that holds the request's row lock.
   */
  isApprover(
    employeeId: number,
    actionKey: string,
    manager?: EntityManager,
  ): Promise<boolean> {
    const repo = manager
      ? manager.getRepository(ApprovalActionApprover)
      : this.approvers;
    return repo.exists({
      where: { employee_id: employeeId, action_key: actionKey },
    });
  }

  /** Every action this employee can approve — drives the derived RBAC grant. */
  async actionKeysForEmployee(employeeId: number): Promise<string[]> {
    const rows = await this.approvers.find({
      where: { employee_id: employeeId },
      select: { action_key: true },
    });
    // Drop keys whose catalog entry has since been removed — stale rows must
    // never grant anything.
    return rows
      .map((r) => r.action_key)
      .filter((key) => APPROVAL_ACTION_BY_KEY.has(key));
  }

  // ---------------------------------------------------------------------------

  private actionOr404(actionKey: string): ApprovalActionDef {
    const action = APPROVAL_ACTION_BY_KEY.get(actionKey);
    if (!action) throw new NotFoundException('Approval action not found');
    return action;
  }

  private async assertEmployeesExist(employeeIds: number[]): Promise<void> {
    if (employeeIds.length === 0) return;
    const found = await this.employees.find({
      where: { id: In(employeeIds) },
      select: { id: true },
    });
    const foundIds = new Set(found.map((e) => e.id));
    const missing = employeeIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Selected approver employee(s) do not exist: ${missing.join(', ')}`,
      );
    }
  }
}
