import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DevMailOutbox } from './entities/dev-mail-outbox.entity';
import { MailService } from './mail.service';

@Global()
@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([DevMailOutbox])],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
