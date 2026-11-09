import type { Price } from '../lib/api/types';
import { admin, dialog, expect, field, fieldError, test, toast } from './fixtures';

// Price versions are global, so these tests run one after the other; they only touch google-gemini and
// mock-embedding, which the other tests do not read prices of.
test.describe.configure({ mode: 'serial' });

const current = async (model: string) => (await admin<Price[]>('/prices')).find((p) => p.model === model)!;

test('a marked-up version previews exactly the sale price vendor-control stores', async ({ page }) => {
  const before = await current('google-gemini');
  await page.goto('/pricing');
  await page.getByRole('button', { name: 'New price version of google-gemini' }).click();
  // The form starts from the current version.
  await expect(field(page, 'Sale input price')).toHaveValue(before.inputRate.replace(/\.?0+$/, ''));

  await field(page, 'Sale output price').fill('0');
  await expect(fieldError(page, 'more than $0')).toBeVisible();
  await dialog(page).getByText('Markup on cost').click();
  await field(page, 'Simulated input cost').fill('0');
  await expect(fieldError(page, 'gives a $0 sale price')).toBeVisible();

  // 1.666666667 × 1.5 = 2.5000000005, rounded up to the next billionth.
  await field(page, 'Simulated input cost').fill('0.2');
  await field(page, 'Simulated output cost').fill('1.666666667');
  await field(page, 'Markup').fill('50');
  const preview = dialog(page).locator('p[aria-live]');
  await expect(preview).toContainText('$0.30 input · $2.500000001 output');
  await dialog(page).getByRole('button', { name: 'Save version' }).click();
  await expect(toast(page, /google-gemini v\d+ saved/)).toBeVisible();

  const saved = await current('google-gemini');
  expect(Number(saved.id)).toBeGreaterThan(Number(before.id));
  expect(saved).toMatchObject({ strategy: 'PERCENTAGE_MARKUP', markupPercent: 50 });
  expect([saved.inputRate, saved.outputRate]).toEqual(['0.300000000', '2.500000001']);
  await expect(page.getByRole('row', { name: new RegExp(`^google-gemini v${saved.id}`) }).first()).toBeVisible();
});

test('an embedding model may sell its output at $0', async ({ page }) => {
  const before = await current('mock-embedding');
  await page.goto('/pricing');
  await page.getByRole('button', { name: 'New price version of mock-embedding' }).click();
  await expect(field(page, 'Sale input price')).toHaveValue(before.inputRate.replace(/\.?0+$/, ''));
  await field(page, 'Sale output price').fill('0');
  await dialog(page).getByRole('button', { name: 'Save version' }).click();
  await expect(toast(page, /mock-embedding v\d+ saved/)).toBeVisible();
  expect((await current('mock-embedding')).outputRate).toBe('0.000000000');
});
