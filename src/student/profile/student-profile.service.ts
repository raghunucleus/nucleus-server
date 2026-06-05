import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Student } from '../../admin/entities/student.entity';
import {
  HideableProfileField,
  JSONB_HIDEABLE_FIELDS,
} from '../../common/profile-privacy';

const JSONB_HIDEABLE = new Set<string>(JSONB_HIDEABLE_FIELDS);

/** The acting student's profile-privacy choices, as a flat list of hidden keys. */
export interface ProfilePrivacy {
  /** Personal fields hidden from peers. Empty = everything visible. */
  hidden: HideableProfileField[];
}

@Injectable()
export class StudentProfileService {
  constructor(
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
  ) {}

  /**
   * Merge the three storage sites into the flat `hidden` list the API exposes:
   * `hidden_profile_fields` (jsonb) plus `birthday`/`mobile` from their columns.
   */
  async getPrivacy(studentId: number): Promise<ProfilePrivacy> {
    const student = await this.students.findOne({
      where: { id: studentId },
      select: {
        id: true,
        birthday_hidden: true,
        mobile_hidden: true,
        hidden_profile_fields: true,
      },
    });
    if (!student) throw new NotFoundException('Student not found');
    return { hidden: this.toHidden(student) };
  }

  /**
   * Persist the student's choices, splitting the flat list across the jsonb
   * array and the two boolean columns. The input is already validated to the
   * canonical key set by the DTO.
   */
  async updatePrivacy(
    studentId: number,
    hidden: HideableProfileField[],
  ): Promise<ProfilePrivacy> {
    const set = new Set<string>(hidden);
    const jsonb = JSONB_HIDEABLE_FIELDS.filter((f) => set.has(f));
    const patch = {
      birthday_hidden: set.has('birthday'),
      mobile_hidden: set.has('mobile'),
      hidden_profile_fields: jsonb,
    };
    const result = await this.students.update(studentId, patch);
    if (!result.affected) throw new NotFoundException('Student not found');
    return { hidden: this.toHidden(patch) };
  }

  private toHidden(s: {
    birthday_hidden: boolean;
    mobile_hidden: boolean;
    hidden_profile_fields: string[];
  }): HideableProfileField[] {
    // jsonb holds only the visible-by-default fields; birthday + mobile come
    // from their own columns (mobile is hidden by default).
    const hidden = (s.hidden_profile_fields ?? []).filter((k) =>
      JSONB_HIDEABLE.has(k),
    ) as HideableProfileField[];
    if (s.birthday_hidden) hidden.push('birthday');
    if (s.mobile_hidden) hidden.push('mobile');
    return hidden;
  }
}
