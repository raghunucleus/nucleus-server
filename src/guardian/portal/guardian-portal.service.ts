import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { displayedAdmissionYear } from '../../common/admission-year';
import { StudentGuardian } from '../entities/student-guardian.entity';

/** A student a parent (mobile number) is linked to, for the child selector. */
export interface LinkedStudent {
  id: number;
  student_id: string;
  display_name: string;
  relationship: string;
  is_primary: boolean;
  is_active: boolean;
  programme: { id: number; name: string; code: string } | null;
  admission_year: { id: number; year: number; display_year: string } | null;
}

@Injectable()
export class GuardianPortalService {
  constructor(
    @InjectRepository(StudentGuardian)
    private readonly contacts: Repository<StudentGuardian>,
  ) {}

  /**
   * The active students reachable by a mobile number — every `student_guardians`
   * row with that mobile whose student is active. Deduped by student (a mobile
   * could be both, say, father and guardian on the same student); the first
   * relationship is kept.
   */
  async listStudents(mobile: string): Promise<LinkedStudent[]> {
    const rows = await this.contacts
      .createQueryBuilder('sg')
      .innerJoinAndSelect('sg.student', 's')
      .leftJoinAndSelect('s.programme', 'programme')
      .leftJoinAndSelect('s.admission_year', 'admission_year')
      .where('sg.mobile_number = :mobile', { mobile })
      .andWhere('s.is_active = TRUE')
      .orderBy('sg.is_primary', 'DESC')
      .addOrderBy('s.display_name', 'ASC')
      .getMany();

    const byStudent = new Map<number, LinkedStudent>();
    for (const sg of rows) {
      if (byStudent.has(sg.student.id)) continue;
      byStudent.set(sg.student.id, {
        id: sg.student.id,
        student_id: sg.student.student_id,
        display_name: sg.student.display_name,
        relationship: sg.relationship,
        is_primary: sg.is_primary,
        is_active: sg.student.is_active,
        programme: sg.student.programme
          ? {
              id: sg.student.programme.id,
              name: sg.student.programme.name,
              code: sg.student.programme.code,
            }
          : null,
        admission_year: sg.student.admission_year
          ? {
              id: sg.student.admission_year.id,
              year: sg.student.admission_year.year,
              // Lateral entrants display their joining year (+1, tagged); view-only.
              display_year: displayedAdmissionYear(
                sg.student.admission_year.display_year,
                sg.student.entry_type,
              ),
            }
          : null,
      });
    }
    return [...byStudent.values()];
  }

  /** Throw unless the mobile is a contact for the (active) student. */
  async assertLinked(mobile: string, studentId: number): Promise<void> {
    const link = await this.contacts
      .createQueryBuilder('sg')
      .innerJoin('sg.student', 's')
      .where('sg.mobile_number = :mobile', { mobile })
      .andWhere('sg.student_id = :sid', { sid: studentId })
      .andWhere('s.is_active = TRUE')
      .getOne();
    if (!link) {
      throw new ForbiddenException('You do not have access to this student.');
    }
  }

  /** True if the mobile appears as any guardian contact. */
  async hasAnyContact(mobile: string): Promise<boolean> {
    const count = await this.contacts.count({
      where: { mobile_number: mobile },
    });
    return count > 0;
  }

  /** A display name for the mobile (primary contact's name, else any). */
  async getDisplayName(mobile: string): Promise<string | null> {
    const row = await this.contacts
      .createQueryBuilder('sg')
      .where('sg.mobile_number = :mobile', { mobile })
      .orderBy('sg.is_primary', 'DESC')
      .addOrderBy('sg.id', 'ASC')
      .getOne();
    return row?.name ?? null;
  }

  /** The first non-null email recorded for this mobile, for OTP delivery. */
  async getEmail(mobile: string): Promise<string | null> {
    const row = await this.contacts
      .createQueryBuilder('sg')
      .where('sg.mobile_number = :mobile', { mobile })
      .andWhere('sg.email IS NOT NULL')
      .orderBy('sg.is_primary', 'DESC')
      .addOrderBy('sg.id', 'ASC')
      .getOne();
    return row?.email ?? null;
  }
}
