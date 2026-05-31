import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Largest number of rows accepted in a single chunk (not a per-sheet cap). */
export const CHUNK_MAX_ROWS = 20000;

/**
 * One parsed grade-sheet row, every cell a string. The client parses the
 * `.xlsx` and streams rows in chunks; every cell is a string so semantic
 * problems (bad grade, non-numeric credits, unparseable examination, HT No
 * outside the batch) surface as per-cell row errors rather than a 400. All
 * grading/semantic validation happens server-side.
 */
export const UploadMarksRowSchema = z.object({
  examination: z.string().trim().max(64),
  exam_date: z.string().trim().max(32),
  roll_number: z.string().trim().max(32),
  subject_code: z.string().trim().max(32),
  subject_name: z.string().trim().max(128),
  credits: z.string().trim().max(16),
  grade: z.string().trim().max(8),
  grade_points: z.string().trim().max(16),
});

/** Open an upload session for a batch. */
export const StartUploadSchema = z.object({
  programme_admission_year_id: z.coerce.number().int().positive(),
});

export class StartUploadDto extends createZodDto(StartUploadSchema) {}

/** Stream one chunk of rows into a session. `offset` is the 0-based index of
 *  this chunk's first row within the whole sheet (for error mapping). */
export const ChunkUploadSchema = z.object({
  programme_admission_year_id: z.coerce.number().int().positive(),
  upload_session: z.string().uuid(),
  offset: z.coerce.number().int().min(0),
  rows: z.array(UploadMarksRowSchema).min(1).max(CHUNK_MAX_ROWS),
});

export class ChunkUploadDto extends createZodDto(ChunkUploadSchema) {}

/** Identify a session for preview / commit / detail. */
export const SessionQuerySchema = z.object({
  programme_admission_year_id: z.coerce.number().int().positive(),
  upload_session: z.string().uuid(),
});

export class SessionQueryDto extends createZodDto(SessionQuerySchema) {}

/** Commit a staged session. `notify` (default true) pushes a "results
 *  published" notification to every student whose results were stored. */
export const CommitUploadSchema = SessionQuerySchema.extend({
  notify: z.coerce.boolean().default(true),
});
export class CommitUploadDto extends createZodDto(CommitUploadSchema) {}

/** Query for the batch results list (`GET /results`). */
export const ResultsQuerySchema = z.object({
  programme_admission_year_id: z.coerce.number().int().positive(),
});

export class ResultsQueryDto extends createZodDto(ResultsQuerySchema) {}

/** Query for one student's stored results (`GET /students/:id/results`). */
export const StudentResultsQuerySchema = z.object({
  programme_admission_year_id: z.coerce.number().int().positive(),
  include: z.enum(['best', 'all']).default('best'),
});

export class StudentResultsQueryDto extends createZodDto(
  StudentResultsQuerySchema,
) {}
