import { DataSource } from 'typeorm';
import { AdmissionYear } from '../../admin/entities/admission-year.entity';
import { AttendanceGroup } from '../../admin/entities/attendance-group.entity';
import { Department } from '../../admin/entities/department.entity';
import { Programme } from '../../admin/entities/programme.entity';
import { Regulation } from '../../admin/entities/regulation.entity';
import { Semester } from '../../admin/entities/semester.entity';

/**
 * Picker-option shape returned to the admin-ui assignment editor. Every
 * fetcher produces this — no `value_field`/`label_field` field-mapping on
 * the catalog, no per-attribute URL knowledge in the client.
 *
 * `id` is what gets stored on `role_assignment_attributes.value` (typically
 * a number id, but a string is allowed for non-DB-backed custom attributes
 * such as a static enum).
 */
export interface PickerOption {
  id: number | string;
  label: string;
}

/**
 * Function signature for fetching the picker options for one catalog
 * attribute type. Receives a DataSource so the function can run scoped
 * queries / joins without having to be a Nest provider itself. Custom
 * attributes that don't touch the DB can simply return a hard-coded list.
 */
export type AttributeFetcher = (ds: DataSource) => Promise<PickerOption[]>;

/**
 * Registry: catalog attribute-type key → fetcher. The catalog validator at
 * boot asserts every `AttributeTypeDef.key` has a matching entry here, so a
 * misconfigured catalog blocks server start rather than failing at picker
 * time.
 *
 * To add a new attribute type:
 *   1. Add it to `ATTRIBUTE_TYPES` in attribute-types.ts.
 *   2. Add a fetcher under the same key here.
 *   3. Reference the type from a screen's attribute schema in screens.ts.
 *
 * Custom (non-entity-backed) example:
 *   'enum:priority': async () => [
 *     { id: 'low', label: 'Low' },
 *     { id: 'high', label: 'High' },
 *   ],
 */
export const ATTRIBUTE_FETCHERS: Record<string, AttributeFetcher> = {
  'ref:department': async (ds) => {
    const rows = await ds.getRepository(Department).find({
      where: { is_active: true },
      select: { id: true, name: true },
      order: { name: 'ASC' },
    });
    return rows.map((d) => ({ id: d.id, label: d.name }));
  },

  'ref:programme': async (ds) => {
    const rows = await ds.getRepository(Programme).find({
      where: { is_active: true },
      select: { id: true, name: true, code: true },
      order: { name: 'ASC' },
    });
    return rows.map((p) => ({ id: p.id, label: `${p.name} (${p.code})` }));
  },

  'ref:admission_year': async (ds) => {
    const rows = await ds.getRepository(AdmissionYear).find({
      where: { is_active: true },
      select: { id: true, display_year: true },
      order: { year: 'DESC' },
    });
    return rows.map((a) => ({ id: a.id, label: a.display_year }));
  },

  'ref:semester': async (ds) => {
    const rows = await ds.getRepository(Semester).find({
      where: { is_active: true },
      select: { id: true, year_sem_format: true, roman_format: true },
      order: { sem_number: 'ASC' },
    });
    return rows.map((s) => ({
      id: s.id,
      label: `${s.year_sem_format} (${s.roman_format})`,
    }));
  },

  'ref:regulation': async (ds) => {
    const rows = await ds.getRepository(Regulation).find({
      where: { is_active: true },
      select: { id: true, code: true, year_of_regulation: true },
      order: { year_of_regulation: 'DESC' },
    });
    return rows.map((r) => ({
      id: r.id,
      label: `${r.code} (${r.year_of_regulation})`,
    }));
  },

  'ref:attendance_group': async (ds) => {
    // Joins programme + admission_year so the picker shows a fully
    // disambiguating "{programme} / {year} / {group}" label across all
    // batches in one flat list.
    const rows = await ds
      .getRepository(AttendanceGroup)
      .createQueryBuilder('g')
      .leftJoin('g.programme', 'p')
      .leftJoin('g.admission_year', 'ay')
      .select(['g.id', 'g.name', 'p.name', 'ay.display_year'])
      .where('g.is_active = TRUE')
      .orderBy('p.name', 'ASC')
      .addOrderBy('ay.display_year', 'DESC')
      .addOrderBy('g.name', 'ASC')
      .getMany();
    return rows.map((g) => ({
      id: g.id,
      label: `${g.programme?.name ?? '—'} / ${g.admission_year?.display_year ?? '—'} / ${g.name}`,
    }));
  },
};
