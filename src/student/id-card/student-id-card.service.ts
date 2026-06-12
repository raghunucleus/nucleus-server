import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InstitutionSetting } from '../../admin/entities/institution-setting.entity';
import { ProgrammeSemester } from '../../admin/entities/programme-semester.entity';
import { StudentGroup } from '../../admin/entities/student-group.entity';
import { Student } from '../../admin/entities/student.entity';
import { SecurityPassResponse } from '../../common/security-pass';
import { displayedAdmissionYear } from '../../common/admission-year';
import { SecurityPassService } from '../../security-pass/security-pass.service';
import { StorageService } from '../../storage/storage.service';

export interface IdCardResult {
  student: {
    display_name: string;
    student_id: string;
    gender: string;
    dob: string;
    blood_group: string | null;
    mobile_number: string;
    email: string;
    // Short-lived presigned URL, or null when there is no photo / the object is
    // missing. Clients additionally guard with an onError fallback to initials.
    photo_url: string | null;
  };
  programme: { name: string; code: string } | null;
  department: { short_name: string } | null;
  admission_year: { display_year: string } | null;
  semester: { roman_format: string; sem_number: number } | null;
  section: { code: string } | null;
  institution: {
    name: string;
    short_name: string | null;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    logo_url: string | null;
    affiliation_code: string | null;
    aicte_code: string | null;
    naac_grade: string | null;
    card_footer_note: string | null;
  };
  // Single-use, short-lived security pass rendered as the QR. Verified by the
  // security app; rotated by the client on expiry (see ttl_seconds).
  qr_token: string;
  // Seconds the qr_token is valid for — drives the client countdown.
  ttl_seconds: number;
  // ISO timestamp the qr_token expires at.
  expires_at: string;
  // ISO date the card itself is valid until (expected graduation), or null.
  // Distinct from the short-lived qr_token.
  valid_until: string | null;
}

@Injectable()
export class StudentIdCardService {
  constructor(
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
    @InjectRepository(ProgrammeSemester)
    private readonly programmeSemesters: Repository<ProgrammeSemester>,
    @InjectRepository(StudentGroup)
    private readonly studentGroups: Repository<StudentGroup>,
    @InjectRepository(InstitutionSetting)
    private readonly institutionSettings: Repository<InstitutionSetting>,
    private readonly storage: StorageService,
    private readonly pass: SecurityPassService,
  ) {}

  /**
   * Build the ID card for the signed-in student. The student id comes from the
   * controller (JWT), never from the request — a student only ever gets their
   * own card.
   */
  async getCard(studentId: number): Promise<IdCardResult> {
    // Student eager-loads programme (→ degree, department) and admission_year.
    const student = await this.students.findOne({ where: { id: studentId } });
    if (!student) throw new NotFoundException('Student not found');

    const [semester, section, institution, photoUrl, pass] = await Promise.all([
      this.findCurrentSemester(student),
      this.findSection(studentId),
      this.getInstitution(),
      this.resolvePhotoUrl(student.photo_key),
      this.pass.issue('student', student.id, student.student_id),
    ]);

    return {
      student: {
        display_name: student.display_name,
        student_id: student.student_id,
        gender: student.gender,
        dob: student.dob,
        blood_group: student.blood_group,
        mobile_number: student.mobile_number,
        email: student.email,
        photo_url: photoUrl,
      },
      programme: student.programme
        ? { name: student.programme.name, code: student.programme.code }
        : null,
      department: student.programme?.department
        ? { short_name: student.programme.department.short_name }
        : null,
      admission_year: student.admission_year
        ? {
            // Lateral entrants display their joining year (+1, tagged); view-only.
            display_year: displayedAdmissionYear(
              student.admission_year.display_year,
              student.entry_type,
            ),
          }
        : null,
      semester,
      section,
      institution: {
        name: institution.name,
        short_name: institution.short_name,
        address_line1: institution.address_line1,
        address_line2: institution.address_line2,
        city: institution.city,
        state: institution.state,
        pincode: institution.pincode,
        logo_url: institution.logo_url,
        affiliation_code: institution.affiliation_code,
        aicte_code: institution.aicte_code,
        naac_grade: institution.naac_grade,
        card_footer_note: institution.card_footer_note,
      },
      qr_token: pass.qr_token,
      ttl_seconds: pass.ttl_seconds,
      expires_at: pass.expires_at,
      valid_until: this.computeValidUntil(student),
    };
  }

