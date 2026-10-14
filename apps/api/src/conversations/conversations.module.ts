import { Module } from '@nestjs/common';
import { GatewayModule } from '../gateway/gateway.module';
import { ModelsModule } from '../models/models.module';
import { UsageModule } from '../usage/usage.module';
import { UsersModule } from '../users/users.module';
import { ChatService } from './chat.service';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

@Module({ imports: [UsersModule, ModelsModule, UsageModule, GatewayModule], controllers: [ConversationsController], providers: [ConversationsService, ChatService] })
export class ConversationsModule {}
