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
import { Country } from '../../admin/entities/country.entity';
import { DiplomaBoard } from '../../admin/entities/diploma-board.entity';
import { District } from '../../admin/entities/district.entity';
import { EntranceExam } from '../../admin/entities/entrance-exam.entity';
import { IndustryCertification } from '../../admin/entities/industry-certification.entity';
import { SchoolBoardX } from '../../admin/entities/school-board-x.entity';
import { SchoolBoardXii } from '../../admin/entities/school-board-xii.entity';
import { State } from '../../admin/entities/state.entity';
import {
  BLOOD_GROUPS,
  GENDERS,
  Student,
} from '../../admin/entities/student.entity';
import { StudentIndustryCertification } from '../../admin/entities/student-industry-certification.entity';
import { GuardianSyncService } from '../../guardian/guardian-sync.service';
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
  RequestRequesterRef,
  RequestTypeRegistry,
} from '../../requests/request-type.registry';
import { isStudentCertificateKey } from '../../storage/storage.constants';
import { StorageService } from '../../storage/storage.service';
import { CreateProfileUpdateRequestDto } from './dto/create-profile-update-request.dto';
import {
  LookupTable,
  PROFILE_FIELD_BY_KEY,
  PROFILE_FIELD_DEFS,
  PROFILE_FIELD_LABELS,
  ProfileFieldDef,
  appliesTo,
  columnOf,
  requestableSimpleFieldsFor,
} from './profile-fields';

/**
 * The `profile_update` request type — owned HERE, by the student-profile
 * domain, not by the requests framework. This module decides which fields are
 * requestable (driven by the field-policy registry in profile-fields.ts),
 * validates values, snapshots current data, applies the change on approval,
 * and words the notifications; the framework only runs the lifecycle.
 *
 * Payload V2: `field` is the verdict key; `from`/`to` may be scalars, FK ids,
 * or objects for the atomic units (entrance exam, gap, certification entries);
 * `display` snapshots human-readable text AT CREATE TIME so approver UIs never
 * join lookups. Legacy V1 payloads (plain strings, no `display`, possibly the
 * old `email` field) still render and decide.
 */
export interface ProfileUpdateChange {
  field: string;
  from: unknown;
  to: unknown;
  display?: { from: string; to: string };
  /** Per-field verdict, written when the request is decided (partial or full). */
  outcome?: ItemVerdict;
}

// Type alias (not interface) so it stays assignable to the framework's opaque
// Record<string, unknown> payload column.
export type ProfileUpdatePayload = { v?: 2; changes: ProfileUpdateChange[] };

/** The `to` value of an 'entrance_exam' unit item. */
interface EntranceExamValue {
  na: boolean;
  entrance_exam_id: number | null;
  exam_name: string | null;
  entrance_exam_rank: number | null;
  entrance_exam_year: number | null;
}

/** The `to` value of a 'gap' unit item. */
interface GapValue {
  year_of_gap: number | null;
  reason_of_gap: string | null;
}

/** The `to` value of a 'certification:<id>' item. */
interface CertificationValue {
  industry_certification_id: number;
  name: string;
  certificate_file_key: string;
  /** Presigned URL — attached per view by enrichPayloadForView, never stored. */
  certificate_file_url?: string;
}

export interface ProfileUpdateContext {
  entry_type: number;
  /** Wire key → raw current value (FK fields carry the id). */
  current: Record<string, unknown>;
  /** Wire key → resolved display text for FK fields (id would be opaque). */
  display: Record<string, string | null>;
  entrance_exam: Omit<EntranceExamValue, 'exam_name'> & {
    exam_name: string | null;
  };
  gap: GapValue;
  blood_groups: readonly string[];
  genders: readonly string[];
  /**
   * Item keys locked by an OPEN request — pending, or sent back for changes
   * (union across all of them). A new request may not touch these.
   */
  pending_fields: string[];
  /** Certifications the student already holds — can't be re-requested. */
  held_certification_ids: number[];
  /**
   * Every mandatory requestable key for this entry type (red-asterisk set).
   * Unit keys ('entrance_exam', 'gap'), not their member fields.
   */
  mandatory_fields: string[];
  /**
   * The blocking subset: mandatory keys still EMPTY on the profile and not
   * claimed by another open request. Create/resubmit rejects a payload that
   * doesn't cover all of these — once the profile is complete this is empty
   * and partial (few-field) requests pass.
   */
  required_now: string[];
  /** The year the student actually joined (batch year, +1 for lateral). */
  join_year: number;
  /**
   * Auto-computed gap suggestion: join year − 12th (regular) / diploma
   * (lateral) year of pass. Null when the relevant year of pass is unknown.
   * Suggestion only — clients prefill + warn; nothing is written untasked.
   */
  suggested_gap: { years: number; basis: 'twelfth' | 'diploma' } | null;
}

