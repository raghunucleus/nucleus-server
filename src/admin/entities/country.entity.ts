import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

// Top of the address master tree: countries -> states -> districts. Seeded with
// India only (see 1792700000000-CreateAddressAttributes.ts); admins add any
// others through the UI, so nothing here special-cases India.
@Entity({ name: 'countries' })
@Unique('UQ_countries_name', ['name'])
@Unique('UQ_countries_iso2', ['iso2'])
@Unique('UQ_countries_iso3', ['iso3'])
export class Country {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  // ISO 3166-1 alpha-2 / alpha-3. Optional: an admin may add a country before
  // looking its codes up. NULL is exempt from UNIQUE in Postgres, so any number
  // of code-less countries can coexist without a partial index.
  @Column({ type: 'varchar', length: 2, nullable: true })
  iso2: string | null;

  @Column({ type: 'varchar', length: 3, nullable: true })
  iso3: string | null;

  // E.164 calling code, e.g. '+91'. Deliberately NOT unique: '+1' is shared by
  // the US, Canada and 20+ Caribbean states, '+7' by Russia and Kazakhstan. It
  // identifies a dialling plan, not a country.
  @Column({ type: 'varchar', length: 8, nullable: true })
  dial_code: string | null;

  // Independent of states/districts by design — deactivating a country does not
  // cascade. Consumers must not read this flag directly; see
  // CountriesService.list and DistrictsService.applyEffectiveActive.
  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
