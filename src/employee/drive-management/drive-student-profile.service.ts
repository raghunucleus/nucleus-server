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
import { StorageService } from '../../storage/storage.service';
import {
  LookupTable,
  PROFILE_FIELD_DEFS,
  PROFILE_GROUPS,
  ProfileFieldDef,
  ProfileGroupKey,
  appliesTo,
  columnOf,
} from '../../student/profile/profile-fields';

export interface EmployeeProfileField {
  key: string;
  label: string;
  kind: string;
  value: unknown;
  /** Human-readable rendering (FK names, Yes/No); null when unset. */
  display: string | null;
}

export interface EmployeeProfileGroup {
  key: ProfileGroupKey;
  label: string;
  order: number;
  fields: EmployeeProfileField[];
}

export interface DriveStudentProfile {
  student: {
    id: number;
    roll_no: string;
    display_name: string;
    programme: string | null;
    entry_type: number;
    entry_type_label: string;
    admission_year: number;
    admission_year_display: string;
    pass_out_year: number | null;
  };
  groups: EmployeeProfileGroup[];
  certifications: Array<{
    id: number;
    name: string;
    certificate_file_url: string | null;
    created_at: Date;
  }>;
  resume: {
    url: string | null;
    external_url: string | null;
    uploaded_at: Date | null;
  };
}

/** Government-ID group is never shown to employees on the drive surfaces. */
const EXCLUDED_GROUPS: ProfileGroupKey[] = ['gov_ids'];

/** Pseudo-fields surfaced as dedicated payload sections, not group rows. */
const EXCLUDED_FIELD_KEYS = ['resume', 'industry_certifications'];

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
 * The employee-facing full-profile read used by the drive Students tab's
 * detail sheet. Reuses the profile-fields registry (groups pre-filtered to the
 * student's entry type, FK values resolved to names) but strips the
 * student-only metadata — edit policies, pending locks, completeness — and the
 * government-ID group.
 *
 * Deliberately does NOT reuse `StudentFullProfileService`: importing
 * `StudentModule` here would close the cycle DriveManagementModule ←
 * StudentPlacementsModule ← StudentModule. Only the pure registry module is
 * shared.
 */
@Injectable()
export class DriveStudentProfileService {
  constructor(
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
    private readonly storage: StorageService,
  ) {}

  async getProfile(studentId: number): Promise<DriveStudentProfile> {
    const s = await this.students.findOne({ where: { id: studentId } });
    if (!s) throw new NotFoundException('Student not found');

    const held = await this.students.manager
      .getRepository(StudentIndustryCertification)
      .find({
        where: { student_id: studentId },
        relations: { industry_certification: true },
        order: { id: 'ASC' },
      });

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

    const fieldView = (def: ProfileFieldDef): EmployeeProfileField => {
      const col = columnOf(def);
      const value: unknown =
        def.key === 'admission_year'
          ? s.admission_year.year
          : col
            ? s[col]
            : null;

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
        kind: def.kind,
        value: value ?? null,
        display,
      };
    };

    const groups: EmployeeProfileGroup[] = PROFILE_GROUPS.filter(
      (g) =>
        !EXCLUDED_GROUPS.includes(g.key) && appliesTo(g.visible, s.entry_type),
    )
      .map((g) => ({
        key: g.key,
        label: g.label,
        order: g.order,
        fields: PROFILE_FIELD_DEFS.filter(
          (d) =>
            d.group === g.key &&
            !EXCLUDED_FIELD_KEYS.includes(d.key) &&
            appliesTo(d.visible, s.entry_type),
        ).map(fieldView),
      }))
      .filter((g) => g.fields.length > 0);

    const certifications = await Promise.all(
      held.map(async (h) => ({
        id: h.id,
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
      student: {
        id: s.id,
        roll_no: s.student_id,
        display_name: s.display_name,
        programme: s.programme?.display_name || s.programme?.name || null,
        entry_type: s.entry_type,
        entry_type_label:
          ENTRY_TYPE_LABELS[s.entry_type as EntryType] ?? String(s.entry_type),
        admission_year: s.admission_year.year,
        admission_year_display: displayedAdmissionYear(
          s.admission_year.display_year,
          s.entry_type,
        ),
        pass_out_year: s.pass_out_year,
      },
      groups,
      certifications,
      resume: {
        url: s.resume_key
          ? await this.storage.getCachedReadUrl(s.resume_key).catch(() => null)
          : null,
        external_url: s.resume_external_url,
        uploaded_at: s.resume_uploaded_at,
      },
    };
  }
}
