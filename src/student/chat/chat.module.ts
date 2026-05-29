import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StudentGroup } from '../../admin/entities/student-group.entity';
import { ChatCleanupService } from './chat-cleanup.service';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { ChatConversation } from './entities/chat-conversation.entity';
import { ChatMessage } from './entities/chat-message.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatConversation, ChatMessage, StudentGroup]),
    ConfigModule,
    // Verify-only: the gateway passes the student access secret explicitly per
    // call, mirroring the HTTP `student-jwt` strategy.
    JwtModule.register({}),
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway, ChatCleanupService],
})
export class ChatModule {}
