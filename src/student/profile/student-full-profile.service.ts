import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Country } from '../../admin/entities/country.entity';
import { DiplomaBoard } from '../../admin/entities/diploma-board.entity';
import { District } from '../../admin/entities/district.entity';
import { EntranceExam } from '../../admin/entities/entrance-exam.entity';
import { IndustryCertification } from '../../admin/entities/industry-certification.entity';
import { SchoolBoardX } from '../../admin/entities/school-board-x.entity';
import { SchoolBoardXii } from '../../admin/entities/school-board-xii.entity';
import { State } from '../../admin/entities/state.entity';
import {
  ENTRY_TYPE_LABELS,
  EntryType,
  Student,
} from '../../admin/entities/student.entity';
import { StudentIndustryCertification } from '../../admin/entities/student-industry-certification.entity';
import { displayedAdmissionYear } from '../../common/admission-year';
import { ApprovalRequestsService } from '../../requests/approval-requests.service';
import { StorageService } from '../../storage/storage.service';
import {
  FieldPolicy,
  LookupTable,
  PROFILE_FIELD_DEFS,
  PROFILE_GROUPS,
  ProfileFieldDef,
  ProfileGroupKey,
  appliesTo,
  columnOf,
} from './profile-fields';
import type { ProfileUpdatePayload } from './profile-update-request.service';
import { ResumeView, StudentResumeService } from './student-resume.service';

export interface ProfileFieldView {
  key: string;
  label: string;
  policy: FieldPolicy;
  kind: string;
  fk: LookupTable | null;
  /** Belongs to an atomic request unit ('entrance_exam' | 'gap'), if any. */
  unit: string | null;
  /** Resolved for THIS student's entry type. */
  mandatory: boolean;
  /** The student can change it (via approval/OTP/direct, per `policy`). */
  editable: boolean;
  /** Locked by an open approval request (its key or its unit's key). */
  pending: boolean;
  value: unknown;
  /** Human-readable rendering (FK names, Yes/No); null when unset. */
  display: string | null;
}

export interface ProfileGroupView {
  key: ProfileGroupKey;
  label: string;
  order: number;
  fields: ProfileFieldView[];
}

export interface StudentFullProfile {
  entry_type: number;
  entry_type_label: string;
  student_id: string;
  programme_name: string;
  admission_year: number;
  admission_year_display: string;
  pass_out_year: number | null;
  groups: ProfileGroupView[];
  certifications: Array<{
    id: number;
    industry_certification_id: number;
    name: string;
    certificate_file_url: string | null;
    created_at: Date;
  }>;
  /** Both links (each nullable) + the download counters. Never null itself. */
  resume: ResumeView;
  personal_email: {
    value: string | null;
    pending_email: string | null;
  };
  completeness: { required: number; filled: number; missing: string[] };
}

const EDITABLE_POLICIES: FieldPolicy[] = [
  'APPROVAL',
  'AUTO_REQUESTABLE',
  'OTP_VERIFY',
  'NO_APPROVAL',
];

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

/**
 * The student's own full profile with server-driven metadata: groups and
 * fields pre-filtered to the student's entry type, each field carrying its
 * edit policy, mandatory-ness, pending-lock state, raw value and display text
 * — so all four clients render visibility/mandatory rules from ONE source
 * instead of re-implementing the policy matrix.
 */
@Injectable()
export class StudentFullProfileService {
  constructor(
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
    private readonly approvalRequests: ApprovalRequestsService,
    private readonly resumes: StudentResumeService,
    private readonly storage: StorageService,
  ) {}

