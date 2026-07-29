import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Employee } from '../../admin/entities/employee.entity';

export interface DirectoryEmployee {
  id: number;
  emp_code: string;
  emp_display_name: string;
  designation: string | null;
  department: string | null;
}

/**
 * Read-only staff directory behind the employee-portal people pickers.
 *
 * Deliberately its own tiny service rather than a reuse of the admin
 * `EmployeesService`: that one is a full CRUD/list surface with 12 filter
 * options and admin-shaped results, and pulling it in would drag AdminModule
 * (and a forwardRef) into every module that just needs a name picker.
 */
@Injectable()
export class EmployeeDirectoryService {
  constructor(
    @InjectRepository(Employee)
    private readonly employees: Repository<Employee>,
  ) {}

  /** Typeahead over code + name. Active employees only. */
  async search(q: string | undefined, limit: number): Promise<DirectoryEmployee[]> {
    const qb = this.base().where('e.is_active = TRUE');
    if (q) {
      qb.andWhere(
        new Brackets((w) => {
          w.where('e.emp_display_name ILIKE :q', { q: `%${q}%` }).orWhere(
            'e.emp_code ILIKE :q',
            { q: `%${q}%` },
          );
        }),
      );
    }
    const rows = await qb
      .orderBy('e.emp_display_name', 'ASC')
      .take(limit)
      .getMany();
    return rows.map(toDirectoryEmployee);
  }

  /**
   * Resolve specific ids, ignoring the active filter — a picker holding an
   * already-saved employee must still render their name after they are
   * deactivated, rather than showing a bare id.
   */
  async byIds(ids: number[]): Promise<DirectoryEmployee[]> {
    if (ids.length === 0) return [];
    const rows = await this.base()
      .where('e.id IN (:...ids)', { ids })
      .getMany();
    return rows.map(toDirectoryEmployee);
  }

  private base() {
    return this.employees
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.designation', 'des')
      .leftJoinAndSelect('e.department', 'dep');
  }
}

function toDirectoryEmployee(e: Employee): DirectoryEmployee {
  return {
    id: e.id,
    emp_code: e.emp_code,
    emp_display_name: e.emp_display_name,
    designation: e.designation?.name ?? null,
    department: e.department?.name ?? null,
  };
}
