import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, QueryFailedError, Repository } from 'typeorm';
import { BLOOD_GROUPS, Student } from '../../admin/entities/student.entity';
import {
  ApprovalRequestsService,
  RequesterRequestView,
} from '../../requests/approval-requests.service';
import {
  ApprovalRequest,
  OPEN_APPROVAL_REQUEST_STATUSES,
} from '../../requests/entities/approval-request.entity';
import {
  ApprovalRequestTypeHandler,
  DecidedStatus,
  DecisionInput,
  DecisionResult,
  ItemVerdict,
  RequestTypeRegistry,
} from '../../requests/request-type.registry';
import { CreateProfileUpdateRequestDto } from './dto/create-profile-update-request.dto';

/**
 * The `profile_update` request type — owned HERE, by the student-profile
 * domain, not by the requests framework. This module decides which fields are
 * requestable, validates values, snapshots current data, applies the change on
 * approval, and words the notifications; the framework only runs the lifecycle.
 */
export const PROFILE_UPDATE_FIELDS = [
  'mobile_number',
  'email',
  'blood_group',
  'abc_id',
] as const;
export type ProfileUpdateField = (typeof PROFILE_UPDATE_FIELDS)[number];

export interface ProfileUpdateChange {
  field: ProfileUpdateField;
  from: string | null;
  to: string;
  /** Per-field verdict, written when the request is decided (partial or full). */
  outcome?: ItemVerdict;
}

// Type alias (not interface) so it stays assignable to the framework's opaque
// Record<string, unknown> payload column.
export type ProfileUpdatePayload = { changes: ProfileUpdateChange[] };

export interface ProfileUpdateContext {
  current: {
    mobile_number: string;
    email: string;
    blood_group: string | null;
    abc_id: string | null;
  };
  blood_groups: readonly string[];
  /**
   * Fields locked by an OPEN request — pending, or sent back for changes
   * (union across all of them). A new request may not touch these — clients
   * warn and disable them; other fields stay requestable. Name kept for the
   * client contract; a sent-back request keeps its claim, so this is wider
   * than "pending" in the status sense.
   */
  pending_fields: ProfileUpdateField[];
}

const FIELD_LABELS: Record<ProfileUpdateField, string> = {
  mobile_number: 'Mobile number',
  email: 'Email',
  blood_group: 'Blood group',
  abc_id: 'ABC ID',
};

const REQUEST_TYPE = 'profile_update' as const;

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof QueryFailedError &&
    (err.driverError as { code?: string } | undefined)?.code === '23505'
  );
}

/** Union of fields across the given requests' payloads, in canonical order. */
function fieldsOf(requests: ApprovalRequest[]): ProfileUpdateField[] {
  const present = new Set<string>();
  for (const r of requests) {
    const payload = r.payload as ProfileUpdatePayload;
    for (const change of payload?.changes ?? []) present.add(change.field);
  }
  return PROFILE_UPDATE_FIELDS.filter((f) => present.has(f));
}

