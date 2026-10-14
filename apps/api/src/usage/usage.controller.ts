import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../common/auth/auth.decorators';
import { Secured } from '../common/swagger/api-docs.decorators';
import { MyUsageResponse } from './usage.schemas';
import { UsageService } from './usage.service';

@ApiTags('usage')
@Secured()
@Controller('usage')
export class UsageController {
  constructor(private readonly usage: UsageService) {}
  @ApiOperation({ summary: "The caller's usage, tokens, and costs", description: 'Actual, estimated, and simulated amounts are kept separate. Prompt and response content is never included.' })
  @ApiOkResponse({ type: MyUsageResponse })
  @Get('me') own(@CurrentUser() user: AuthUser) { return this.usage.mine(user); }
}
