import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res, applyDecorators } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiNoContentResponse, ApiNotFoundResponse, ApiOAuth2, ApiOkResponse, ApiOperation, ApiParam, ApiProduces, ApiQuery, ApiTags, ApiTooManyRequestsResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { AdminModelView, AdminSummary, AdminUserView, AuditLogView, ConversationDetail, ConversationSummary, ConversationView, ErrorResponse, HealthResponse, ModelView, MyUsageResponse, PriceResultView, PricingConfigurationView, PricingVersionView, AIModelView, UserModelPermissionView } from './api-schemas';
import { AppService } from './app.service';
import { CurrentUser, Public, Roles, type AuthUser } from './auth';
import { AuditQueryDto, CreateConversationDto, PreviewPricingDto, SendMessageDto, UpdateConversationDto, UpdateModelDto, UpdatePermissionDto, UpdatePricingDto, SummaryQueryDto } from './dto';
import { BEARER_SCHEME, OAUTH_SCHEME } from './swagger';

/** Every non-public route: Keycloak access token (via Swagger's PKCE login or a pasted bearer token), plus the global rate limit. */
const Secured = () => applyDecorators(
  ApiOAuth2(['openid'], OAUTH_SCHEME),
  ApiBearerAuth(BEARER_SCHEME),
  ApiUnauthorizedResponse({ description: 'Missing, expired, or invalid access token (signature, issuer, audience).', type: ErrorResponse }),
  ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (60 requests per minute).', type: ErrorResponse }),
);
const NotFound = (what: string) => ApiNotFoundResponse({ description: `${what} does not exist or is not visible to the caller.`, type: ErrorResponse });
const Invalid = () => ApiBadRequestResponse({ description: 'Validation failed; unknown properties are rejected.', type: ErrorResponse });
const ConversationId = () => ApiParam({ name: 'id', format: 'uuid', description: 'Conversation ID owned by the caller.' });

@ApiTags('health')
@Controller()
export class HealthController {
  @ApiOperation({ summary: 'Liveness check', description: 'Public. Never calls a model provider.', security: [] })
  @ApiOkResponse({ type: HealthResponse })
  @Public() @Get('health') health() {
    return {
      status: 'ok',
      service: 'enterprise-ai-api',
      externalProvidersEnabled: process.env.ENABLE_EXTERNAL_PROVIDERS === 'true',
    };
  }
}

@ApiTags('models')
@Secured()
@Controller('models')
export class ModelsController {
  constructor(private readonly app: AppService) {}
  @ApiOperation({ summary: 'List models for the caller', description: 'Includes permission, configuration, daily-limit, and availability status. Availability reads gateway configuration only and never calls a paid provider.' })
  @ApiOkResponse({ type: [ModelView] })
  @Get() list(@CurrentUser() user: AuthUser) { return this.app.listModels(user); }
}

@ApiTags('conversations')
@Secured()
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly app: AppService) {}
  @ApiOperation({ summary: 'Create a conversation' })
  @ApiCreatedResponse({ type: ConversationView }) @Invalid()
  @Post() create(@CurrentUser() user: AuthUser, @Body() dto: CreateConversationDto) { return this.app.createConversation(user, dto.title); }

  @ApiOperation({ summary: "List the caller's conversations", description: 'Newest first; deleted conversations are excluded. Only the authenticated user\'s conversations are ever returned.' })
  @ApiQuery({ name: 'search', required: false, description: 'Case-insensitive title filter.' })
  @ApiOkResponse({ type: [ConversationSummary] })
  @Get() list(@CurrentUser() user: AuthUser, @Query('search') search?: string) { return this.app.conversations(user, search); }

  @ApiOperation({ summary: 'Get a conversation with its messages' })
  @ConversationId() @ApiOkResponse({ type: ConversationDetail }) @NotFound('Conversation')
  @Get(':id') get(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.app.conversation(user, id); }

  @ApiOperation({ summary: 'Rename a conversation' })
  @ConversationId() @ApiOkResponse({ type: ConversationView }) @Invalid() @NotFound('Conversation')
  @Patch(':id') rename(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateConversationDto) { return this.app.renameConversation(user, id, dto.title); }

  @ApiOperation({ summary: 'Delete a conversation', description: 'Soft delete: hidden from the user, while usage records keep their references.' })
  @ConversationId() @ApiNoContentResponse({ description: 'Deleted.' }) @NotFound('Conversation')
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.app.deleteConversation(user, id); }

  @ApiOperation({
    summary: 'Send a message and stream the reply (SSE)',
    description: [
      'Persists the user message, routes the request through the AI gateway, and streams the reply as Server-Sent Events.',
      '',
      '- `event: token` — `data: {"text": "..."}`, repeated',
      '- `event: done` — `data: {"requestId": "...", "messageId": "..."}`',
      '- `event: error` — `data: {"message": "..."}` (provider errors after streaming began)',
      '',
      'Closing the connection cancels generation; the partial reply is kept as INTERRUPTED. Swagger UI shows the raw stream once it completes.',
    ].join('\n'),
  })
  @ConversationId() @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: 'SSE stream.', content: { 'text/event-stream': { schema: { type: 'string' }, example: 'event: token\ndata: {"text":"This is a mock AI response "}\n\nevent: token\ndata: {"text":"for local POC testing."}\n\nevent: done\ndata: {"requestId":"0b5c2a8e-4b0f-4d0e-9a51-7a3f3f1c2d10","messageId":"5f0f8a5e-0000-4000-8000-000000000001"}\n\n' } } })
  @ApiBadRequestResponse({ description: 'Validation failed, model disabled or unknown, or request ID already processed.', type: ErrorResponse })
  @ApiForbiddenResponse({ description: 'Model not permitted for this user, or external provider not explicitly enabled and configured.', type: ErrorResponse })
  @NotFound('Conversation')
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded, or the daily external-provider limit was reached (local models remain available).', type: ErrorResponse })
  @Post(':id/messages') stream(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SendMessageDto, @Res() response: Response) {
    return this.app.streamMessage(user, id, dto, response);
  }
}

