import { ACME, dialog, expect, pageTitle, test } from './fixtures';

// Phone only (see playwright.config.ts).

test('the menu opens in a drawer and moves between pages', async ({ page }) => {
  await page.goto('/tenants');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('link', { name: 'Pricing' }).click();
  await expect(pageTitle(page)).toHaveText('Pricing');
  await expect(page.getByRole('navigation', { name: 'Console' })).toBeHidden();
});

test('a dialog fits the screen', async ({ page }) => {
  await page.goto(`/tenants/${ACME.id}`);
  await page.getByRole('button', { name: 'Edit knowledge limits' }).click();
  await expect(dialog(page).getByText('Chunks in total')).toBeVisible();
  const box = (await dialog(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog(page)).toBeHidden();
});
