import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Student } from '../../../admin/entities/student.entity';
import { ChatConversation } from './chat-conversation.entity';

@Entity({ name: 'chat_messages' })
// (conversation_id, id) covers the paginated history read (filter by
// conversation, order/seek by id). A standalone created_at index serves the
// retention sweep that deletes everything older than the cutoff.
@Index('IDX_chat_messages_conversation_id_id', ['conversation_id', 'id'])
@Index('IDX_chat_messages_created_at', ['created_at'])
export class ChatMessage {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  conversation_id: number;

  @ManyToOne(() => ChatConversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: ChatConversation;

  @Column({ type: 'int' })
  sender_id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sender_id' })
  sender: Student;

  // The message text — plain UTF-8, so emoji and any script (Telugu, etc.) are
  // stored verbatim. Text only: no files or images.
  @Column({ type: 'text' })
  body: string;

  @CreateDateColumn()
  created_at: Date;
}
