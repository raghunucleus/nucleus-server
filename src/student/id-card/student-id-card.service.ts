import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InstitutionSetting } from '../../admin/entities/institution-setting.entity';
import { ProgrammeSemester } from '../../admin/entities/programme-semester.entity';
import { StudentGroup } from '../../admin/entities/student-group.entity';
import { Student } from '../../admin/entities/student.entity';
import { StorageService } from '../../storage/storage.service';

/** Claims embedded in the QR token. Verified later by the employee app. */
export interface IdCardQrPayload {
  sub: number; // students.id
  sid: string; // roll number
  name: string;
  typ: 'id-card';
}

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
  // Signed JWT rendered as the QR payload. Verifiable by the employee app.
  qr_token: string;
  // ISO date the card is valid until (expected graduation), or null.
  valid_until: string | null;
}

// Presigned photo URLs live just long enough to render the card. A leaked URL
// self-expires well before it's useful to anyone.
const PHOTO_URL_TTL_SECONDS = 15 * 60;

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
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
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

    const [semester, section, institution, photoUrl, qrToken] =
      await Promise.all([
        this.findCurrentSemester(student),
        this.findSection(studentId),
        this.getInstitution(),
        this.resolvePhotoUrl(student.photo_key),
        this.signQr(student),
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
        ? { display_year: student.admission_year.display_year }
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
      qr_token: qrToken,
      valid_until: this.computeValidUntil(student),
    };
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
    return this.storage.getSignedReadUrl(key, PHOTO_URL_TTL_SECONDS);
  }

  private signQr(student: Student): Promise<string> {
    const payload: IdCardQrPayload = {
      sub: student.id,
      sid: student.student_id,
      name: student.display_name,
      typ: 'id-card',
    };
    return this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_ID_CARD_SECRET'),
      expiresIn: parseDurationToSeconds(
        this.config.get<string>('JWT_ID_CARD_TTL', '365d'),
      ),
    });
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

/** Parse a "15m" / "7d" / "365d" duration string into seconds. */
function parseDurationToSeconds(input: string): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(input.trim());
  if (!match) return 365 * 24 * 60 * 60;
  const n = Number(match[1]);
  const unit = match[2] ?? 's';
  const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return n * mult[unit];
}
