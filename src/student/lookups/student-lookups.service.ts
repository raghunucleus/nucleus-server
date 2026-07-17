import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Country } from '../../admin/entities/country.entity';
import { DiplomaBoard } from '../../admin/entities/diploma-board.entity';
import { District } from '../../admin/entities/district.entity';
import { EntranceExam } from '../../admin/entities/entrance-exam.entity';
import { IndustryCertification } from '../../admin/entities/industry-certification.entity';
import { SchoolBoardX } from '../../admin/entities/school-board-x.entity';
import { SchoolBoardXii } from '../../admin/entities/school-board-xii.entity';
import { State } from '../../admin/entities/state.entity';

export interface LookupOption {
  id: number;
  name: string;
}

/**
 * Read-only dropdown options for the student profile forms, drawn from the
 * admin-managed master lists. Only active rows are served; states/districts
 * additionally require the whole parent chain to be active (a state under a
 * deactivated country would be a dead option). Master lists are bounded (a few
 * hundred rows at most), so no pagination — clients filter locally.
 */
@Injectable()
export class StudentLookupsService {
  constructor(
    @InjectRepository(Country)
    private readonly countries: Repository<Country>,
    @InjectRepository(State)
    private readonly states: Repository<State>,
    @InjectRepository(District)
    private readonly districts: Repository<District>,
    @InjectRepository(EntranceExam)
    private readonly entranceExams: Repository<EntranceExam>,
    @InjectRepository(IndustryCertification)
    private readonly industryCertifications: Repository<IndustryCertification>,
    @InjectRepository(SchoolBoardX)
    private readonly schoolBoardsX: Repository<SchoolBoardX>,
    @InjectRepository(SchoolBoardXii)
    private readonly schoolBoardsXii: Repository<SchoolBoardXii>,
    @InjectRepository(DiplomaBoard)
    private readonly diplomaBoards: Repository<DiplomaBoard>,
  ) {}

  async listCountries(): Promise<LookupOption[]> {
    return this.countries
      .createQueryBuilder('c')
      .select(['c.id AS id', 'c.name AS name'])
      .where('c.is_active = true')
      .orderBy('c.name', 'ASC')
      .getRawMany<LookupOption>();
  }

  async listStates(
    countryId?: number,
  ): Promise<Array<LookupOption & { country_id: number }>> {
    const qb = this.states
      .createQueryBuilder('s')
      .innerJoin('s.country', 'c')
      .select(['s.id AS id', 's.name AS name', 's.country_id AS country_id'])
      .where('s.is_active = true')
      .andWhere('c.is_active = true')
      .orderBy('s.name', 'ASC');
    if (countryId !== undefined) {
      qb.andWhere('s.country_id = :countryId', { countryId });
    }
    return qb.getRawMany();
  }

  async listDistricts(
    stateId?: number,
  ): Promise<Array<LookupOption & { state_id: number }>> {
    const qb = this.districts
      .createQueryBuilder('d')
      .innerJoin('d.state', 's')
      .innerJoin('s.country', 'c')
      .select(['d.id AS id', 'd.name AS name', 'd.state_id AS state_id'])
      .where('d.is_active = true')
      .andWhere('s.is_active = true')
      .andWhere('c.is_active = true')
      .orderBy('d.name', 'ASC');
    if (stateId !== undefined) {
      qb.andWhere('d.state_id = :stateId', { stateId });
    }
    return qb.getRawMany();
  }

  private simpleList(
    repo: Repository<{ id: number; name: string; is_active: boolean }>,
  ): Promise<LookupOption[]> {
    return repo
      .createQueryBuilder('r')
      .select(['r.id AS id', 'r.name AS name'])
      .where('r.is_active = true')
      .orderBy('r.name', 'ASC')
      .getRawMany<LookupOption>();
  }

  listEntranceExams(): Promise<LookupOption[]> {
    return this.simpleList(this.entranceExams);
  }

  listIndustryCertifications(): Promise<LookupOption[]> {
    return this.simpleList(this.industryCertifications);
  }

  listSchoolBoardsX(): Promise<LookupOption[]> {
    return this.simpleList(this.schoolBoardsX);
  }

  listSchoolBoardsXii(): Promise<LookupOption[]> {
    return this.simpleList(this.schoolBoardsXii);
  }

  listDiplomaBoards(): Promise<LookupOption[]> {
    return this.simpleList(this.diplomaBoards);
  }
}
