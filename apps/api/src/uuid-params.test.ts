import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminController } from './admin/admin.controller';
import { ConversationsController } from './conversations/conversations.controller';
import { WorkspaceAdminController, WorkspaceController } from './workspace/workspace.controller';

// Every service method is this spy, so a request that reaches a handler is visible.
const serviceCall = vi.fn();
const service = new Proxy({}, { get: (_, key) => (key === 'then' || typeof key === 'symbol' ? undefined : serviceCall) });

let app: INestApplication;
let base: string;
const send = (method: string, path: string) =>
  fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ConversationsController, WorkspaceController, WorkspaceAdminController, AdminController],
  })
    // Only services: ParseUUIDPipe's optional `options` must stay unresolved, as in the app.
    .useMocker((token) => (typeof token === 'function' && token.name.endsWith('Service') ? service : undefined))
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/api`.replace('[::1]', '127.0.0.1');
});
afterAll(() => app?.close());
beforeEach(() => serviceCall.mockClear());

describe('UUID path parameters', () => {
  // Malformed IDs used to reach Prisma, which rejects them for @db.Uuid columns and surfaced as 500.
  const bad = 'not-a-uuid';
  const id = randomUUID();
  it.each([
    ['GET', `/conversations/${bad}`],
    ['PATCH', `/conversations/${bad}`],
    ['DELETE', `/conversations/${bad}`],
    ['POST', `/conversations/${bad}/messages`],
    ['POST', `/conversations/${bad}/branch`],
    ['POST', `/conversations/${bad}/tools`],
    ['POST', `/conversations/${bad}/messages/${id}/feedback`],
    ['POST', `/conversations/${id}/messages/${bad}/feedback`],
    ['GET', `/conversations?projectId=${bad}`],
    ['PATCH', `/workspace/projects/${bad}`],
    ['DELETE', `/workspace/projects/${bad}`],
    ['POST', `/workspace/projects/${bad}/sources`],
    ['GET', `/workspace/sources/${bad}`],
    ['DELETE', `/workspace/sources/${bad}`],
    ['PATCH', `/workspace/memories/${bad}`],
    ['DELETE', `/workspace/memories/${bad}`],
    ['DELETE', `/admin/workspace/quotas/${bad}`],
    ['PATCH', `/admin/workspace/users/${bad}`],
    ['PATCH', `/admin/workspace/templates/${bad}`],
    ['PATCH', `/admin/users/${bad}/models/local-mock`],
  ])('%s %s is rejected with 400 before the service runs', async (method, path) => {
    const response = await send(method, path);
    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe('Validation failed (uuid is expected)');
    expect(serviceCall).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', `/conversations/${id}`],
    ['GET', '/conversations'],
    // Model IDs are slugs, not UUIDs.
    ['PATCH', `/admin/users/${id}/models/local-mock`],
  ])('%s %s still reaches the service', async (method, path) => {
    const response = await send(method, path);
    expect(response.status).toBeLessThan(300);
    expect(serviceCall).toHaveBeenCalled();
  });
});
