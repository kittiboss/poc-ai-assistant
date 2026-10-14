import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../common/auth/auth.decorators';
import { Secured } from '../common/swagger/api-docs.decorators';
import { ModelView } from './models.schemas';
import { ModelsService } from './models.service';

@ApiTags('models')
@Secured()
@Controller('models')
export class ModelsController {
  constructor(private readonly models: ModelsService) {}
  @ApiOperation({ summary: 'List models for the caller', description: 'Includes permission, configuration, daily-limit, and availability status. Availability reads gateway configuration only and never calls a paid provider.' })
  @ApiOkResponse({ type: [ModelView] })
  @Get() list(@CurrentUser() user: AuthUser) { return this.models.forUser(user); }
}