  async me(studentId: number): Promise<StudentFullProfile> {
    const s = await this.students.findOne({ where: { id: studentId } });
    if (!s) throw new NotFoundException('Student not found');

    const [open, held] = await Promise.all([
      this.approvalRequests.openRequests(studentId, 'profile_update'),
      this.students.manager.getRepository(StudentIndustryCertification).find({
        where: { student_id: studentId },
        relations: { industry_certification: true },
        order: { id: 'ASC' },
      }),
    ]);

    // Item keys claimed by open requests — a field is "pending" when its own
    // key OR its unit's key is claimed.
    const pendingKeys = new Set<string>();
    for (const r of open) {
      const payload = r.payload as ProfileUpdatePayload;
      for (const c of payload?.changes ?? []) pendingKeys.add(c.field);
    }

    // Resolve FK display names in one query per lookup table.
    const wanted = new Map<LookupTable, Set<number>>();
    for (const def of PROFILE_FIELD_DEFS) {
      if (def.kind !== 'fk' || !def.fk) continue;
      const col = columnOf(def);
      if (!col) continue;
      const v = s[col];
      if (v !== null && v !== undefined) {
        if (!wanted.has(def.fk)) wanted.set(def.fk, new Set());
        wanted.get(def.fk)!.add(Number(v));
      }
    }
    const lookups = new Map<LookupTable, Map<number, string>>();
    for (const [table, ids] of wanted) {
      const rows = await this.students.manager
        .getRepository<LookupRow>(LOOKUP_ENTITY[table])
        .find({ where: { id: In([...ids]) } });
      lookups.set(table, new Map(rows.map((r) => [r.id, r.name])));
    }

    const fieldView = (def: ProfileFieldDef): ProfileFieldView => {
      const col = columnOf(def);
      let value: unknown =
        def.key === 'admission_year'
          ? s.admission_year.year
          : col
            ? s[col]
            : null;
      // Either source counts — a hosted file or an external link.
      if (def.key === 'resume')
        value = s.resume_key !== null || s.resume_external_url !== null;
      if (def.key === 'industry_certifications') value = held.length;

      let display: string | null = null;
      if (value !== null && value !== undefined && value !== '') {
        // Field values here are scalars by construction.
        const scalar = value as string | number;
        if (def.kind === 'boolean') display = value ? 'Yes' : 'No';
        else if (def.kind === 'fk' && def.fk) {
          display = lookups.get(def.fk)?.get(Number(value)) ?? `#${scalar}`;
        } else display = String(scalar);
      }

      return {
        key: def.key,
        label: def.label,
        policy: def.policy,
        kind: def.kind,
        fk: def.fk ?? null,
        unit: def.unit ?? null,
        mandatory: appliesTo(def.mandatory, s.entry_type),
        editable: EDITABLE_POLICIES.includes(def.policy),
        pending: pendingKeys.has(def.key) || pendingKeys.has(def.unit ?? ''),
        value: value ?? null,
        display,
      };
    };

    const groups: ProfileGroupView[] = PROFILE_GROUPS.filter((g) =>
      appliesTo(g.visible, s.entry_type),
    )
      .map((g) => ({
        key: g.key,
        label: g.label,
        order: g.order,
        fields: PROFILE_FIELD_DEFS.filter(
          (d) => d.group === g.key && appliesTo(d.visible, s.entry_type),
        ).map(fieldView),
      }))
      .filter((g) => g.fields.length > 0);

    // Completeness over mandatory-for-this-entry-type fields. The entrance
    // unit counts as filled when marked N/A; gap counts once a year (even 0)
    // is recorded; reason only when a gap exists. backlog_history always has
    // a value (boolean default) and auto fields count when computed.
    const allFields = groups.flatMap((g) => g.fields);
    const missing: string[] = [];
    let required = 0;
    for (const f of allFields) {
      if (!f.mandatory) continue;
      // The repeatable certifications pseudo-field is never mandatory; resume
      // "value" is a boolean has-file flag.
      required += 1;
      let filled: boolean;
      if (f.key === 'entrance_exam' || f.key === 'entrance_exam_rank') {
        filled = s.entrance_exam_na || f.value !== null;
      } else if (f.key === 'entrance_exam_year') {
        filled = s.entrance_exam_na || f.value !== null;
      } else if (f.key === 'reason_of_gap') {
        filled = (s.year_of_gap ?? 0) === 0 || f.value !== null;
      } else if (f.key === 'backlog_history') {
        filled = true;
      } else if (f.key === 'resume') {
        filled = f.value === true;
      } else {
        filled = f.value !== null && f.value !== '';
      }
      if (!filled) missing.push(f.key);
    }

    const certifications = await Promise.all(
      held.map(async (h) => ({
        id: h.id,
        industry_certification_id: h.industry_certification_id,
        name: h.industry_certification?.name ?? '—',
        certificate_file_url: h.certificate_file_key
          ? await this.storage
              .getCachedReadUrl(h.certificate_file_key)
              .catch(() => null)
          : null,
        created_at: h.created_at,
      })),
    );

    return {
      entry_type: s.entry_type,
      entry_type_label:
        ENTRY_TYPE_LABELS[s.entry_type as EntryType] ?? String(s.entry_type),
      student_id: s.student_id,
      programme_name: s.programme?.name ?? '—',
      admission_year: s.admission_year.year,
      admission_year_display: displayedAdmissionYear(
        s.admission_year.display_year,
        s.entry_type,
      ),
      pass_out_year: s.pass_out_year,
      groups,
      certifications,
      resume: await this.resumes.viewFor(s),
      personal_email: {
        value: s.personal_email,
        pending_email: s.personal_email_pending,
      },
      completeness: {
        required,
        filled: required - missing.length,
        missing,
      },
    };
  }
}
