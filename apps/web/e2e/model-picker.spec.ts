import type { Page } from '@playwright/test';
import type { Model, ModelUsage } from '../lib/api/types';
import { CHAT_PATH, chatId, expect, modelField, sendPrompt, test } from './fixtures';

type Meter = ModelUsage['external']['tokens'];

const meter = (used: number, limit: number | null = null): Meter => ({ used, reserved: 0, limit });

const model = (
  id: string,
  displayName: string,
  provider: Model['provider'],
  local: boolean,
  status: Model['status'] = 'Available',
): Model => ({
  id,
  displayName,
  provider,
  providerModelId: id,
  enabled: true,
  permitted: true,
  available: status === 'Available',
  local,
  contextWindow: 8192,
  capabilities: [],
  status,
});

/** One model of each kind the picker tells apart. */
const models: Model[] = [
  { ...model('local-mock', 'Local Mock', 'MOCK', true), capabilities: ['vision'] },
  model('e2e-quota', 'Quota Local', 'OLLAMA', true),
  model('e2e-down', 'Down Local', 'OLLAMA', true, 'Unavailable'),
  model('e2e-shared', 'Shared External', 'GEMINI', false),
  model('e2e-full', 'Full External', 'GROQ', false, 'Daily limit reached'),
];

const row = (index: number, requests: Meter, tokens: Meter): ModelUsage['models'][number] => {
  const { id, displayName, provider, local } = models[index];
  return { modelId: id, displayName, provider, local, external: !local, requests, tokens };
};

const resetsAt = new Date(Date.now() + 6 * 3600_000).toISOString();
const usage: ModelUsage = {
  updatedAt: new Date().toISOString(),
  pollAfterMs: 60_000,
  resetsAt,
  // 10,000 tokens are left of what every external model shares.
  external: { requests: meter(10, 1000), tokens: meter(20_000, 30_000) },
  models: [
    row(0, meter(12), meter(3_400)),
    // Its own quota: 8 requests left.
    row(1, meter(42, 50), meter(9_000)),
    row(2, meter(0), meter(0)),
    row(3, meter(8), meter(2_000)),
    // Its own quota is used up: that is why it cannot be used.
    row(4, meter(100, 100), meter(18_000)),
  ],
};

/** Serves the models and today's usage above in place of the real ones. */
async function serveModels(page: Page) {
  await page.route('**/api/models', (route) => route.fulfill({ json: models }));
  await page.route('**/api/usage/models', (route) => route.fulfill({ json: usage }));
  await page.reload();
}

/** A message's text with its {placeholders} filled in. */
const fill = (text: string, values: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`);

const option = (page: Page, name: string) => page.getByRole('option', { name: new RegExp(`^${name}`) });
const ring = '.ant-progress';

test('each model says in two short lines where it runs, what it reads, its provider and what is left today', async ({
  page,
  m,
}) => {
  const u = m.modelUsage;
  await serveModels(page);
  await modelField(page, m).click();

  // Usable: no status, only what tells the models apart. Today's counts are in the hover text.
  const mock = option(page, 'Local Mock');
  await expect(mock).toContainText(m.enums.location.LOCAL);
  await expect(mock).toContainText(m.chat.readsImages);
  await expect(mock).toContainText('MOCK');
  await expect(mock).toContainText(u.shortNoLimit);
  await expect(mock).not.toContainText(m.enums.modelStatus.available);
  await expect(mock.getByTitle(fill(u.noLimit, { requests: '12', tokens: '3,400' }))).toBeVisible();
  await expect(mock.locator(ring)).toHaveCount(0);

  // A limit: a ring and what is left of it, the whole sentence on hover.
  const quota = option(page, 'Quota Local');
  await expect(quota).not.toContainText(m.chat.readsImages);
  await expect(quota).toContainText(fill(u.shortRequests, { left: '8' }));
  await expect(quota.getByTitle(`${fill(u.requests, { left: '8', limit: '50' })} · ${u.modelLimit}`)).toBeVisible();
  await expect(quota.locator(ring)).toHaveCount(1);

  const shared = option(page, 'Shared External');
  await expect(shared).toContainText(m.enums.location.EXTERNAL);
  await expect(shared).toContainText(`${fill(u.shortTokens, { left: '10,000' })} · ${u.shortShared}`);
  const sharedSentence = fill(u.sharedTokens, { part: '2,000', left: '10,000', limit: '30,000' });
  await expect(shared.getByTitle(sharedSentence)).toBeVisible();

  // Not usable: says why, with the ring only when its limit is the reason.
  const down = option(page, 'Down Local');
  await expect(down).toHaveAttribute('aria-disabled', 'true');
  await expect(down).toContainText(m.enums.modelStatus.unavailable);
  await expect(down.locator(ring)).toHaveCount(0);
  const full = option(page, 'Full External');
  await expect(full).toHaveAttribute('aria-disabled', 'true');
  await expect(full).toContainText(m.enums.modelStatus.dailyLimitReached);
  await expect(full.locator(ring)).toHaveCount(1);
});

test.describe('after a quota refuses a message', () => {
  // The refusal is a 429 response, which the browser logs.
  test.use({ expectedErrors: [/status of 429/] });

  test('the model it was refused on says what is left and what the message needed', async ({
    page,
    m,
    createdChats,
  }) => {
    await serveModels(page);
    // The shared external limit refuses every message.
    await page.route('**/api/conversations/*/messages', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({
            status: 429,
            json: {
              statusCode: 429,
              code: 'QUOTA_EXCEEDED',
              message: 'Daily token limit reached',
              quota: {
                scope: 'INSTALLATION',
                subject: 'external',
                unit: 'tokens',
                period: 'day',
                limit: 30_000,
                used: 20_000,
                needed: 14_000,
                resetsAt,
              },
            },
          })
        : route.fallback(),
    );
    await modelField(page, m).click();
    await option(page, 'Shared External').click();
    await sendPrompt(page, m, 'A message the shared limit refuses');
    await expect(page).toHaveURL(CHAT_PATH);
    createdChats.add(chatId(page));

    // The whole reason is above the composer; the picker keeps it short, with the sentence on hover.
    await expect(page.getByRole('alert').filter({ hasText: '14,000' }).filter({ hasText: '10,000' })).toBeVisible();
    await modelField(page, m).click();
    const shared = option(page, 'Shared External');
    await expect(shared).toContainText(fill(m.modelUsage.shortNeeded, { left: '10,000', needed: '14,000' }));
    await expect(shared.getByTitle(fill(m.modelUsage.lastNeeded, { needed: '14,000' }))).toBeVisible();
  });
});