const REQUEST_TYPE = 'profile_update' as const;
const CERTIFICATION_KEY_PREFIX = 'certification:';

const LOOKUP_ENTITY: Record<LookupTable, new () => LookupRow> = {
  countries: Country,
  states: State,
  districts: District,
  entrance_exams: EntranceExam,
  industry_certifications: IndustryCertification,
  school_boards_x: SchoolBoardX,
  school_boards_xii: SchoolBoardXii,
  diploma_boards: DiplomaBoard,
};

interface LookupRow {
  id: number;
  name: string;
  is_active: boolean;
}

type LookupNames = Map<LookupTable, Map<number, LookupRow>>;

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof QueryFailedError &&
    (err.driverError as { code?: string } | undefined)?.code === '23505'
  );
}

/** The year the student actually joined — laterals enter the 2nd year, one
 * calendar year after their batch's base admission year (same view-only rule
 * as displayedAdmissionYear). */
function joinYearOf(s: Student): number {
  return s.admission_year.year + (s.entry_type === 2 ? 1 : 0);
}

/**
 * Auto-computed education-gap suggestion: join year minus the year of pass of
 * the qualifying exam (12th for regular entrants, diploma for lateral). Null
 * when that year of pass isn't recorded yet.
 */
function suggestedGapFor(
  s: Student,
): { years: number; basis: 'twelfth' | 'diploma' } | null {
  const basis = s.entry_type === 2 ? 'diploma' : 'twelfth';
  const passYear =
    basis === 'diploma' ? s.diploma_year_of_pass : s.twelfth_year_of_pass;
  if (passYear === null || passYear === undefined) return null;
  return { years: Math.max(0, joinYearOf(s) - passYear), basis };
}

function isEmptyScalar(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

/** The entrance unit counts as filled when explicitly N/A or fully recorded. */
function entranceFilled(s: Student): boolean {
  return (
    s.entrance_exam_na ||
    (s.entrance_exam_id !== null &&
      s.entrance_exam_rank !== null &&
      s.entrance_exam_year !== null)
  );
}

/** The gap unit counts as filled once a year is recorded — zero included. */
function gapFilled(s: Student): boolean {
  return s.year_of_gap !== null;
}

/**
 * Every mandatory requestable key for the entry type — the red-asterisk set.
 * Units appear as their unit keys; their member fields never surface alone.
 * (Both units are mandatory for both entry types in the registry.)
 */
function mandatoryFieldsFor(entryType: number): string[] {
  const simple = requestableSimpleFieldsFor(entryType)
    .filter((d) => appliesTo(d.mandatory, entryType))
    .map((d) => d.key);
  return [...simple, 'entrance_exam', 'gap'];
}

/**
 * The keys a new request MUST include: mandatory for the entry type, still
 * empty on the student row, and not claimed by another open request. Fields
 * that can't be filled through this form (personal email → OTP flow, resume →
 * upload) are structurally absent — requestableSimpleFieldsFor never yields
 * them. Empty once the profile is complete, which re-enables partial requests.
 */
function requiredNowFor(s: Student, locked: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const def of requestableSimpleFieldsFor(s.entry_type)) {
    if (!appliesTo(def.mandatory, s.entry_type)) continue;
    const col = columnOf(def);
    if (!col) continue;
    if (!isEmptyScalar(s[col])) continue;
    if (locked.has(def.key)) continue;
    out.push(def.key);
  }
  if (!entranceFilled(s) && !locked.has('entrance_exam')) {
    out.push('entrance_exam');
  }
  if (!gapFilled(s) && !locked.has('gap')) out.push('gap');
  return out;
}

/** Canonical ordering of item keys: registry order, units, then the rest. */
const CANONICAL_KEY_ORDER: string[] = [
  ...PROFILE_FIELD_DEFS.filter((d) => !d.unit).map((d) => d.key),
  'entrance_exam',
  'gap',
];

