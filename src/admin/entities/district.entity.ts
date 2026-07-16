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
import { State } from './state.entity';

// Leaf of the address master tree. `state` is eager and State.country is eager
// too, so a findOne here hydrates the full district -> state -> country chain.
//
// No IDX_districts_state_id — UQ_districts_state_id_name already leads with
// state_id. See the note on State.
@Entity({ name: 'districts' })
@Unique('UQ_districts_state_id_name', ['state_id', 'name'])
@Unique('UQ_districts_lgd_code', ['lgd_code'])
export class District {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  state_id: number;

  @ManyToOne(() => State, { onDelete: 'RESTRICT', eager: true })
  @JoinColumn({ name: 'state_id' })
  state: State;

  // Unique per state, and per state only — not per country. India reuses five
  // district names across states: Aurangabad (Bihar, Maharashtra), Hamirpur
  // (Himachal Pradesh, Uttar Pradesh), Bilaspur (Himachal Pradesh,
  // Chhattisgarh), Balrampur (Uttar Pradesh, Chhattisgarh) and Pratapgarh
  // (Uttar Pradesh, Rajasthan). A country-scoped constraint fails on the seed.
  @Column({ type: 'varchar', length: 128 })
  name: string;

  // Local Government Directory district code. Globally unique: LGD district
  // codes are unique nationally, so scoping this to the state would be too weak
  // — two states could each claim code 502.
  @Column({ type: 'varchar', length: 16, nullable: true })
  lgd_code: string | null;

  // Independent of the parent state/country by design — deactivating a state
  // leaves its districts active. That is deliberate, but it means this flag
  // alone does NOT mean "usable": an active district can sit under an inactive
  // state. Anything picking districts for downstream use must filter the whole
  // ancestor chain via DistrictsService.applyEffectiveActive (exposed as the
  // `effectiveActive` list param), not read is_active directly.
  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
