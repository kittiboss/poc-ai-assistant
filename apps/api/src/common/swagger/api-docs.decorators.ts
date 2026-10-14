import { applyDecorators } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiNotFoundResponse, ApiOAuth2, ApiTooManyRequestsResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { ErrorResponse } from './schema-types';
import { BEARER_SCHEME, OAUTH_SCHEME } from './swagger';

/** Every non-public route: Keycloak access token (via Swagger's PKCE login or a pasted bearer token), plus the global rate limit. */
export const Secured = () => applyDecorators(
  ApiOAuth2(['openid'], OAUTH_SCHEME),
  ApiBearerAuth(BEARER_SCHEME),
  ApiUnauthorizedResponse({ description: 'Missing, expired, or invalid access token (signature, issuer, audience).', type: ErrorResponse }),
  ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (60 requests per minute).', type: ErrorResponse }),
);
export const NotFound = (what: string) => ApiNotFoundResponse({ description: `${what} does not exist or is not visible to the caller.`, type: ErrorResponse });
export const Invalid = () => ApiBadRequestResponse({ description: 'Validation failed; unknown properties are rejected.', type: ErrorResponse });
