import { test as plain, type Page } from '@playwright/test';
import { MODEL_RECHECK_MS, recheckAfter, recheckHelps } from '../features/chat/model-recheck';
import type { Model } from '../lib/api/types';
import { composer, expect, sendButton, test } from './fixtures';

type Status = Model['status'];

/**
 * Serves the real model list, with every model as `status` and unusable on the first `times` requests;
 * returns how many requests reached it.
 */
async function serveModels(page: Page, status: Status, times: number) {
  const requests = { count: 0 };
  await page.route('**/api/models', async (route) => {
    requests.count += 1;
    const response = await route.fetch();
    const models: Model[] = await response.json();
    const json = requests.count <= times ? models.map((model) => ({ ...model, available: false, status })) : models;
    await route.fulfill({ response, json });
  });
  await page.reload();
  return requests;
}

plain('the model list is checked again only while waiting can help, less often each time', () => {
  const model = (available: boolean, status: Status) => ({ available, status });
  expect(recheckHelps([model(false, 'Unavailable'), model(false, 'Not configured')])).toBe(true);
  // A model that can be used, even next to an unreachable one, needs no check.
  expect(recheckHelps([model(true, 'Available'), model(false, 'Unavailable')])).toBe(false);
  for (const status of ['Credit exhausted', 'Daily limit reached', 'Not permitted', 'Disabled'] as const)
    expect(recheckHelps([model(false, status)])).toBe(false);
  expect(recheckHelps([])).toBe(false);

  expect([1, 2, 3, 4, 5, 6, 100].map(recheckAfter)).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000, 60_000]);
  expect(Math.max(...MODEL_RECHECK_MS)).toBe(60_000);
});

test('a model list that was unreachable for a moment comes back by itself, and checks stop', async ({ page, m }) => {
  const requests = await serveModels(page, 'Unavailable', 1);
  await composer(page, m).fill('Hello');
  await expect(page.getByText(m.chat.emptyBody.replace('{count}', '0'))).toBeVisible();
  await expect(sendButton(page, m)).toBeDisabled();

  // The first check comes 5 seconds later, and finds the models.
  await expect.poll(() => requests.count, { timeout: MODEL_RECHECK_MS[0] * 2 }).toBe(2);
  await expect(sendButton(page, m)).toBeEnabled();
  await expect(page.getByText(m.chat.emptyBody.replace('{count}', '0'))).toHaveCount(0);
  expect(requests.count).toBe(2);
  await page.waitForTimeout(MODEL_RECHECK_MS[0] + 1_000);
  expect(requests.count).toBe(2);
});

test('models that waiting cannot help are not checked again', async ({ page, m }) => {
  const requests = await serveModels(page, 'Credit exhausted', Infinity);
  await expect(page.getByText(m.chat.emptyBody.replace('{count}', '0'))).toBeVisible();
  await page.waitForTimeout(MODEL_RECHECK_MS[0] + 1_000);
  expect(requests.count).toBe(1);
});
