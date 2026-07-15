import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Student } from '../../admin/entities/student.entity';
import { processStudentPhoto } from '../../common/photo-processing';
import { StorageService } from '../../storage/storage.service';
import { storageKey } from '../../storage/storage.constants';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Self-service profile photo for students. Replaces the same `photo_key` the
 * admin upload writes, so the one photo shows everywhere (ID card, profile,
 * peer chat). Uploads are normalized server-side (square 800×800 WebP, EXIF
 * stripped) regardless of what the client sends.
 */
@Injectable()
export class StudentPhotoService {
  constructor(
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
    private readonly storage: StorageService,
  ) {}

  /**
   * Compress + store the photo under a fresh random key (never derivable from
   * the roll number), point the student at it, then best-effort delete the
   * previous object. Returns a presigned URL so the client can render the new
   * photo immediately without refetching the profile.
   */
  async setPhoto(
    studentId: number,
    file: { buffer: Buffer; mimetype: string },
  ): Promise<{ photo_url: string }> {
    const student = await this.students.findOne({ where: { id: studentId } });
    if (!student) throw new UnauthorizedException();

    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException(
        'Unsupported image type. Use JPEG, PNG, or WebP.',
      );
    }

    const processed = await processStudentPhoto(file.buffer);

    const previousKey = student.photo_key;
    const key = storageKey.studentPhoto(processed.ext);
    await this.storage.putObject(key, processed.buffer, processed.contentType);

    student.photo_key = key;
    await this.students.save(student);

    if (previousKey && previousKey !== key) {
      await this.storage.deleteObject(previousKey);
    }

    // Cached (~12h-stable) URL — the same URL /me and the list endpoints will
    // hand out for this fresh key, so the client caches warm immediately.
    return { photo_url: await this.storage.getCachedReadUrl(key) };
  }

  /** Remove the caller's photo (reference first, then best-effort object). */
  async removePhoto(studentId: number): Promise<void> {
    const student = await this.students.findOne({ where: { id: studentId } });
    if (!student) throw new UnauthorizedException();

    const key = student.photo_key;
    if (!key) return;

    student.photo_key = null;
    await this.students.save(student);
    await this.storage.deleteObject(key);
  }
}
