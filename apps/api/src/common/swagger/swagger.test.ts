import 'reflect-metadata';
import type { Type } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { SwaggerModule } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { AdminController } from '../../admin/admin.controller';
import { ConversationsController } from '../../conversations/conversations.controller';
import { HealthController } from '../../health/health.controller';
import { KnowledgeAdminController, KnowledgeController } from '../../knowledge/knowledge.controller';
import { ModelsController } from '../../models/models.controller';
import { UsageController } from '../../usage/usage.controller';
import { WorkspaceAdminController, WorkspaceController } from '../../workspace/workspace.controller';
import { IS_PUBLIC } from '../auth/auth.decorators';
import { BEARER_SCHEME, OAUTH_SCHEME, SWAGGER_CLIENT_ID, swaggerConfig, swaggerEnabled } from './swagger';

type Controller = Type<object>;
// @nestjs/swagger metadata keys (its constants module is not exported).
const DECORATORS = { API_OPERATION: 'swagger/apiOperation', API_RESPONSE: 'swagger/apiResponse', API_SECURITY: 'swagger/apiSecurity' };
const controllers: Controller[] = [HealthController, ModelsController, ConversationsController, UsageController, AdminController, WorkspaceController, WorkspaceAdminController, KnowledgeController, KnowledgeAdminController];
const routes = (controller: Controller) => Object.getOwnPropertyNames(controller.prototype).filter((name) => name !== 'constructor')
  .map((name) => ({ name: `${controller.name}.${name}`, handler: (controller.prototype as Record<string, unknown>)[name] as object }))
  .filter(({ handler }) => typeof handler === 'function' && Reflect.hasMetadata(PATH_METADATA, handler));

describe('OpenAPI documentation', () => {
  it('documents every route with a summary and at least one response', () => {
    const all = controllers.flatMap(routes);
    expect(all.length).toBeGreaterThan(40);
    for (const { name, handler } of all) {
      expect(Reflect.getMetadata(DECORATORS.API_OPERATION, handler)?.summary, name).toBeTruthy();
      expect(Object.keys(Reflect.getMetadata(DECORATORS.API_RESPONSE, handler) || {}), name).not.toHaveLength(0);
    }
  });

  it('marks only public routes as unauthenticated and offers PKCE login or a bearer token elsewhere', () => {
    for (const controller of controllers) {
      const security = (Reflect.getMetadata(DECORATORS.API_SECURITY, controller) || []).flatMap((entry: object) => Object.keys(entry));
      for (const { name, handler } of routes(controller)) {
        if (Reflect.getMetadata(IS_PUBLIC, handler)) {
          expect(Reflect.getMetadata(DECORATORS.API_OPERATION, handler).security, name).toEqual([]);
        } else {
          expect(security, name).toEqual(expect.arrayContaining([OAUTH_SCHEME, BEARER_SCHEME]));
        }
      }
    }
  });

  it('points the OAuth2 flow at the configured Keycloak realm', () => {
    const document = swaggerConfig({ KEYCLOAK_URL: 'http://idp.example', KEYCLOAK_REALM: 'acme' });
    const flow = (document.components?.securitySchemes?.[OAUTH_SCHEME] as { flows: { authorizationCode: { authorizationUrl: string; tokenUrl: string } } }).flows.authorizationCode;
    expect(flow.authorizationUrl).toBe('http://idp.example/realms/acme/protocol/openid-connect/auth');
    expect(flow.tokenUrl).toBe('http://idp.example/realms/acme/protocol/openid-connect/token');
    expect(document.components?.securitySchemes?.[BEARER_SCHEME]).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(SWAGGER_CLIENT_ID).toBe('enterprise-ai-swagger');
  });

  it('can be switched off for customer deployments', () => {
    expect(swaggerEnabled({})).toBe(true);
    expect(swaggerEnabled({ SWAGGER_ENABLED: 'false' })).toBe(false);
  });

  it('gives every schema property a concrete type', async () => {
    // Without an explicit `type`, union properties (`string | null`) are reflected as Object and documented as an empty object.
    const moduleRef = await Test.createTestingModule({ controllers }).useMocker(() => ({})).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    const document = SwaggerModule.createDocument(app, swaggerConfig({}));
    await app.close();
    const untyped = Object.entries(document.components?.schemas || {}).flatMap(([schema, value]) =>
      Object.entries((value as SchemaObject).properties || {})
        .filter(([, property]) => {
          const { type, properties, additionalProperties, allOf, oneOf, anyOf, $ref } = property as SchemaObject & { $ref?: string };
          return type === 'object' && !properties && !additionalProperties && !allOf && !oneOf && !anyOf && !$ref;
        })
        .map(([name]) => `${schema}.${name}`));
    expect(untyped).toEqual([]);
  });
});
