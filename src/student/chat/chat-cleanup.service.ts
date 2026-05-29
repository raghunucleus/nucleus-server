import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatConversation } from './entities/chat-conversation.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatService } from './chat.service';

const BATCH_SIZE = 1000;

/**
 * Enforces the configured chat retention window (env
 * `CHAT_MESSAGE_RETENTION_DAYS`, default 90). Runs nightly: messages older than
 * the cutoff are deleted in batches, and any conversation whose entire tail has
 * aged out has its denormalised preview cleared so the list doesn't show a
 * stale snippet that no longer has a message behind it.
 */
@Injectable()
export class ChatCleanupService {
  private readonly logger = new Logger('ChatCleanup');

  constructor(
    @InjectRepository(ChatMessage)
    private readonly messages: Repository<ChatMessage>,
    @InjectRepository(ChatConversation)
    private readonly conversations: Repository<ChatConversation>,
    private readonly chat: ChatService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeExpired(): Promise<number> {
    const days = this.chat.retentionDays();
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    let deleted = 0;
    // DELETE ... LIMIT isn't valid in Postgres, so delete by a bounded id set
    // and loop until a batch comes back smaller than the cap.
    for (;;) {
      const res: { affected?: number | null } = await this.messages
        .createQueryBuilder()
        .delete()
        .where(
          'id IN (SELECT id FROM "chat_messages" WHERE created_at < :cutoff LIMIT :batch)',
          { cutoff, batch: BATCH_SIZE },
        )
        .execute();
      const n = res.affected ?? 0;
      deleted += n;
      if (n < BATCH_SIZE) break;
    }

    // Clear previews/cursors for conversations whose last message has aged out.
    await this.conversations
      .createQueryBuilder()
      .update()
      .set({
        last_message_at: null,
        last_message_preview: null,
        last_message_sender_id: null,
      })
      .where('last_message_at < :cutoff', { cutoff })
      .execute();

    if (deleted > 0) {
      this.logger.log(
        `Purged ${deleted} chat message(s) older than ${days} day(s).`,
      );
    }
    return deleted;
  }
}
