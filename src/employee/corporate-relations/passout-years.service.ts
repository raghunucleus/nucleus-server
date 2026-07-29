import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PassoutYearDto, UpdatePassoutYearDto } from './dto/passout-year.dto';
import {
  defaultEndDate,
  defaultStartDate,
  deriveDisplayYear,
  PassoutYear,
} from './entities/passout-year.entity';

/**
 * CRUD over the passout-year master. Mirrors {@link CompanyAttributesService}
 * in shape, but the rows carry no free-text name: the label is derived and the
 * uniqueness key is the year itself.
 */
@Injectable()
export class PassoutYearsService {
  constructor(
    @InjectRepository(PassoutYear)
    private readonly repo: Repository<PassoutYear>,
  ) {}

  list(includeInactive = false): Promise<PassoutYear[]> {
    return this.repo.find({
      where: includeInactive ? {} : { is_active: true },
      order: { passout_year: 'DESC' },
    });
  }

  async create(dto: PassoutYearDto): Promise<PassoutYear> {
    const exists = await this.repo.findOne({
      where: { passout_year: dto.passout_year },
    });
    if (exists) {
      throw new BadRequestException(`${dto.passout_year} already exists.`);
    }
    const row = this.repo.create({
      passout_year: dto.passout_year,
      display_year: deriveDisplayYear(dto.passout_year),
      start_date: dto.start_date ?? defaultStartDate(dto.passout_year),
      end_date: dto.end_date ?? defaultEndDate(dto.passout_year),
    });
    this.assertDateOrder(row.start_date, row.end_date);
    return this.repo.save(row);
  }

  /**
   * Only the academic window is editable. The year itself is fixed once the row
   * exists — it is the identity anything else would key off, so a correction is
   * a deactivate-and-re-add, not an in-place rewrite. The DTO has no
   * `passout_year` field, so `display_year` can never fall out of step either.
   */
  async update(id: number, dto: UpdatePassoutYearDto): Promise<PassoutYear> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Passout year not found.');

    if (dto.start_date !== undefined) row.start_date = dto.start_date;
    if (dto.end_date !== undefined) row.end_date = dto.end_date;

    this.assertDateOrder(row.start_date, row.end_date);
    return this.repo.save(row);
  }

  async setStatus(id: number, isActive: boolean): Promise<PassoutYear> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Passout year not found.');
    row.is_active = isActive;
    return this.repo.save(row);
  }

  /** ISO 'YYYY-MM-DD' sorts lexicographically, so a string compare is enough. */
  private assertDateOrder(start: string, end: string): void {
    if (end < start) {
      throw new BadRequestException(
        'End date must be on or after the start date.',
      );
    }
  }
}