  /**
   * Issue just a fresh security pass for the signed-in student. Backs the
   * lightweight `/student/id-card/pass` endpoint the client polls to rotate the
   * QR without re-fetching the whole card (photo presign, semester, etc.).
   */
  async issuePass(studentId: number): Promise<SecurityPassResponse> {
    const student = await this.students.findOne({
      where: { id: studentId },
      select: { id: true, student_id: true },
    });
    if (!student) throw new NotFoundException('Student not found');
    return this.pass.issue('student', student.id, student.student_id);
  }

  /**
   * Current ongoing semester for the student's batch. Mirrors
   * StudentPortalService.findCurrentPs but returns null instead of throwing —
   * a batch with no active semester yet must not break the ID card.
   */
  private async findCurrentSemester(
    student: Student,
  ): Promise<IdCardResult['semester']> {
    const ps = await this.programmeSemesters
      .createQueryBuilder('ps')
      .leftJoinAndSelect('ps.semester', 'semester')
      .where('ps.programme_id = :pid', { pid: student.programme_id })
      .andWhere('ps.admission_year_id = :ayid', {
        ayid: student.admission_year_id,
      })
      .andWhere('ps.is_active = TRUE')
      .orderBy(
        `CASE WHEN ps.status = 'ongoing' THEN 0 WHEN ps.status = 'completed' THEN 1 ELSE 2 END`,
        'ASC',
      )
      .addOrderBy('ps.updated_at', 'DESC')
      .getOne();
    if (!ps?.semester) return null;
    return {
      roman_format: ps.semester.roman_format,
      sem_number: ps.semester.sem_number,
    };
  }

  /** The student's attendance-group code (section), or null if unassigned. */
  private async findSection(
    studentId: number,
  ): Promise<IdCardResult['section']> {
    const row = await this.studentGroups
      .createQueryBuilder('sg')
      .leftJoin('sg.attendance_group', 'ag')
      .select('ag.code', 'code')
      .where('sg.student_id = :sid', { sid: studentId })
      .andWhere('ag.id IS NOT NULL')
      .getRawOne<{ code: string }>();
    return row?.code ? { code: row.code } : null;
  }

  private async getInstitution(): Promise<InstitutionSetting> {
    const existing = await this.institutionSettings.findOne({
      where: { id: 1 },
    });
    if (existing) return existing;
    // Never seeded (fresh DB without the migration seed) — return a safe shell
    // so the card still renders.
    return this.institutionSettings.create({ id: 1, name: 'Institution' });
  }

  /**
   * Resolve a short-lived presigned URL for the photo. Returns null when there
   * is no key OR the object is missing — so a dangling reference degrades to
   * the initials avatar instead of a broken image. The HEAD probe is metadata
   * only; the API never streams the bytes.
   */
  private async resolvePhotoUrl(key: string | null): Promise<string | null> {
    if (!key) return null;
    const exists = await this.storage.objectExists(key);
    if (!exists) return null;
    // Cached ~12h URL — the same URL /me and the chat lists return for this
    // key, so the card photo is usually already in the device image cache.
    return this.storage.getCachedReadUrl(key);
  }

  /**
   * Expected graduation: admission year + the degree's duration. Used as the
   * card's validity. Null when we can't determine the duration.
   */
  private computeValidUntil(student: Student): string | null {
    const startYear = student.admission_year?.year;
    const durationYears = student.programme?.degree?.duration_years;
    if (!startYear || !durationYears) return null;
    return `${startYear + durationYears}-07-31`;
  }
}
