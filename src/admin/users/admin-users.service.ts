import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminService } from '../admin.service';
import type { AdminUsersSortField } from '../dto/list-admin-users.dto';
import { Admin } from '../entities/admin.entity';

export type PublicAdmin = Omit<
  Admin,
  'password_hash' | 'totp_secret' | 'syncDisplayName'
>;

export interface ListAdminUsersResult {
  rows: PublicAdmin[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const SORT_COLUMN: Record<AdminUsersSortField, string> = {
  name: 'display_name',
  email: 'email',
  username: 'username',
  role: 'is_master_admin',
  status: 'is_active',
  created_at: 'created_at',
};

// Note: is_master_admin is intentionally not part of the input contracts.
// The flag is managed directly in the database; admin screens cannot grant or
// revoke master privileges.
interface CreateAdminUserInput {
  username: string;
  email: string;
  password: string;
  first_name?: string | null;
  last_name?: string | null;
  country_code?: string | null;
  mobile_number?: string | null;
}

interface UpdateAdminUserInput {
  email?: string;
  first_name?: string | null;
  last_name?: string | null;
  country_code?: string | null;
  mobile_number?: string | null;
  password?: string;
}

@Injectable()
export class AdminUsersService {
  constructor(
    @InjectRepository(Admin) private readonly admins: Repository<Admin>,
  ) {}

  async list(opts: {
    page: number;
    pageSize: number;
    search?: string;
    sortBy: AdminUsersSortField;
    sortOrder: 'asc' | 'desc';
    nameSearch?: string;
    emailSearch?: string;
    usernameSearch?: string;
    mobileSearch?: string;
    status?: 'active' | 'inactive';
    role?: 'master' | 'admin';
  }): Promise<ListAdminUsersResult> {
    const qb = this.admins.createQueryBuilder('a');

    if (opts.search) {
      const needle = `%${opts.search.toLowerCase()}%`;
      qb.andWhere(
        `(LOWER(COALESCE(a.display_name, '')) LIKE :gn
          OR LOWER(COALESCE(a.first_name, '')) LIKE :gn
          OR LOWER(COALESCE(a.last_name, '')) LIKE :gn
          OR LOWER(a.email) LIKE :gn
          OR LOWER(a.username) LIKE :gn
          OR LOWER(COALESCE(a.mobile_number, '')) LIKE :gn)`,
        { gn: needle },
      );
    }

    if (opts.nameSearch) {
      const n = `%${opts.nameSearch.toLowerCase()}%`;
      qb.andWhere(
        `(LOWER(COALESCE(a.display_name, '')) LIKE :nn
          OR LOWER(COALESCE(a.first_name, '')) LIKE :nn
          OR LOWER(COALESCE(a.last_name, '')) LIKE :nn)`,
        { nn: n },
      );
    }

    if (opts.emailSearch) {
      qb.andWhere('LOWER(a.email) LIKE :en', {
        en: `%${opts.emailSearch.toLowerCase()}%`,
      });
    }

    if (opts.usernameSearch) {
      qb.andWhere('LOWER(a.username) LIKE :un', {
        un: `%${opts.usernameSearch.toLowerCase()}%`,
      });
    }

    if (opts.mobileSearch) {
      qb.andWhere(
        "LOWER(COALESCE(a.mobile_number, '')) LIKE :mn",
        { mn: `%${opts.mobileSearch.toLowerCase()}%` },
      );
    }

    if (opts.status === 'active') {
      qb.andWhere('a.is_active = TRUE');
    } else if (opts.status === 'inactive') {
      qb.andWhere('a.is_active = FALSE');
    }

    if (opts.role === 'master') {
      qb.andWhere('a.is_master_admin = TRUE');
    } else if (opts.role === 'admin') {
      qb.andWhere('a.is_master_admin = FALSE');
    }

    const direction: 'ASC' | 'DESC' = opts.sortOrder === 'asc' ? 'ASC' : 'DESC';
    qb.orderBy(`a.${SORT_COLUMN[opts.sortBy]}`, direction, 'NULLS LAST')
      // Stable tiebreaker so pages don't shuffle when sort values tie.
      .addOrderBy('a.id', 'ASC')
      .skip((opts.page - 1) * opts.pageSize)
      .take(opts.pageSize);

    const [rows, total] = await qb.getManyAndCount();
    return {
      rows: rows.map((r) => this.toPublic(r)),
      total,
      page: opts.page,
      pageSize: opts.pageSize,
      pageCount: total === 0 ? 0 : Math.ceil(total / opts.pageSize),
    };
  }

  async getOne(id: string): Promise<PublicAdmin> {
    const admin = await this.admins.findOne({ where: { id } });
    if (!admin) throw new NotFoundException('Admin user not found');
    return this.toPublic(admin);
  }

  async create(input: CreateAdminUserInput): Promise<PublicAdmin> {
    const existing = await this.admins
      .createQueryBuilder('a')
      .where('LOWER(a.email) = LOWER(:email) OR LOWER(a.username) = LOWER(:username)', {
        email: input.email,
        username: input.username,
      })
      .getOne();
    if (existing) {
      throw new ConflictException(
        existing.email.toLowerCase() === input.email.toLowerCase()
          ? 'Email is already in use'
          : 'Username is already in use',
      );
    }

    const passwordHash = await AdminService.hashPassword(input.password);
    const mobile = input.mobile_number ?? null;
    const countryCode = mobile ? input.country_code ?? '91' : null;

    const admin = this.admins.create({
      username: input.username,
      email: input.email,
      password_hash: passwordHash,
      first_name: input.first_name ?? null,
      last_name: input.last_name ?? null,
      country_code: countryCode,
      mobile_number: mobile,
      is_master_admin: false,
      is_active: true,
    });
    const saved = await this.admins.save(admin);
    return this.toPublic(saved);
  }

  async update(id: string, patch: UpdateAdminUserInput): Promise<PublicAdmin> {
    const admin = await this.admins.findOne({ where: { id } });
    if (!admin) throw new NotFoundException('Admin user not found');

    if (patch.email !== undefined && patch.email !== admin.email) {
      const collision = await this.admins
        .createQueryBuilder('a')
        .where('LOWER(a.email) = LOWER(:email) AND a.id != :id', {
          email: patch.email,
          id,
        })
        .getOne();
      if (collision) throw new ConflictException('Email is already in use');
      admin.email = patch.email;
    }

    if (patch.first_name !== undefined) admin.first_name = patch.first_name;
    if (patch.last_name !== undefined) admin.last_name = patch.last_name;
    if (patch.country_code !== undefined) admin.country_code = patch.country_code;
    if (patch.mobile_number !== undefined) admin.mobile_number = patch.mobile_number;

    if (admin.mobile_number === null) {
      admin.country_code = null;
    } else if (!admin.country_code) {
      admin.country_code = '91';
    }

    if (patch.password !== undefined) {
      admin.password_hash = await AdminService.hashPassword(patch.password);
    }

    const saved = await this.admins.save(admin);
    return this.toPublic(saved);
  }

  async setActive(
    id: string,
    actingAdminId: string,
    active: boolean,
  ): Promise<PublicAdmin> {
    const admin = await this.admins.findOne({ where: { id } });
    if (!admin) throw new NotFoundException('Admin user not found');

    if (!active && admin.id === actingAdminId) {
      throw new BadRequestException('You cannot deactivate your own account.');
    }

    if (admin.is_active === active) {
      return this.toPublic(admin);
    }

    admin.is_active = active;
    const saved = await this.admins.save(admin);
    // Existing access tokens for a deactivated admin remain valid until they
    // expire; refresh and password login both reject is_active=false so the
    // window is bounded by the access-token TTL.
    return this.toPublic(saved);
  }

  private toPublic(admin: Admin): PublicAdmin {
    const { password_hash: _ph, totp_secret: _ts, ...rest } = admin;
    return rest;
  }
}
