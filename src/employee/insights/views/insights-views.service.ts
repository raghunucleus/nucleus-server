import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PermissionsService } from '../../../rbac/permissions.service';
import {
  CreateSavedViewDto,
  UpdateSavedViewDto,
} from '../dto/insights-views.dto';
import { INSIGHTS_ROUTES } from '../insights-scope.service';
import { EmployeeSavedView } from './employee-saved-view.entity';

/** Enough for a power user; stops a runaway client filling the table. */
const MAX_VIEWS_PER_EMPLOYEE = 50;

export interface SavedViewDto {
  id: number;
  screen_key: string;
  route: string;
  name: string;
  search: string;
  is_pinned: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/**
 * Personal saved views. Every method takes the acting employee's id and
 * filters by it — a view belonging to someone else is a 404, never a 403, so
 * ids don't leak. Saving for a screen the employee doesn't hold is refused:
 * the view would be a dead link, and a stale grant shouldn't leave a pinned
 * chip that 403s on click.
 */
@Injectable()
export class InsightsViewsService {
  constructor(
    @InjectRepository(EmployeeSavedView)
    private readonly views: Repository<EmployeeSavedView>,
    private readonly permissions: PermissionsService,
  ) {}

  async list(employeeId: number): Promise<SavedViewDto[]> {
    const rows = await this.views.find({
      where: { employee_id: employeeId },
      order: { is_pinned: 'DESC', sort_order: 'ASC', name: 'ASC' },
    });
    return rows.map(toDto);
  }

  async create(
    employeeId: number,
    dto: CreateSavedViewDto,
  ): Promise<SavedViewDto> {
    if (INSIGHTS_ROUTES[dto.screen_key] !== dto.route) {
      throw new BadRequestException(
        'route does not belong to that insights screen.',
      );
    }
    if (!(await this.permissions.hasScreen(employeeId, dto.screen_key))) {
      throw new ForbiddenException('Access denied');
    }
    const count = await this.views.count({
      where: { employee_id: employeeId },
    });
    if (count >= MAX_VIEWS_PER_EMPLOYEE) {
      throw new BadRequestException(
        `You can keep at most ${MAX_VIEWS_PER_EMPLOYEE} saved views — delete one first.`,
      );
    }
    await this.assertNameFree(employeeId, dto.screen_key, dto.name);
    const row = await this.views.save(
      this.views.create({
        employee_id: employeeId,
        screen_key: dto.screen_key,
        route: dto.route,
        name: dto.name,
        search: stripQuestion(dto.search),
        is_pinned: dto.is_pinned,
        sort_order: count,
      }),
    );
    return toDto(row);
  }

  async update(
    employeeId: number,
    id: number,
    dto: UpdateSavedViewDto,
  ): Promise<SavedViewDto> {
    const row = await this.own(employeeId, id);
    if (dto.name !== undefined && dto.name !== row.name) {
      await this.assertNameFree(employeeId, row.screen_key, dto.name);
      row.name = dto.name;
    }
    if (dto.search !== undefined) row.search = stripQuestion(dto.search);
    if (dto.is_pinned !== undefined) row.is_pinned = dto.is_pinned;
    if (dto.sort_order !== undefined) row.sort_order = dto.sort_order;
    return toDto(await this.views.save(row));
  }

  async remove(employeeId: number, id: number): Promise<void> {
    const row = await this.own(employeeId, id);
    await this.views.remove(row);
  }

  private async own(
    employeeId: number,
    id: number,
  ): Promise<EmployeeSavedView> {
    const row = await this.views.findOne({
      where: { id, employee_id: employeeId },
    });
    if (!row) throw new NotFoundException('Saved view not found.');
    return row;
  }

  private async assertNameFree(
    employeeId: number,
    screenKey: string,
    name: string,
  ): Promise<void> {
    const clash = await this.views.findOne({
      where: { employee_id: employeeId, screen_key: screenKey, name },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException(
        'You already have a view with that name on this screen.',
      );
    }
  }
}

/** The DTO already strips a leading `?`; repeated here so a direct caller
 *  (a script, a future internal use) can't store one either. */
function stripQuestion(search: string): string {
  return search.replace(/^\?/, '');
}

function toDto(row: EmployeeSavedView): SavedViewDto {
  return {
    id: row.id,
    screen_key: row.screen_key,
    route: row.route,
    name: row.name,
    search: row.search,
    is_pinned: row.is_pinned,
    sort_order: row.sort_order,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}
