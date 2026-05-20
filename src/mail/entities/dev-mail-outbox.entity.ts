import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Dev-only mail capture. When NODE_ENV=dev the MailService writes every
 * outbound email here instead of calling SendGrid, so email-driven flows —
 * student temporary passwords, password-reset links — can be read straight
 * from the database without a live mail account.
 *
 * Never written outside dev.
 */
@Entity({ name: 'dev_mail_outbox' })
export class DevMailOutbox {
  @PrimaryGeneratedColumn()
  id: number;

  // 'to' is a SQL reserved word — the recipient is stored as to_address.
  @Column({ type: 'varchar', length: 255 })
  to_address: string;

  @Column({ type: 'varchar', length: 255 })
  subject: string;

  @Column({ type: 'text' })
  body_text: string;

  @Column({ type: 'text' })
  body_html: string;

  @CreateDateColumn()
  created_at: Date;
}