@Injectable()
export class ProfileUpdateRequestService
  implements ApprovalRequestTypeHandler, OnModuleInit
{
  readonly type = REQUEST_TYPE;

  readonly catalog = {
    module: {
      key: 'profile',
      label: 'Student Profile',
      icon: 'UserRound',
      order: 10,
    },
    label: 'Profile Update',
    order: 10,
  };

  constructor(
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
    private readonly approvalRequests: ApprovalRequestsService,
    private readonly registry: RequestTypeRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  /** Current values + options the new-request form prefils from. */
  async context(studentId: number): Promise<ProfileUpdateContext> {
    const s = await this.students.findOne({ where: { id: studentId } });
    if (!s) throw new NotFoundException('Student not found');
    const open = await this.approvalRequests.openRequests(
      studentId,
      REQUEST_TYPE,
    );
    return {
      current: {
        mobile_number: s.mobile_number,
        email: s.email,
        blood_group: s.blood_group,
        abc_id: s.abc_id,
      },
      blood_groups: BLOOD_GROUPS,
      pending_fields: fieldsOf(open),
    };
  }

  /**
   * Snapshot current values as `from` and drop no-op fields. Re-run on every
   * submit (including resubmits) so `from` reflects the profile as it stands
   * now, not as it stood when the request was first raised.
   */
  private async diffAgainstProfile(
    studentId: number,
    dto: CreateProfileUpdateRequestDto,
  ): Promise<ProfileUpdatePayload> {
    const s = await this.students.findOne({ where: { id: studentId } });
    if (!s) throw new NotFoundException('Student not found');

    const c = dto.changes;
    const changes: ProfileUpdateChange[] = [];
    if (c.mobile_number !== undefined && c.mobile_number !== s.mobile_number) {
      changes.push({
        field: 'mobile_number',
        from: s.mobile_number,
        to: c.mobile_number,
      });
    }
    // Stored emails are already lowercased (admin DTO transform), as is the
    // incoming value — compare defensively anyway.
    if (c.email !== undefined && c.email !== s.email.toLowerCase()) {
      changes.push({ field: 'email', from: s.email, to: c.email });
    }
    if (c.blood_group !== undefined && c.blood_group !== s.blood_group) {
      changes.push({
        field: 'blood_group',
        from: s.blood_group,
        to: c.blood_group,
      });
    }
    if (c.abc_id !== undefined && c.abc_id !== s.abc_id) {
      changes.push({ field: 'abc_id', from: s.abc_id, to: c.abc_id });
    }

    if (changes.length === 0) {
      throw new BadRequestException(
        'Nothing to request — every value matches your current profile.',
      );
    }
    return { changes };
  }

  /** Hand a fresh payload to the framework (which enforces routing + dupes). */
  async create(
    studentId: number,
    dto: CreateProfileUpdateRequestDto,
  ): Promise<RequesterRequestView> {
    const payload = await this.diffAgainstProfile(studentId, dto);
    return this.approvalRequests.createForStudent(
      studentId,
      REQUEST_TYPE,
      payload,
      dto.note ?? null,
    );
  }

  /**
   * Revise a sent-back request and put it back in the queue. The payload is
   * rebuilt from scratch against the live profile — the student may have
   * changed which fields they're asking for, not just the values — and the
   * framework re-checks status/ownership under a lock.
   */
  async resubmit(
    studentId: number,
    id: number,
    dto: CreateProfileUpdateRequestDto,
  ): Promise<RequesterRequestView> {
    const payload = await this.diffAgainstProfile(studentId, dto);
    return this.approvalRequests.resubmitForStudent(
      studentId,
      id,
      REQUEST_TYPE,
      payload,
      dto.note ?? null,
    );
  }

  // ---------------------------------------------------------------------------
  // ApprovalRequestTypeHandler — called inside the framework's transactions
  // ---------------------------------------------------------------------------

  /**
   * Duplicate rule for this type: several open profile-update requests may
   * coexist, but no field may appear in more than one of them. `exceptId`
   * excludes a request from its own check — a resubmit compares against the
   * OTHER open requests, or it would always clash with itself.
   */
  private async assertNoFieldClash(
    tx: EntityManager,
    studentId: number,
    payload: Record<string, unknown>,
    exceptId?: number,
  ): Promise<void> {
    const open = await tx.getRepository(ApprovalRequest).find({
      where: {
        requester_student_id: studentId,
        request_type: REQUEST_TYPE,
        status: In([...OPEN_APPROVAL_REQUEST_STATUSES]),
      },
    });
    const taken = new Set(
      fieldsOf(open.filter((r) => r.id !== exceptId)),
    );
    const incoming = (payload as ProfileUpdatePayload)?.changes ?? [];
    const clashes = incoming.map((c) => c.field).filter((f) => taken.has(f));
    if (clashes.length > 0) {
      const labels = clashes.map((f) => FIELD_LABELS[f] ?? f).join(', ');
      throw new ConflictException(
        `Already awaiting approval: ${labels}. Cancel that request or leave those fields unchanged.`,
      );
    }
  }

  /**
   * Runs inside the create transaction under the framework's per-requester
   * advisory lock, so concurrent submits can't race the check.
   */
  async assertCreatable(
    tx: EntityManager,
    studentId: number,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.assertNoFieldClash(tx, studentId, payload);
  }

  /** Same rule on resubmit, minus the request being resubmitted. */
  async assertResubmittable(
    tx: EntityManager,
    studentId: number,
    request: ApprovalRequest,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.assertNoFieldClash(tx, studentId, payload, request.id);
  }

  /**
   * Decide the request — uniformly or per field. Approved fields are written
   * onto the student row; rejected ones are left untouched. Uniqueness of
   * email / ABC ID is pre-checked with clear 409s (mirroring the admin
   * students service); the partial `update()` avoids the eager-relation
   * save() clobber. Values already matching are skipped, so approving after
   * an admin made the same edit is a no-op rather than an error. Policy: `to`
   * wins even if the live value drifted from the `from` snapshot.
   */
  async applyDecision(
    tx: EntityManager,
    request: ApprovalRequest,
    input: DecisionInput,
  ): Promise<DecisionResult> {
    if (request.requester_student_id === null) {
      throw new InternalServerErrorException(
        'profile_update requests must have a student requester',
      );
    }
    const payload = request.payload as ProfileUpdatePayload;
    const changes = payload?.changes ?? [];

    // Resolve a verdict per field. A per-item decision must cover every field
    // exactly — no unknowns, no gaps — so a request is never left half-decided.
    let verdictOf: (field: ProfileUpdateField) => ItemVerdict;
    if ('verdict' in input) {
      verdictOf = () => input.verdict;
    } else {
      const fields = changes.map((c) => c.field);
      const unknown = Object.keys(input.verdicts).filter(
        (k) => !(fields as string[]).includes(k),
      );
      const missing = fields.filter((f) => input.verdicts[f] === undefined);
      if (unknown.length > 0 || missing.length > 0) {
        const parts: string[] = [];
        if (unknown.length > 0)
          parts.push(`not part of this request: ${unknown.join(', ')}`);
        if (missing.length > 0)
          parts.push(
            `missing a verdict: ${missing
              .map((f) => FIELD_LABELS[f] ?? f)
              .join(', ')}`,
          );
        throw new BadRequestException(
          `Every field needs exactly one verdict — ${parts.join('; ')}.`,
        );
      }
      verdictOf = (field) => input.verdicts[field];
    }

    const annotated: ProfileUpdateChange[] = changes.map((c) => ({
      ...c,
      outcome: verdictOf(c.field),
    }));
    const approved = annotated.filter((c) => c.outcome === 'approved');

    if (approved.length > 0) {
      const repo = tx.getRepository(Student);
      const s = await repo.findOne({
        where: { id: request.requester_student_id },
      });
      if (!s) throw new NotFoundException('Student no longer exists');

      const patch: Partial<
        Pick<Student, 'mobile_number' | 'email' | 'blood_group' | 'abc_id'>
      > = {};
      for (const change of approved) {
        switch (change.field) {
          case 'mobile_number':
            if (s.mobile_number !== change.to) patch.mobile_number = change.to;
            break;
          case 'email':
            if (s.email !== change.to) patch.email = change.to;
            break;
          case 'blood_group':
            if (s.blood_group !== change.to) patch.blood_group = change.to;
            break;
          case 'abc_id':
            if (s.abc_id !== change.to) patch.abc_id = change.to;
            break;
        }
      }

      if (patch.email) {
        const clash = await repo
          .createQueryBuilder('s')
          .where('LOWER(s.email) = LOWER(:v)', { v: patch.email })
          .andWhere('s.id != :id', { id: s.id })
          .getOne();
        if (clash) {
          throw new ConflictException(
            'The requested email is already in use by another student — reject that field or ask the student to resubmit with a different value.',
          );
        }
      }
      if (patch.abc_id) {
        const clash = await repo
          .createQueryBuilder('s')
          .where('s.abc_id = :v', { v: patch.abc_id })
          .andWhere('s.id != :id', { id: s.id })
          .getOne();
        if (clash) {
          throw new ConflictException(
            'The requested ABC ID is already in use by another student — reject that field or ask the student to resubmit with a different value.',
          );
        }
      }

      if (Object.keys(patch).length > 0) {
        try {
          await repo.update({ id: s.id }, patch);
        } catch (err) {
          // Unique-index race backstop behind the pre-checks above.
          if (isUniqueViolation(err)) {
            throw new ConflictException(
              'A requested value is already in use by another student — reject that field or ask the student to resubmit.',
            );
          }
          throw err;
        }
      }
    }

    // No dedicated "partial" status: uniform verdicts derive the request
    // status; mixed verdicts take the approver's explicit overall pick.
    const hasApproved = approved.length > 0;
    const hasRejected = approved.length < annotated.length;
    let status: DecidedStatus;
    if (hasApproved && hasRejected) {
      const overall = 'overall' in input ? input.overall : undefined;
      if (!overall) {
        throw new BadRequestException(
          'Pick an overall status (approved or rejected) for a mixed decision.',
        );
      }
      status = overall;
    } else {
      status = hasApproved ? 'approved' : 'rejected';
    }
    const nextPayload: ProfileUpdatePayload = { changes: annotated };
    return { status, payload: nextPayload };
  }

  decisionNotification(
    request: ApprovalRequest,
    status: DecidedStatus,
    note: string | null,
  ): { title: string; body: string } {
    const payload = request.payload as ProfileUpdatePayload;
    const changes = payload?.changes ?? [];
    const labels = (list: ProfileUpdateChange[]) =>
      list.map((c) => FIELD_LABELS[c.field] ?? c.field).join(', ');
    const approved = changes.filter((c) => c.outcome === 'approved');
    const rejected = changes.filter((c) => c.outcome === 'rejected');
    const title =
      status === 'approved'
        ? 'Profile update approved'
        : 'Profile update rejected';

    // Mixed verdicts: the copy spells out the per-field split, whatever the
    // approver picked as the overall status.
    if (approved.length > 0 && rejected.length > 0) {
      return {
        title,
        body:
          `Approved and applied: ${labels(approved)}. Rejected: ${labels(rejected)}.` +
          (note ? ` Note: ${note}` : ''),
      };
    }
    if (status === 'approved') {
      return {
        title,
        body: `Your requested changes (${labels(changes)}) have been applied to your profile.`,
      };
    }
    return {
      title,
      body: note
        ? `Your profile-update request (${labels(changes)}) was rejected: ${note}`
        : `Your profile-update request (${labels(changes)}) was rejected.`,
    };
  }
}