/** Union of item keys across the given requests' payloads, canonical first. */
function fieldsOf(requests: ApprovalRequest[]): string[] {
  const present = new Set<string>();
  for (const r of requests) {
    const payload = r.payload as ProfileUpdatePayload;
    for (const change of payload?.changes ?? []) present.add(change.field);
  }
  const ordered = CANONICAL_KEY_ORDER.filter((k) => present.has(k));
  const rest = [...present].filter((k) => !CANONICAL_KEY_ORDER.includes(k));
  return [...ordered, ...rest.sort()];
}

/** Label for one change item (handles the dynamic certification keys). */
function labelOf(change: ProfileUpdateChange): string {
  if (change.field.startsWith(CERTIFICATION_KEY_PREFIX)) {
    const name = (change.to as CertificationValue | null)?.name;
    return name ? `Certification: ${name}` : 'Certification';
  }
  return PROFILE_FIELD_LABELS[change.field] ?? change.field;
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
    requester: 'student' as const,
  };

  constructor(
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
    private readonly approvalRequests: ApprovalRequestsService,
    private readonly registry: RequestTypeRegistry,
    private readonly storage: StorageService,
    private readonly guardianSync: GuardianSyncService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  // ---------------------------------------------------------------------------
  // Lookup helpers
  // ---------------------------------------------------------------------------

  /** Load id → row maps for the requested ids, one query per lookup table. */
  private async loadLookups(
    manager: EntityManager,
    wanted: Map<LookupTable, Set<number>>,
  ): Promise<LookupNames> {
    const out: LookupNames = new Map();
    for (const [table, ids] of wanted) {
      const list = [...ids].filter((v) => Number.isFinite(v));
      if (list.length === 0) {
        out.set(table, new Map());
        continue;
      }
      const rows = await manager
        .getRepository<LookupRow>(LOOKUP_ENTITY[table])
        .find({ where: { id: In(list) } });
      out.set(table, new Map(rows.map((r) => [r.id, r])));
    }
    return out;
  }

  private displayOf(
    def: ProfileFieldDef,
    value: unknown,
    lookups: LookupNames,
  ): string {
    if (value === null || value === undefined || value === '') return '—';
    if (def.kind === 'boolean') return value ? 'Yes' : 'No';
    // Registry field values are scalars by construction (unit/object values
    // never reach here) — safe to stringify.
    const scalar = value as string | number;
    if (def.kind === 'fk' && def.fk) {
      return lookups.get(def.fk)?.get(Number(value))?.name ?? `#${scalar}`;
    }
    return String(scalar);
  }

  /** Value comparison per field kind (numerics survive string/number drift). */
  private isSameValue(def: ProfileFieldDef, a: unknown, b: unknown): boolean {
    const aEmpty = a === null || a === undefined || a === '';
    const bEmpty = b === null || b === undefined || b === '';
    if (aEmpty || bEmpty) return aEmpty === bEmpty;
    if (['percentage', 'cgpa', 'number', 'year', 'fk'].includes(def.kind)) {
      return Number(a) === Number(b);
    }
    if (def.kind === 'boolean') return Boolean(a) === Boolean(b);
    // Registry field values are scalars by construction.
    const aScalar = a as string | number;
    const bScalar = b as string | number;
    return String(aScalar) === String(bScalar);
  }

  private entranceValueOf(
    s: Student,
    examName: string | null,
  ): EntranceExamValue {
    return {
      na: s.entrance_exam_na,
      entrance_exam_id: s.entrance_exam_id,
      exam_name: examName,
      entrance_exam_rank: s.entrance_exam_rank,
      entrance_exam_year: s.entrance_exam_year,
    };
  }

  private entranceDisplay(v: EntranceExamValue): string {
    if (v.na) return 'Not applicable';
    if (v.entrance_exam_id === null && v.entrance_exam_rank === null)
      return '—';
    const parts = [
      v.exam_name ?? (v.entrance_exam_id ? `#${v.entrance_exam_id}` : null),
      v.entrance_exam_rank !== null ? `Rank ${v.entrance_exam_rank}` : null,
      v.entrance_exam_year !== null ? String(v.entrance_exam_year) : null,
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : '—';
  }

  private gapDisplay(v: GapValue): string {
    if (v.year_of_gap === null || v.year_of_gap === undefined) return '—';
    if (v.year_of_gap === 0) return 'No gap';
    const years = `${v.year_of_gap} year${v.year_of_gap === 1 ? '' : 's'}`;
    return v.reason_of_gap ? `${years} — ${v.reason_of_gap}` : years;
  }

  // ---------------------------------------------------------------------------
  // Context (form prefill)
  // ---------------------------------------------------------------------------

  async context(studentId: number): Promise<ProfileUpdateContext> {
    const s = await this.students.findOne({ where: { id: studentId } });
    if (!s) throw new NotFoundException('Student not found');
    const open = await this.approvalRequests.openRequests(
      studentId,
      REQUEST_TYPE,
    );

    const defs = requestableSimpleFieldsFor(s.entry_type);

    // Resolve display names for every set FK value in one pass.
    const wanted = new Map<LookupTable, Set<number>>();
    const want = (table: LookupTable, id: unknown) => {
      if (id === null || id === undefined) return;
      if (!wanted.has(table)) wanted.set(table, new Set());
      wanted.get(table)!.add(Number(id));
    };
    for (const def of defs) {
      if (def.kind === 'fk' && def.fk) {
        want(def.fk, s[columnOf(def) as keyof Student]);
      }
    }
    want('entrance_exams', s.entrance_exam_id);
    const lookups = await this.loadLookups(this.students.manager, wanted);

    const current: Record<string, unknown> = {};
    const display: Record<string, string | null> = {};
    for (const def of defs) {
      const col = columnOf(def);
      if (!col) continue;
      current[def.key] = s[col];
      if (def.kind === 'fk' && def.fk) {
        display[def.key] =
          s[col] === null ? null : this.displayOf(def, s[col], lookups);
      }
    }
    // Legacy client compat: the old 4-field form reads current.email.
    current.email = s.email;

    const held = await this.students.manager
      .getRepository(StudentIndustryCertification)
      .find({ where: { student_id: studentId } });

    const examName = s.entrance_exam_id
      ? (lookups.get('entrance_exams')?.get(s.entrance_exam_id)?.name ?? null)
      : null;

    const lockedKeys = new Set(fieldsOf(open));

    return {
      entry_type: s.entry_type,
      current,
      display,
      entrance_exam: this.entranceValueOf(s, examName),
      gap: { year_of_gap: s.year_of_gap, reason_of_gap: s.reason_of_gap },
      blood_groups: BLOOD_GROUPS,
      genders: GENDERS,
      pending_fields: fieldsOf(open),
      held_certification_ids: held.map((h) => h.industry_certification_id),
      mandatory_fields: mandatoryFieldsFor(s.entry_type),
      required_now: requiredNowFor(s, lockedKeys),
      join_year: joinYearOf(s),
      suggested_gap: suggestedGapFor(s),
    };
  }

  // ---------------------------------------------------------------------------
  // Diff (payload building)
  // ---------------------------------------------------------------------------

  /**
   * Snapshot current values as `from`, resolve display text, and drop no-op
   * items. Re-run on every submit (including resubmits) so `from` reflects the
   * profile as it stands now. Also enforces per-entry-type visibility, the
   * certification preconditions (file ownership + existence, no duplicates),
   * and the mandatory-completion rule: while any mandatory field is still
   * empty (and not claimed by another open request), the payload must fill
   * ALL of them — partial requests only unlock once the profile is complete.
   * `exceptRequestId` excludes the request being resubmitted from the
   * locked-keys set (its own fields are arriving in this very payload).
   */
  private async diffAgainstProfile(
    studentId: number,
    dto: CreateProfileUpdateRequestDto,
    exceptRequestId?: number,
  ): Promise<ProfileUpdatePayload> {
    const s = await this.students.findOne({ where: { id: studentId } });
    if (!s) throw new NotFoundException('Student not found');

    const c = dto.changes;
    const manager = this.students.manager;

    // Gather every FK id we need names for (from + to sides).
    const wanted = new Map<LookupTable, Set<number>>();
    const want = (table: LookupTable, id: unknown) => {
      if (id === null || id === undefined) return;
      if (!wanted.has(table)) wanted.set(table, new Set());
      wanted.get(table)!.add(Number(id));
    };
    for (const def of PROFILE_FIELD_DEFS) {
      if (def.kind !== 'fk' || !def.fk || def.unit) continue;
      const col = columnOf(def);
      if (!col) continue;
      const incoming = (c as Record<string, unknown>)[def.key];
      if (incoming !== undefined) {
        want(def.fk, incoming);
        want(def.fk, s[col]);
      }
    }
    if (c.entrance_exam) {
      want('entrance_exams', c.entrance_exam.entrance_exam_id);
      want('entrance_exams', s.entrance_exam_id);
    }
    for (const add of c.certifications_add ?? []) {
      want('industry_certifications', add.industry_certification_id);
    }
    const lookups = await this.loadLookups(manager, wanted);

    const changes: ProfileUpdateChange[] = [];

    // --- Simple fields (everything except the units and certifications) ------
    for (const def of PROFILE_FIELD_DEFS) {
      if (def.unit || def.key === 'industry_certifications') continue;
      if (def.policy !== 'APPROVAL' && def.policy !== 'AUTO_REQUESTABLE') {
        continue;
      }
      const value = (c as Record<string, unknown>)[def.key];
      if (value === undefined) continue;

      if (!appliesTo(def.visible, s.entry_type)) {
        throw new BadRequestException(
          `${def.label} does not apply to ${s.entry_type === 2 ? 'lateral' : 'regular'}-entry students.`,
        );
      }
      if (def.kind === 'fk' && def.fk) {
        const row = lookups.get(def.fk)?.get(Number(value));
        if (!row || !row.is_active) {
          throw new BadRequestException(
            `Pick a valid option for ${def.label}.`,
          );
        }
      }

      const col = columnOf(def);
      if (!col) continue;
      const fromValue = s[col];
      if (this.isSameValue(def, fromValue, value)) continue;

      changes.push({
        field: def.key,
        from: fromValue ?? null,
        to: value,
        display: {
          from: this.displayOf(def, fromValue, lookups),
          to: this.displayOf(def, value, lookups),
        },
      });
    }

    // --- Entrance exam (atomic unit) ------------------------------------------
    if (c.entrance_exam) {
      const g = c.entrance_exam;
      const toValue: EntranceExamValue = g.na
        ? {
            na: true,
            entrance_exam_id: null,
            exam_name: null,
            entrance_exam_rank: null,
            entrance_exam_year: null,
          }
        : {
            na: false,
            entrance_exam_id: g.entrance_exam_id ?? null,
            exam_name:
              lookups.get('entrance_exams')?.get(Number(g.entrance_exam_id))
                ?.name ?? null,
            entrance_exam_rank: g.entrance_exam_rank ?? null,
            entrance_exam_year: g.entrance_exam_year ?? null,
          };
      if (!toValue.na) {
        const row = lookups
          .get('entrance_exams')
          ?.get(Number(toValue.entrance_exam_id));
        if (!row || !row.is_active) {
          throw new BadRequestException('Pick a valid entrance exam.');
        }
      }
      const fromValue = this.entranceValueOf(
        s,
        s.entrance_exam_id
          ? (lookups.get('entrance_exams')?.get(s.entrance_exam_id)?.name ??
              null)
          : null,
      );
      const same =
        fromValue.na === toValue.na &&
        fromValue.entrance_exam_id === toValue.entrance_exam_id &&
        fromValue.entrance_exam_rank === toValue.entrance_exam_rank &&
        fromValue.entrance_exam_year === toValue.entrance_exam_year;
      if (!same) {
        changes.push({
          field: 'entrance_exam',
          from: fromValue,
          to: toValue,
          display: {
            from: this.entranceDisplay(fromValue),
            to: this.entranceDisplay(toValue),
          },
        });
      }
    }

    // --- Gap (atomic unit) ------------------------------------------------------
    if (c.gap) {
      const toValue: GapValue = {
        year_of_gap: c.gap.year_of_gap,
        reason_of_gap:
          c.gap.year_of_gap > 0 ? (c.gap.reason_of_gap ?? null) : null,
      };
      const fromValue: GapValue = {
        year_of_gap: s.year_of_gap,
        reason_of_gap: s.reason_of_gap,
      };
      const same =
        fromValue.year_of_gap === toValue.year_of_gap &&
        (fromValue.reason_of_gap ?? null) === (toValue.reason_of_gap ?? null);
      if (!same) {
        changes.push({
          field: 'gap',
          from: fromValue,
          to: toValue,
          display: {
            from: this.gapDisplay(fromValue),
            to: this.gapDisplay(toValue),
          },
        });
      }
    }

    // --- Certifications (repeatable; add-only) -----------------------------------
    if (c.certifications_add?.length) {
      const seen = new Set<number>();
      const held = new Set(
        (
          await manager
            .getRepository(StudentIndustryCertification)
            .find({ where: { student_id: studentId } })
        ).map((h) => h.industry_certification_id),
      );
      for (const add of c.certifications_add) {
        const certId = add.industry_certification_id;
        if (seen.has(certId)) {
          throw new BadRequestException(
            'Each certification can appear only once per request.',
          );
        }
        seen.add(certId);

        const row = lookups.get('industry_certifications')?.get(certId);
        if (!row || !row.is_active) {
          throw new BadRequestException('Pick a valid certification.');
        }
        if (held.has(certId)) {
          throw new ConflictException(
            `You already hold ${row.name} on your profile.`,
          );
        }
        // The supporting file is the precondition for the entry: it must live
        // in THIS student's own folder and actually exist in storage.
        if (!isStudentCertificateKey(add.certificate_file_key, studentId)) {
          throw new BadRequestException(
            'Upload the certificate file first, then submit the request.',
          );
        }
        if (!(await this.storage.objectExists(add.certificate_file_key))) {
          throw new BadRequestException(
            'The uploaded certificate file could not be found — upload it again.',
          );
        }

        const toValue: CertificationValue = {
          industry_certification_id: certId,
          name: row.name,
          certificate_file_key: add.certificate_file_key,
        };
        changes.push({
          field: `${CERTIFICATION_KEY_PREFIX}${certId}`,
          from: null,
          to: toValue,
          display: {
            from: '—',
            to: `${row.name} (certificate attached)`,
          },
        });
      }
    }

    if (changes.length === 0) {
      throw new BadRequestException(
        'Nothing to request — every value matches your current profile.',
      );
    }

    // Mandatory-completion gate: every still-empty mandatory key (not held by
    // another open request) must be part of THIS payload. Once the profile is
    // complete the set is empty and single-field fixes go straight through.
    const open = await this.approvalRequests.openRequests(
      studentId,
      REQUEST_TYPE,
    );
    const locked = new Set(
      fieldsOf(open.filter((r) => r.id !== exceptRequestId)),
    );
    const provided = new Set(changes.map((ch) => ch.field));
    const missing = requiredNowFor(s, locked).filter((k) => !provided.has(k));
    if (missing.length > 0) {
      const labels = missing
        .map((k) => PROFILE_FIELD_LABELS[k] ?? k)
        .join(', ');
      throw new BadRequestException(
        `Fill the remaining mandatory fields first: ${labels}.`,
      );
    }

    return { v: 2, changes };
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
    const payload = await this.diffAgainstProfile(studentId, dto, id);
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
   * coexist, but no item key may appear in more than one of them. `exceptId`
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
    const taken = new Set(fieldsOf(open.filter((r) => r.id !== exceptId)));
    const incoming = (payload as ProfileUpdatePayload)?.changes ?? [];
    const clashes = incoming.filter((c) => taken.has(c.field));
    if (clashes.length > 0) {
      const labels = clashes.map((c) => labelOf(c)).join(', ');
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
    requester: RequestRequesterRef,
    payload: Record<string, unknown>,
  ): Promise<void> {
    this.assertStudentRequester(requester.kind);
    await this.assertNoFieldClash(tx, requester.id, payload);
  }

  /** Same rule on resubmit, minus the request being resubmitted. */
  async assertResubmittable(
    tx: EntityManager,
    requester: RequestRequesterRef,
    request: ApprovalRequest,
    payload: Record<string, unknown>,
  ): Promise<void> {
    this.assertStudentRequester(requester.kind);
    await this.assertNoFieldClash(tx, requester.id, payload, request.id);
  }

  /** This type is student-only; anything else is a wiring bug, not user input. */
  private assertStudentRequester(kind: string): void {
    if (kind !== 'student') {
      throw new InternalServerErrorException(
        'profile_update requests must have a student requester',
      );
    }
  }

  /**
   * Decide the request — uniformly or per item. Approved items are written
   * onto the student row (units expand to their columns; certification items
   * insert rows); rejected ones are left untouched. Uniqueness of email /
   * ABC ID / Aadhaar is pre-checked with clear 409s; the partial `update()`
   * avoids the eager-relation save() clobber. Values already matching are
   * skipped, so approving after an admin made the same edit is a no-op rather
   * than an error. Policy: `to` wins even if the live value drifted from the
   * `from` snapshot.
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
    // Nothing on a profile update is the approver's to edit — they approve or
    // reject each field. Silently dropping the edits would let a mis-targeted
    // client believe it changed something.
    if (input.overrides) {
      throw new BadRequestException(
        'Profile-update requests cannot be edited by the approver.',
      );
    }
    const studentId = request.requester_student_id;
    const payload = request.payload as ProfileUpdatePayload;
    const changes = payload?.changes ?? [];

    // Resolve a verdict per item. A per-item decision must cover every item
    // exactly — no unknowns, no gaps — so a request is never left half-decided.
    let verdictOf: (field: string) => ItemVerdict;
    if ('verdict' in input) {
      verdictOf = () => input.verdict;
    } else {
      const fields = changes.map((c) => c.field);
      const unknown = Object.keys(input.verdicts).filter(
        (k) => !fields.includes(k),
      );
      const missing = fields.filter((f) => input.verdicts[f] === undefined);
      if (unknown.length > 0 || missing.length > 0) {
        const parts: string[] = [];
        if (unknown.length > 0)
          parts.push(`not part of this request: ${unknown.join(', ')}`);
        if (missing.length > 0)
          parts.push(
            `missing a verdict: ${missing
              .map((f) => PROFILE_FIELD_LABELS[f] ?? f)
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
      const s = await repo.findOne({ where: { id: studentId } });
      if (!s) throw new NotFoundException('Student no longer exists');

      const patch: Partial<Record<keyof Student, unknown>> = {};
      let touchedGuardianFields = false;

      for (const change of approved) {
        const { field } = change;

        // Legacy V1 requests may still carry an 'email' change (college email
        // was requestable before it became read-only) — keep deciding them.
        if (field === 'email') {
          if (s.email !== change.to) patch.email = change.to;
          continue;
        }

        if (field === 'entrance_exam') {
          const v = change.to as EntranceExamValue;
          if (!v.na && v.entrance_exam_id !== null) {
            const exists = await tx
              .getRepository(EntranceExam)
              .exists({ where: { id: v.entrance_exam_id } });
            if (!exists) {
              throw new ConflictException(
                'The requested entrance exam no longer exists — reject that field.',
              );
            }
          }
          patch.entrance_exam_na = v.na;
          patch.entrance_exam_id = v.na ? null : v.entrance_exam_id;
          patch.entrance_exam_rank = v.na ? null : v.entrance_exam_rank;
          patch.entrance_exam_year = v.na ? null : v.entrance_exam_year;
          continue;
        }

        if (field === 'gap') {
          const v = change.to as GapValue;
          patch.year_of_gap = v.year_of_gap;
          patch.reason_of_gap =
            (v.year_of_gap ?? 0) > 0 ? v.reason_of_gap : null;
          continue;
        }

        if (field.startsWith(CERTIFICATION_KEY_PREFIX)) {
          const v = change.to as CertificationValue;
          const certRepo = tx.getRepository(StudentIndustryCertification);
          const already = await certRepo.exists({
            where: {
              student_id: studentId,
              industry_certification_id: v.industry_certification_id,
            },
          });
          // Skip-if-exists: an admin may have added the same certification
          // while the request was pending — approving is then a no-op.
          if (!already) {
            await certRepo.save(
              certRepo.create({
                student_id: studentId,
                industry_certification_id: v.industry_certification_id,
                certificate_file_key: v.certificate_file_key,
              }),
            );
          }
          continue;
        }

        const def = PROFILE_FIELD_BY_KEY.get(field);
        const col = def ? columnOf(def) : null;
        if (!def || !col) {
          throw new InternalServerErrorException(
            `Unknown profile_update item key "${field}"`,
          );
        }
        if (def.kind === 'fk' && def.fk && change.to !== null) {
          const exists = await tx
            .getRepository<LookupRow>(LOOKUP_ENTITY[def.fk])
            .exists({ where: { id: Number(change.to) } });
          if (!exists) {
            throw new ConflictException(
              `The requested ${def.label} option no longer exists — reject that field.`,
            );
          }
        }
        if (!this.isSameValue(def, s[col], change.to)) {
          patch[col] = change.to;
        }
        if (
          [
            'parent_name',
            'parent_mobile',
            'parent_email',
            'guardian_name',
            'guardian_mobile',
            'guardian_email',
          ].includes(field)
        ) {
          touchedGuardianFields = true;
        }
      }

      // Uniqueness pre-checks with clear 409s (unique-index race backstop below).
      // Aadhaar is unique PER PROGRAMME (a re-admitted student legitimately
      // reuses theirs in another programme), so its check scopes to the row's
      // own programme — students can't change programme through this flow.
      const uniquePrechecks: Array<{
        col: 'email' | 'abc_id' | 'aadhaar_number';
        label: string;
        caseInsensitive?: boolean;
        sameProgramme?: boolean;
      }> = [
        { col: 'email', label: 'email', caseInsensitive: true },
        { col: 'abc_id', label: 'ABC ID' },
        { col: 'aadhaar_number', label: 'Aadhaar number', sameProgramme: true },
      ];
      for (const {
        col,
        label,
        caseInsensitive,
        sameProgramme,
      } of uniquePrechecks) {
        const value = patch[col];
        if (!value) continue;
        const qb = repo
          .createQueryBuilder('s')
          .where(
            caseInsensitive ? `LOWER(s.${col}) = LOWER(:v)` : `s.${col} = :v`,
            { v: value },
          )
          .andWhere('s.id != :id', { id: s.id });
        if (sameProgramme) {
          qb.andWhere('s.programme_id = :pid', { pid: s.programme_id });
        }
        if (await qb.getOne()) {
          throw new ConflictException(
            `The requested ${label} is already in use by another student — reject that field or ask the student to resubmit with a different value.`,
          );
        }
      }

      if (Object.keys(patch).length > 0) {
        try {
          await repo.update(
            { id: s.id },
            patch as Parameters<Repository<Student>['update']>[1],
          );
        } catch (err) {
          if (isUniqueViolation(err)) {
            throw new ConflictException(
              'A requested value is already in use by another student — reject that field or ask the student to resubmit.',
            );
          }
          throw err;
        }
      }

      // Mirror approved parent/guardian contacts into the two fixed
      // student_guardians rows, inside the same transaction. Session
      // revocation for freed mobiles is deferred past this call stack —
      // best-effort, and acceptable even if the enclosing commit fails (the
      // guardian just signs in again).
      if (touchedGuardianFields) {
        const stale = await this.guardianSync.syncFromFlatFields(tx, studentId);
        if (stale.length > 0) {
          setImmediate(() => {
            void this.guardianSync.revokeStaleMobiles(stale);
          });
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
    const nextPayload: ProfileUpdatePayload = { v: 2, changes: annotated };
    return { status, payload: nextPayload };
  }

  /**
   * Attach short-lived presigned URLs to certification items so approvers and
   * the requester can open the supporting file from the detail view. View-only
   * — the URL is never persisted.
   */
  async enrichPayloadForView(
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const typed = payload as ProfileUpdatePayload;
    const changes = typed?.changes;
    if (!Array.isArray(changes)) return payload;

    const enriched = await Promise.all(
      changes.map(async (c) => {
        if (!c.field?.startsWith(CERTIFICATION_KEY_PREFIX)) return c;
        const v = c.to as CertificationValue | null;
        if (!v?.certificate_file_key) return c;
        try {
          const url = await this.storage.getCachedReadUrl(
            v.certificate_file_key,
          );
          return { ...c, to: { ...v, certificate_file_url: url } };
        } catch {
          return c;
        }
      }),
    );
    return { ...typed, changes: enriched };
  }

  decisionNotification(
    request: ApprovalRequest,
    status: DecidedStatus,
    note: string | null,
  ): { title: string; body: string } {
    const payload = request.payload as ProfileUpdatePayload;
    const changes = payload?.changes ?? [];

    // Post-commit side effect piggybacked on the (post-commit) notification
    // hook: rejected certification entries free their staged files.
    // Best-effort — deleteObject never throws.
    for (const c of changes) {
      if (
        c.outcome === 'rejected' &&
        c.field.startsWith(CERTIFICATION_KEY_PREFIX)
      ) {
        const key = (c.to as CertificationValue | null)?.certificate_file_key;
        if (key) void this.storage.deleteObject(key);
      }
    }

    const labels = (list: ProfileUpdateChange[]) =>
      list.map((c) => labelOf(c)).join(', ');
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
