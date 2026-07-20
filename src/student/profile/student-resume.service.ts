import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Student } from '../../admin/entities/student.entity';

/** The student's single resume link. Null until they set one. */
export interface ResumeView {
  external_url: string | null;
}

/**
 * Student resume — the NO_APPROVAL field: saved directly, no approver.
 *
 * A resume is ONE externally-hosted link (Drive, personal site, …) supplied by
 * the student. We store the URL and hand it out raw, never proxied: hosting is
 * the student's problem, and a link routed through us would die with our API.
 *
 * Shared by the student self-service routes and the admin routes.
 */
@Injectable()
export class StudentResumeService {
  constructor(
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
  ) {}

  viewFor(student: Student): ResumeView {
    return { external_url: student.resume_external_url };
  }

  /** Set (or clear with null) the resume link. */
  async setExternalUrl(
    studentId: number,
    url: string | null,
  ): Promise<ResumeView> {
    const student = await this.students.findOne({ where: { id: studentId } });
    if (!student) throw new NotFoundException('Student not found');

    student.resume_external_url = url;
    await this.students.save(student);
    return this.viewFor(student);
  }
}
