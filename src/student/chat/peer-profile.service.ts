import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProgrammeSemester } from '../../admin/entities/programme-semester.entity';
import { Student } from '../../admin/entities/student.entity';
import { StudentGroup } from '../../admin/entities/student-group.entity';
import { displayedAdmissionYear } from '../../common/admission-year';
import { StorageService } from '../../storage/storage.service';
import { ChatService } from './chat.service';

/**
 * A classmate's profile as shown to a peer who taps them in chat. Deliberately
 * limited: the caller may only ever fetch this for someone in their own
 * attendance group (enforced via {@link ChatService.resolveSharedGroup}), and
 * the birthday is exposed as day/month only — never the birth year (same
 * precedent as the classmate birthdays feature).
 */
export interface PeerProfile {
  id: number;
  student_id: string;
  display_name: string;
  gender: string;
  /** Day + month of birth only — the year is never exposed to a peer. */
  birthday: { day: number; month: number } | null;
  blood_group: string | null;
  mobile_number: string;
  email: string;
  /** Short-lived presigned URL, or null when there's no photo / it's missing. */
  photo_url: string | null;
  programme: { name: string; code: string } | null;
  department: { short_name: string } | null;
  admission_year: { display_year: string } | null;
  semester: { roman_format: string; sem_number: number } | null;
  section: { code: string } | null;
}

// Presigned photo URLs live just long enough to render the profile. Mirrors the
// ID-card TTL — a leaked URL self-expires well before it's useful to anyone.
const PHOTO_URL_TTL_SECONDS = 15 * 60;

@Injectable()
export class PeerProfileService {
  constructor(
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
    @InjectRepository(ProgrammeSemester)
    private readonly programmeSemesters: Repository<ProgrammeSemester>,
    @InjectRepository(StudentGroup)
    private readonly studentGroups: Repository<StudentGroup>,
    private readonly storage: StorageService,
    private readonly chat: ChatService,
  ) {}

  /**
   * The viewable profile of `studentId` for the acting student `meId`. Both ids
   * are real student ids; `meId` comes from the JWT and `studentId` is the peer
   * the caller tapped. Throws 403 unless the two share an attendance group (and
   * rejects `meId === studentId`), 404 if the target is missing or deactivated.
   */
  async getProfile(meId: number, studentId: number): Promise<PeerProfile> {
    // Single authz chokepoint: same-attendance-group (or throw). Also rejects
    // fetching your own id — self-profile is a separate, fuller surface.
    await this.chat.resolveSharedGroup(meId, studentId);

    // Student eager-loads programme (→ department) and admission_year.
    const student = await this.students.findOne({ where: { id: studentId } });
    if (!student || !student.is_active) {
      throw new NotFoundException('Student not found');
    }

    const [semester, section, photoUrl] = await Promise.all([
      this.findCurrentSemester(student),
      this.findSection(studentId),
      this.resolvePhotoUrl(student.photo_key),
    ]);

    return {
      id: student.id,
      student_id: student.student_id,
      display_name: student.display_name,
      gender: student.gender,
      birthday: this.dayMonth(student.dob),
      blood_group: student.blood_group,
      mobile_number: student.mobile_number,
      email: student.email,
      photo_url: photoUrl,
      programme: student.programme
        ? { name: student.programme.name, code: student.programme.code }
        : null,
      department: student.programme?.department
        ? { short_name: student.programme.department.short_name }
        : null,
      admission_year: student.admission_year
        ? {
            // Lateral entrants display their joining year (+1); view-only.
            display_year: displayedAdmissionYear(
              student.admission_year.display_year,
              student.entry_type,
            ),
          }
        : null,
      semester,
      section,
    };
  }

  /**
   * Day + month of the student's DOB, year stripped. Returns null for a missing
   * or unparseable date so the client simply omits the birthday line.
   */
  private dayMonth(dob: string | null): PeerProfile['birthday'] {
    if (!dob) return null;
    // `dob` is a DATE column stored as 'YYYY-MM-DD' — parse the parts directly
    // to avoid any timezone shift a Date() round-trip could introduce.
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob);
    if (!m) return null;
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (!month || !day) return null;
    return { day, month };
  }

  /**
   * Current ongoing semester for the student's batch. Mirrors
   * StudentIdCardService.findCurrentSemester — returns null instead of throwing
   * so a batch with no active semester yet doesn't break the profile.
   */
  private async findCurrentSemester(
    student: Student,
  ): Promise<PeerProfile['semester']> {
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
  ): Promise<PeerProfile['section']> {
    const row = await this.studentGroups
      .createQueryBuilder('sg')
      .leftJoin('sg.attendance_group', 'ag')
      .select('ag.code', 'code')
      .where('sg.student_id = :sid', { sid: studentId })
      .andWhere('ag.id IS NOT NULL')
      .getRawOne<{ code: string }>();
    return row?.code ? { code: row.code } : null;
  }

  /**
   * Resolve a short-lived presigned URL for the photo. Returns null when there
   * is no key OR the object is missing — so a dangling reference degrades to the
   * initials avatar instead of a broken image. The HEAD probe is metadata only.
   */
  private async resolvePhotoUrl(key: string | null): Promise<string | null> {
    if (!key) return null;
    const exists = await this.storage.objectExists(key);
    if (!exists) return null;
    return this.storage.getSignedReadUrl(key, PHOTO_URL_TTL_SECONDS);
  }
}
