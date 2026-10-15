import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, type AuthUser } from "../common/auth/auth.decorators";
import { Secured } from "../common/swagger/api-docs.decorators";
import { LiveUsageResponse, MyUsageResponse } from "./usage.schemas";
import { UsageService } from "./usage.service";

@ApiTags("usage")
@Secured()
@Controller("usage")
export class UsageController {
  constructor(private readonly usage: UsageService) {}
  @ApiOperation({
    summary: "Live token-usage snapshot for the caller",
    description:
      "A lightweight polling response. Completed token counts and conservative in-flight reservations are reported separately; prompt and response content is never included.",
  })
  @ApiOkResponse({ type: LiveUsageResponse })
  @Get("me/live")
  live(@CurrentUser() user: AuthUser) {
    return this.usage.live(user);
  }
  @ApiOperation({
    summary: "The caller's usage, tokens, and costs",
    description:
      "Actual, estimated, and simulated amounts are kept separate. Prompt and response content is never included.",
  })
  @ApiOkResponse({ type: MyUsageResponse })
  @Get("me")
  own(@CurrentUser() user: AuthUser) {
    return this.usage.mine(user);
  }
}
