import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AdmissionYear } from '../../admin/entities/admission-year.entity';
import { Programme } from '../../admin/entities/programme.entity';
import {
  ACCESS_ALL,
  AccessibleIds,
  PermissionsService,
} from '../../rbac/permissions.service';
import { CoordinatorDriveQueryDto } from './dto/coordinator-drive-query.dto';
import { DriveStudentsService } from './drive-students.service';
import { DriveEligibilityScope, DrivesService } from './drives.service';

export const COORDINATOR_SCREEN_KEY = 'placement_coordinator.drives.view';

/**
 * The Placement Coordinator's read-only drive surface.
 *
 * Everything is a delegation to the drive-management services with the
 * coordinator's RBAC scope (programmes + passout years) applied:
 *
 *  - the list only shows drives whose eligibility overlaps BOTH axes (an empty
 *    eligibility axis is open and matches; a drive with no eligibility row is
 *    hidden — see DrivesService.applyEligibilityScope);
 *  - single-drive reads 404 on an out-of-scope id, so scope misses are
 *    indistinguishable from nonexistent drives;
 *  - the drive's student list is additionally filtered to students within the
 *    same programmes/passout years.
 *
 * Per the RBAC contract, `[]` on either axis means no access (empty result /
 * 404), and `'all'` drops that axis's filter. The catalog declares both
 * attributes `required` + `allow_all: false`, so in practice both arrive as
 * non-empty id lists — the other branches are handled anyway.
 */
@Injectable()
export class PlacementCoordinatorDrivesService {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly drives: DrivesService,
    private readonly driveStudents: DriveStudentsService,
    @InjectRepository(Programme)
    private readonly programmes: Repository<Programme>,
    @InjectRepository(AdmissionYear)
    private readonly admissionYears: Repository<AdmissionYear>,
  ) {}

  /** The coordinator's scope, or null when either axis grants no access. */
  private async resolveScope(
    employeeId: number,
  ): Promise<DriveEligibilityScope | null> {
    const [programmeIds, passoutYears] = await Promise.all([
      this.permissions.getAccessibleProgrammeIds(
        employeeId,
        COORDINATOR_SCREEN_KEY,
      ),
      this.permissions.getAccessiblePassoutYears(
        employeeId,
        COORDINATOR_SCREEN_KEY,
      ),
    ]);
    if (
      (programmeIds !== ACCESS_ALL && programmeIds.length === 0) ||
      (passoutYears !== ACCESS_ALL && passoutYears.length === 0)
    ) {
      return null;
    }
    return { programmeIds, passoutYears };
  }

  /**
   * Intersect a requested filter with the accessible values — the coordinator
   * can narrow their scope, never widen it. No request = the full scope.
   */
  private clamp(
    requested: number[] | undefined,
    accessible: AccessibleIds,
  ): AccessibleIds {
    if (!requested?.length) return accessible;
    if (accessible === ACCESS_ALL) return requested;
    return requested.filter((v) => accessible.includes(v));
  }

  /** 404 (never 403) on a scope miss, so out-of-scope ids don't leak. */
  private async assertVisible(
    driveId: number,
    scope: DriveEligibilityScope | null,
  ): Promise<DriveEligibilityScope> {
    if (!scope || !(await this.drives.existsInEligibilityScope(driveId, scope))) {
      throw new NotFoundException('Drive not found.');
    }
    return scope;
  }

  async list(employeeId: number, query: CoordinatorDriveQueryDto) {
    const empty = { items: [], total: 0, page: query.page, limit: query.limit };
    const scope = await this.resolveScope(employeeId);
    if (!scope) return empty;

    const programmeIds = this.clamp(query.programme_ids, scope.programmeIds);
    const passoutYears = this.clamp(query.passout_years, scope.passoutYears);
    if (
      (programmeIds !== ACCESS_ALL && programmeIds.length === 0) ||
      (passoutYears !== ACCESS_ALL && passoutYears.length === 0)
    ) {
      return empty;
    }
    return this.drives.list(query, { programmeIds, passoutYears });
  }

  async get(employeeId: number, driveId: number) {
    await this.assertVisible(driveId, await this.resolveScope(employeeId));
    return this.drives.get(driveId);
  }

  async eligibilitySummary(employeeId: number, driveId: number) {
    await this.assertVisible(driveId, await this.resolveScope(employeeId));
    return this.drives.eligibilitySummary(driveId);
  }

  async students(
    employeeId: number,
    driveId: number,
    opts: { page: number; pageSize: number; search?: string; status?: number },
  ) {
    const scope = await this.assertVisible(
      driveId,
      await this.resolveScope(employeeId),
    );
    return this.driveStudents.list(driveId, {
      ...opts,
      studentScope: {
        programmeIds: scope.programmeIds,
        passoutYears: scope.passoutYears,
      },
    });
  }

  /**
   * The coordinator's accessible programmes + passout years, for the list
   * page's scope facets and empty states. The `'all'` branches fall back to
   * the full active lists (same sources as `DrivesService.eligibilityOptions`).
   */
  async scope(employeeId: number) {
    const scope = await this.resolveScope(employeeId);
    if (!scope) return { programmes: [], passout_years: [] };

    const programmeRows = await this.programmes.find({
      where:
        scope.programmeIds === ACCESS_ALL
          ? { is_active: true }
          : { id: In(scope.programmeIds), is_active: true },
      select: { id: true, display_name: true, name: true },
      order: { name: 'ASC' },
    });

    let years: number[];
    if (scope.passoutYears === ACCESS_ALL) {
      const rows = await this.admissionYears.find({
        where: { is_active: true },
        select: { year: true },
        order: { year: 'DESC' },
      });
      years = rows.map((a) => a.year + 4);
    } else {
      years = [...scope.passoutYears].sort((a, b) => b - a);
    }

    return {
      programmes: programmeRows.map((p) => ({
        id: p.id,
        name: p.display_name || p.name,
      })),
      passout_years: years,
    };
  }

  /**
   * The list page's classifier filter options in one round trip. Served from
   * THIS screen so a coordinator-only grant never 403s on its own filters
   * (same rationale as the manage screen's option endpoints).
   */
  async filterOptions() {
    const [companies, company_categories, offer_types, placement_categories] =
      await Promise.all([
        this.drives.companyOptions(),
        this.drives.companyCategoryOptions(),
        this.drives.offerTypeOptions(),
        this.drives.placementCategoryOptions(),
      ]);
    return { companies, company_categories, offer_types, placement_categories };
  }
}