@ApiTags('usage')
@Secured()
@Controller('usage')
export class UsageController {
  constructor(private readonly app: AppService) {}
  @ApiOperation({ summary: "The caller's usage, tokens, and costs", description: 'Actual, estimated, and simulated amounts are kept separate. Prompt and response content is never included.' })
  @ApiOkResponse({ type: MyUsageResponse })
  @Get('me') own(@CurrentUser() user: AuthUser) { return this.app.myUsage(user); }
}

@ApiTags('admin')
@Secured()
@ApiForbiddenResponse({ description: 'Caller does not have the ADMIN role.', type: ErrorResponse })
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly app: AppService) {}
  @ApiOperation({ summary: 'Aggregate usage and cost summary', description: 'Aggregates only; never returns conversation content. Includes the daily series and the external-provider guardrail status.' })
  @ApiOkResponse({ type: AdminSummary }) @Invalid()
  @Get('summary') summary(@Query() query: SummaryQueryDto) { return this.app.adminSummary(query); }

  @ApiOperation({ summary: 'Latest 100 audit entries', description: 'Model, permission, and pricing changes with before/after snapshots.' })
  @ApiOkResponse({ type: [AuditLogView] }) @Invalid()
  @Get('audit') audit(@Query() query: AuditQueryDto) { return this.app.auditLog(query.entityType); }

  @ApiOperation({ summary: 'Model registry with configuration and availability' })
  @ApiOkResponse({ type: [AdminModelView] })
  @Get('models') models() { return this.app.adminModels(); }

  @ApiOperation({ summary: 'Enable/disable a model or change its allowed roles (audited)' })
  @ApiParam({ name: 'id', example: 'google-gemini' }) @ApiOkResponse({ type: AIModelView })
  @ApiBadRequestResponse({ description: 'Validation failed, or an external model cannot be enabled without ENABLE_EXTERNAL_PROVIDERS=true and a credential.', type: ErrorResponse })
  @NotFound('Model')
  @Patch('models/:id') updateModel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateModelDto) { return this.app.updateModel(user, id, dto); }

  @ApiOperation({ summary: 'Users with roles and explicit model permissions' })
  @ApiOkResponse({ type: [AdminUserView] })
  @Get('users') users() { return this.app.users(); }

  @ApiOperation({ summary: 'Set an explicit per-user model permission (audited)', description: 'Overrides the model\'s role defaults for this user.' })
  @ApiParam({ name: 'userId', format: 'uuid' }) @ApiParam({ name: 'modelId', example: 'google-gemini' })
  @ApiOkResponse({ type: UserModelPermissionView }) @Invalid()
  @Patch('users/:userId/models/:modelId') permission(@CurrentUser() user: AuthUser, @Param('userId') userId: string, @Param('modelId') modelId: string, @Body() dto: UpdatePermissionDto) {
    return this.app.setModelPermission(user, userId, modelId, dto.allowed);
  }

  @ApiOperation({ summary: 'Pricing configurations with full version history' })
  @ApiQuery({ name: 'modelId', required: false, example: 'local-mock' })
  @ApiOkResponse({ type: [PricingConfigurationView] })
  @Get('pricing') pricing(@Query('modelId') modelId?: string) { return this.app.pricing(modelId); }

  @ApiOperation({ summary: 'Create a new immutable pricing version (audited)', description: 'Existing versions and historical usage snapshots never change. Local models must keep actual provider cost at 0.' })
  @ApiParam({ name: 'modelId', example: 'local-mock' }) @ApiCreatedResponse({ type: PricingVersionView })
  @ApiBadRequestResponse({ description: 'Validation failed, or a non-zero provider cost was set for a local model.', type: ErrorResponse })
  @NotFound('Model pricing')
  @Post('pricing/:modelId') updatePricing(@CurrentUser() user: AuthUser, @Param('modelId') modelId: string, @Body() dto: UpdatePricingDto) { return this.app.updatePricing(user, modelId, dto); }

  @ApiOperation({ summary: 'Preview a charge without saving', description: 'Actual and simulated results are reported separately. The example body reproduces the POC pricing example: 3,000 in / 700 out → $0 actual, $0.01 simulated provider cost, $0.015 simulated charge.' })
  @ApiCreatedResponse({ type: PriceResultView }) @Invalid()
  @Post('pricing/preview/calculate') preview(@Body() dto: PreviewPricingDto) { return this.app.calculatePreview(dto); }
}
