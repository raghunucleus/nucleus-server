import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Timetable } from './timetable.entity';

// One period row of a timetable's grid — its own bell schedule, so every
// timetable can have a different number of periods and different timings.
// Break/lunch rows (is_break = true) carry no class; entries can't point at
// them.
@Entity({ name: 'timetable_periods' })
@Unique('UQ_timetable_periods_timetable_id_position', [
  'timetable_id',
  'position',
])
@Index('IDX_timetable_periods_timetable_id', ['timetable_id'])
export class TimetablePeriod {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  timetable_id: number;

  @ManyToOne(() => Timetable, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'timetable_id' })
  timetable: Timetable;

  // 1-based display order of the period within the day.
  @Column({ type: 'smallint' })
  position: number;

  @Column({ type: 'varchar', length: 48 })
  label: string;

  // PG `time` — TypeORM hands these back as 'HH:MM:SS' strings.
  @Column({ type: 'time' })
  start_time: string;

  @Column({ type: 'time' })
  end_time: string;

  @Column({ type: 'boolean', default: false })
  is_break: boolean;

  @CreateDateColumn()
  created_at: Date;
}
