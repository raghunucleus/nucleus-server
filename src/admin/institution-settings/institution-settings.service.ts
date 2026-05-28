import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InstitutionSetting } from '../entities/institution-setting.entity';

// The settings live in a single row. We pin it to id = 1 and create-on-read so
// the rest of the app can always assume `get()` returns a row.
const SINGLETON_ID = 1;

interface UpdateInstitutionSettingsInput {
  name: string;
  short_name?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  logo_url?: string | null;
  affiliation_code?: string | null;
  aicte_code?: string | null;
  naac_grade?: string | null;
  card_footer_note?: string | null;
}

@Injectable()
export class InstitutionSettingsService {
  constructor(
    @InjectRepository(InstitutionSetting)
    private readonly settings: Repository<InstitutionSetting>,
  ) {}

  /** The singleton settings row, created with sensible defaults if absent. */
  async get(): Promise<InstitutionSetting> {
    const existing = await this.settings.findOne({
      where: { id: SINGLETON_ID },
    });
    if (existing) return existing;
    return this.settings.save(
      this.settings.create({ id: SINGLETON_ID, name: 'Institution' }),
    );
  }

  /** Upsert the singleton row. Unspecified nullable fields are set to null. */
  async update(
    input: UpdateInstitutionSettingsInput,
  ): Promise<InstitutionSetting> {
    const row = await this.get();
    row.name = input.name;
    row.short_name = input.short_name ?? null;
    row.address_line1 = input.address_line1 ?? null;
    row.address_line2 = input.address_line2 ?? null;
    row.city = input.city ?? null;
    row.state = input.state ?? null;
    row.pincode = input.pincode ?? null;
    row.logo_url = input.logo_url ?? null;
    row.affiliation_code = input.affiliation_code ?? null;
    row.aicte_code = input.aicte_code ?? null;
    row.naac_grade = input.naac_grade ?? null;
    row.card_footer_note = input.card_footer_note ?? null;
    return this.settings.save(row);
  }
}
