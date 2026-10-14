import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const OAUTH_SCHEME = 'keycloak';
export const BEARER_SCHEME = 'bearer';
export const SWAGGER_CLIENT_ID = 'enterprise-ai-swagger';
export const DOCS_PATH = 'api/docs';

/** Interactive docs are on for the local POC; set SWAGGER_ENABLED=false for customer deployments. */
export function swaggerEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.SWAGGER_ENABLED !== 'false';
}

export function swaggerConfig(env: NodeJS.ProcessEnv = process.env) {
  const oidc = `${env.KEYCLOAK_URL || 'http://localhost:8080'}/realms/${env.KEYCLOAK_REALM || 'enterprise-ai'}/protocol/openid-connect`;
  return new DocumentBuilder()
    .setTitle('Enterprise AI Assistant API')
    .setVersion('0.1.0')
    .setDescription([
      'REST and Server-Sent Events API for the self-hosted Enterprise AI Assistant POC.',
      '',
      '**Sign in:** click **Authorize**, choose `keycloak (OAuth2, authorizationCode)`, leave the client secret empty, and sign in through Keycloak (local demo users: `admin` / `Admin123!`, `employee1` / `Employee123!`). Swagger UI uses Authorization Code + PKCE with the public `enterprise-ai-swagger` client. Alternatively paste an access token into `bearer`.',
      '',
      'Every route except `/api/health` requires a valid access token for the `enterprise-ai-api` audience; `/api/admin/*` also requires the `ADMIN` role. Conversation ownership comes from the token subject, never from request data.',
      '',
      '**Cost:** `POST /api/conversations/{id}/messages` with an external model (e.g. `google-gemini`) calls that provider. The default stack only has local models, and external use is bounded by the daily limits in `GET /api/admin/summary`.',
    ].join('\n'))
    .addOAuth2({
      type: 'oauth2',
      description: 'Keycloak Authorization Code flow with PKCE (client `enterprise-ai-swagger`, no secret).',
      flows: { authorizationCode: { authorizationUrl: `${oidc}/auth`, tokenUrl: `${oidc}/token`, scopes: { openid: 'OpenID Connect sign-in' } } },
    }, OAUTH_SCHEME)
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Keycloak access token with audience enterprise-ai-api.' }, BEARER_SCHEME)
    .build();
}

export function setupSwagger(app: INestApplication, env: NodeJS.ProcessEnv = process.env) {
  const publicApi = (env.API_PUBLIC_URL || 'http://localhost:3001').replace(/\/$/, '');
  SwaggerModule.setup(DOCS_PATH, app, () => SwaggerModule.createDocument(app, swaggerConfig(env)), {
    // JSON only: the YAML variant is not needed, so its serializer is never exercised.
    raw: ['json'],
    jsonDocumentUrl: `${DOCS_PATH}-json`,
    customSiteTitle: 'Enterprise AI API',
    swaggerOptions: {
      oauth2RedirectUrl: `${publicApi}/${DOCS_PATH}/oauth2-redirect.html`,
      initOAuth: { clientId: SWAGGER_CLIENT_ID, usePkceWithAuthorizationCodeGrant: true, scopes: ['openid'] },
      persistAuthorization: false,
      displayRequestDuration: true,
    },
  });
}
