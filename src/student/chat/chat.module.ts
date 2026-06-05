import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProgrammeSemester } from '../../admin/entities/programme-semester.entity';
import { Student } from '../../admin/entities/student.entity';
import { StudentGroup } from '../../admin/entities/student-group.entity';
import { ChatCleanupService } from './chat-cleanup.service';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { ChatConversation } from './entities/chat-conversation.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { PeerProfileService } from './peer-profile.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ChatConversation,
      ChatMessage,
      StudentGroup,
      // Backing the peer-profile read (GET /student/chat/participants/:id).
      Student,
      ProgrammeSemester,
    ]),
    ConfigModule,
    // Verify-only: the gateway passes the student access secret explicitly per
    // call, mirroring the HTTP `student-jwt` strategy.
    JwtModule.register({}),
  ],
  controllers: [ChatController],
  // StorageService (used by PeerProfileService for presigned photos) is provided
  // by the @Global() StorageModule, so it needs no explicit import here.
  providers: [ChatService, ChatGateway, ChatCleanupService, PeerProfileService],
})
export class ChatModule {}
