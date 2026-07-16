import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Country } from './country.entity';

// Second level of the address master tree. For India these are the 28 states +
// 8 union territories; the entity draws no distinction between the two.
//
// No IDX_states_country_id: Postgres does not auto-index FK columns, but
// UQ_states_country_id_name already leads with country_id, and a composite
// unique index serves prefix lookups on its leading column. A separate index
// would be duplicate write cost for no read benefit.
@Entity({ name: 'states' })
@Unique('UQ_states_country_id_name', ['country_id', 'name'])
@Unique('UQ_states_lgd_code', ['lgd_code'])
@Unique('UQ_states_iso_code', ['iso_code'])
export class State {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  country_id: number;

  @ManyToOne(() => Country, { onDelete: 'RESTRICT', eager: true })
  @JoinColumn({ name: 'country_id' })
  country: Country;

  // Unique per country, not globally: Punjab exists in both India and Pakistan,
  // and Georgia is both a US state and a sovereign country.
  @Column({ type: 'varchar', length: 128 })
  name: string;

  // Local Government Directory state code. Globally unique rather than scoped to
  // country because LGD is a single Indian registry — states of other countries
  // simply leave this null. A second national scheme would earn its own column
  // rather than overload this one.
  @Column({ type: 'varchar', length: 16, nullable: true })
  lgd_code: string | null;

  // ISO 3166-2, e.g. 'IN-AP'. Globally unique because the code embeds its
  // country prefix by construction, so it is already a global namespace.
  @Column({ type: 'varchar', length: 8, nullable: true })
  iso_code: string | null;

  // Independent of the parent country and of child districts by design —
  // deactivating a country does not cascade here, and deactivating a state does
  // not cascade to its districts. Consumers wanting "usable" states must filter
  // the whole ancestor chain; see StatesService.applyEffectiveActive.
  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
