import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppService } from './app.service';
import { CurrentUser, Public, Roles, type AuthUser } from './auth';
import { CreateConversationDto, PreviewPricingDto, SendMessageDto, UpdateConversationDto, UpdateModelDto, UpdatePermissionDto, UpdatePricingDto } from './dto';

@Controller()
export class HealthController {
  @Public() @Get('health') health() {
    return {
      status: 'ok',
      service: 'enterprise-ai-api',
      externalProvidersEnabled: process.env.ENABLE_EXTERNAL_PROVIDERS === 'true',
    };
  }
}

@Controller('models')
export class ModelsController {
  constructor(private readonly app: AppService) {}
  @Get() list(@CurrentUser() user: AuthUser) { return this.app.listModels(user); }
}

@Controller('conversations')
export class ConversationsController {
  constructor(private readonly app: AppService) {}
  @Post() create(@CurrentUser() user: AuthUser, @Body() dto: CreateConversationDto) { return this.app.createConversation(user, dto.title); }
  @Get() list(@CurrentUser() user: AuthUser, @Query('search') search?: string) { return this.app.conversations(user, search); }
  @Get(':id') get(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.app.conversation(user, id); }
  @Patch(':id') rename(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateConversationDto) { return this.app.renameConversation(user, id, dto.title); }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.app.deleteConversation(user, id); }
  @Post(':id/messages') stream(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SendMessageDto, @Res() response: Response) {
    return this.app.streamMessage(user, id, dto, response);
  }
}

@Controller('usage')
export class UsageController {
  constructor(private readonly app: AppService) {}
  @Get('me') own(@CurrentUser() user: AuthUser) { return this.app.myUsage(user); }
}

@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly app: AppService) {}
  @Get('summary') summary() { return this.app.adminSummary(); }
  @Get('models') models() { return this.app.adminModels(); }
  @Patch('models/:id') updateModel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateModelDto) { return this.app.updateModel(user, id, dto); }
  @Get('users') users() { return this.app.users(); }
  @Patch('users/:userId/models/:modelId') permission(@CurrentUser() user: AuthUser, @Param('userId') userId: string, @Param('modelId') modelId: string, @Body() dto: UpdatePermissionDto) {
    return this.app.setModelPermission(user, userId, modelId, dto.allowed);
  }
  @Get('pricing') pricing(@Query('modelId') modelId?: string) { return this.app.pricing(modelId); }
  @Post('pricing/:modelId') updatePricing(@CurrentUser() user: AuthUser, @Param('modelId') modelId: string, @Body() dto: UpdatePricingDto) { return this.app.updatePricing(user, modelId, dto); }
  @Post('pricing/preview/calculate') preview(@Body() dto: PreviewPricingDto) { return this.app.calculatePreview(dto); }
}

