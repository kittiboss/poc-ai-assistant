import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuditQueryDto } from '../audit/audit.dto';
import { AuditLogView } from '../audit/audit.schemas';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, Roles, type AuthUser } from '../common/auth/auth.decorators';
import { Invalid, NotFound, Secured } from '../common/swagger/api-docs.decorators';
import { ErrorResponse } from '../common/swagger/schema-types';
import { UpdateModelDto } from '../models/models.dto';
import { AIModelView } from '../models/models.schemas';
import { ModelsService } from '../models/models.service';
import { PreviewPricingDto, UpdatePricingDto } from '../pricing/pricing.dto';
import { PriceResultView, PricingConfigurationView, PricingVersionView } from '../pricing/pricing.schemas';
import { PricingService } from '../pricing/pricing.service';
import { SummaryQueryDto, UpdatePermissionDto } from './admin.dto';
import { AdminModelView, AdminSummary, AdminUserView, UserModelPermissionView } from './admin.schemas';
import { AdminService } from './admin.service';

@ApiTags('admin')
@Secured()
@ApiForbiddenResponse({ description: 'Caller does not have the ADMIN role.', type: ErrorResponse })
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly auditLog: AuditService,
    private readonly registry: ModelsService,
    private readonly prices: PricingService,
  ) {}

  @ApiOperation({ summary: 'Aggregate usage and cost summary', description: 'Aggregates only; never returns conversation content. Includes the daily series and the external-provider guardrail status.' })
  @ApiOkResponse({ type: AdminSummary }) @Invalid()
  @Get('summary') summary(@Query() query: SummaryQueryDto) { return this.admin.summary(query); }

  @ApiOperation({ summary: 'Latest 100 audit entries', description: 'Model, permission, and pricing changes with before/after snapshots.' })
  @ApiOkResponse({ type: [AuditLogView] }) @Invalid()
  @Get('audit') audit(@Query() query: AuditQueryDto) { return this.auditLog.latest(query.entityType); }

  @ApiOperation({ summary: 'Model registry with configuration and availability' })
  @ApiOkResponse({ type: [AdminModelView] })
  @Get('models') models() { return this.registry.adminList(); }

  @ApiOperation({ summary: 'Enable/disable a model or change its allowed roles (audited)' })
  @ApiParam({ name: 'id', example: 'google-gemini' }) @ApiOkResponse({ type: AIModelView })
  @ApiBadRequestResponse({ description: 'Validation failed, or an external model cannot be enabled without ENABLE_EXTERNAL_PROVIDERS=true and a credential.', type: ErrorResponse })
  @NotFound('Model')
  @Patch('models/:id') updateModel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateModelDto) { return this.registry.update(user, id, dto); }

  @ApiOperation({ summary: 'Users with roles and explicit model permissions' })
  @ApiOkResponse({ type: [AdminUserView] })
  @Get('users') users() { return this.admin.listUsers(); }

  @ApiOperation({ summary: 'Set an explicit per-user model permission (audited)', description: 'Overrides the model\'s role defaults for this user.' })
  @ApiParam({ name: 'userId', format: 'uuid' }) @ApiParam({ name: 'modelId', example: 'google-gemini' })
  @ApiOkResponse({ type: UserModelPermissionView }) @Invalid({ id: true })
  @Patch('users/:userId/models/:modelId') permission(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) userId: string, @Param('modelId') modelId: string, @Body() dto: UpdatePermissionDto) {
    return this.admin.setModelPermission(user, userId, modelId, dto.allowed);
  }

  @ApiOperation({ summary: 'Pricing configurations with full version history' })
  @ApiQuery({ name: 'modelId', required: false, example: 'local-mock' })
  @ApiOkResponse({ type: [PricingConfigurationView] })
  @Get('pricing') pricing(@Query('modelId') modelId?: string) { return this.prices.list(modelId); }

  @ApiOperation({ summary: 'Create a new immutable pricing version (audited)', description: 'Existing versions and historical usage snapshots never change. Local models must keep actual provider cost at 0.' })
  @ApiParam({ name: 'modelId', example: 'local-mock' }) @ApiCreatedResponse({ type: PricingVersionView })
  @ApiBadRequestResponse({ description: 'Validation failed, or a non-zero provider cost was set for a local model.', type: ErrorResponse })
  @NotFound('Model pricing')
  @Post('pricing/:modelId') updatePricing(@CurrentUser() user: AuthUser, @Param('modelId') modelId: string, @Body() dto: UpdatePricingDto) { return this.prices.createVersion(user, modelId, dto); }

  @ApiOperation({ summary: 'Preview a charge without saving', description: 'Actual and simulated results are reported separately. The example body reproduces the POC pricing example: 3,000 in / 700 out → $0 actual, $0.01 simulated provider cost, $0.015 simulated charge.' })
  @ApiCreatedResponse({ type: PriceResultView }) @Invalid()
  @Post('pricing/preview/calculate') preview(@Body() dto: PreviewPricingDto) { return this.prices.preview(dto); }
}
