import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/**
 * The master list of graduating ("passout") years, managed from the Company
 * Attributes screen alongside the company category lookup.
 *
 * A row is a year plus the academic window it spans: `display_year` is always
 * derived from `passout_year` (2026 → "2025-2026") and is never accepted from a
 * client, while the two dates default to Jan 1 of the previous year and Dec 31
 * of the passout year but stay editable — an institution can shift its window
 * without losing the label.
 *
 * NOTE: this table is standalone today. The RBAC `ref:passout_year` attribute
 * and `drive_eligibility.passout_years` both store the BARE year, not a row id
 * from here, so `id` is not interchangeable with either.
 */
@Entity({ name: 'passout_years' })
@Unique('UQ_passout_years_passout_year', ['passout_year'])
export class PassoutYear {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  passout_year: number;

  /** Derived from {@link passout_year} — see {@link deriveDisplayYear}. */
  @Column({ type: 'varchar', length: 16 })
  display_year: string;

  // `date` columns are typed as strings on purpose: TypeORM hands back
  // 'YYYY-MM-DD', which is what an <input type="date"> speaks, and no Date
  // round-trip means no timezone drift.
  @Column({ type: 'date' })
  start_date: string;

  @Column({ type: 'date' })
  end_date: string;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

/** 2026 → "2025-2026". */
export const deriveDisplayYear = (year: number): string =>
  `${year - 1}-${year}`;

/** 2026 → "2025-01-01". */
export const defaultStartDate = (year: number): string => `${year - 1}-01-01`;

/** 2026 → "2026-12-31". */
export const defaultEndDate = (year: number): string => `${year}-12-31`;
