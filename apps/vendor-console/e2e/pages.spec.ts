import { ACME, expect, pageTitle, test } from './fixtures';

// Runs on desktop and on a phone (see playwright.config.ts).
for (const [path, title] of [
  ['/tenants', 'Tenants'],
  [`/tenants/${ACME.id}`, 'Tenants'],
  ['/usage', 'Usage'],
  ['/pricing', 'Pricing'],
]) {
  test(`${path} loads without sideways scrolling`, async ({ page }) => {
    await page.goto(path);
    await expect(pageTitle(page)).toHaveText(title);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => {
      const main = document.querySelector('main')!;
      return Math.max(document.documentElement.scrollWidth - window.innerWidth, main.scrollWidth - main.clientWidth);
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
