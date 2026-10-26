import type { Page } from '@playwright/test';
import { localeLabels } from '../i18n/config';
import { expect, messages, test } from './fixtures';

/** Page and AntD backgrounds, to see that Tailwind and AntD switch theme together. */
const backgrounds = (page: Page) =>
  page.evaluate(() => ({
    body: getComputedStyle(document.body).backgroundColor,
    card: getComputedStyle(document.querySelector('.ant-card')!).backgroundColor,
  }));

test('applies the theme chosen in Settings and keeps it after a reload', async ({ page, m }) => {
  await page.goto('/settings');
  const theme = page.getByLabel(m.theme.label);
  const html = page.locator('html');
  await theme.getByText(m.theme.light).click();
  await expect(html).not.toHaveClass(/\bdark\b/);
  const light = await backgrounds(page);

  await theme.getByText(m.theme.dark).click();
  await expect(html).toHaveClass(/\bdark\b/);
  const dark = await backgrounds(page);
  expect(dark.body).not.toBe(light.body);
  expect(dark.card).not.toBe(light.card);

  await page.reload();
  await expect(html).toHaveClass(/\bdark\b/);

  // System follows the device setting.
  await theme.getByText(m.theme.system).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html).toHaveClass(/\bdark\b/);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(html).not.toHaveClass(/\bdark\b/);
});

test('switches language in Settings and keeps it after a reload', async ({ page, m }) => {
  const th = messages.th;
  await page.goto('/settings');
  await page.getByLabel(m.language.label).getByText(localeLabels.th).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'th');
  await expect(page.getByRole('heading', { name: th.settings.title })).toBeVisible();
  await expect(page.getByRole('button', { name: th.nav.accountMenu })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: th.settings.title })).toBeVisible();

  await page.getByLabel(th.language.label).getByText(localeLabels.en).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: m.settings.title })).toBeVisible();
});
