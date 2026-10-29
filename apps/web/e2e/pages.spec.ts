import { expect, test } from './fixtures';

// Runs on desktop and on a phone (see playwright.config.ts).
for (const path of [
  '/',
  '/usage',
  '/usage/live',
  '/admin',
  '/admin/models',
  '/admin/workspace',
  '/admin/activity',
  '/settings',
]) {
  test(`${path} loads without sideways scrolling`, async ({ page }) => {
    await page.goto(path);
    // The chat page's title sits in the header, the others in the page itself.
    await expect(page.locator('h1').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => {
      const main = document.querySelector('main')!;
      return Math.max(document.documentElement.scrollWidth - window.innerWidth, main.scrollWidth - main.clientWidth);
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
