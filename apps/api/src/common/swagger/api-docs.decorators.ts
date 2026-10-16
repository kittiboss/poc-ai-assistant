import { applyDecorators } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiNotFoundResponse, ApiOAuth2, ApiParam, ApiTooManyRequestsResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
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
const MALFORMED_ID = 'Malformed ID: IDs must be UUIDs.';
/** `id`: the route also takes a UUID that ParseUUIDPipe checks. */
export const Invalid = (options: { id?: boolean } = {}) => ApiBadRequestResponse({
  description: options.id ? `${MALFORMED_ID} Or validation failed; unknown properties are rejected.` : 'Validation failed; unknown properties are rejected.',
  type: ErrorResponse,
});
export const MalformedId = () => ApiBadRequestResponse({ description: MALFORMED_ID, type: ErrorResponse });
/** A database UUID in the path. Pair it with ParseUUIDPipe so a malformed value is a 400, not a Prisma error (500). */
export const UuidParam = (name: string, description?: string) => ApiParam({ name, format: 'uuid', description });
