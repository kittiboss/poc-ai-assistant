import { expect, test } from './fixtures';

// The desktop project only; mobile.spec.ts covers the filter drawer on a phone.

test('the admin console has a tab for each part, each with its own URL', async ({ page, m }) => {
  await page.goto('/admin');
  const tabs = page.getByRole('navigation', { name: m.admin.tabs.label });
  await expect(tabs.getByRole('link', { name: m.admin.tabs.overview })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('radiogroup', { name: m.admin.filters.range })).toBeVisible();

  const parts = [
    { tab: m.admin.tabs.models, path: '/admin/models', card: m.admin.registry.title },
    { tab: m.admin.tabs.workspace, path: '/admin/workspace', card: m.admin.workspace.quotas.title },
    { tab: m.admin.tabs.activity, path: '/admin/activity', card: m.admin.audit.title },
  ];
  for (const { tab, path, card } of parts) {
    await tabs.getByRole('link', { name: tab }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(tabs.getByRole('link', { name: tab })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: card })).toBeVisible();
    // The filters belong to the overview only.
    await expect(page.getByRole('radiogroup', { name: m.admin.filters.range })).toHaveCount(0);
  }
});

test('the overview filters start at the last 30 days and live in the URL', async ({ page, m }) => {
  const f = m.admin.filters;
  await page.goto('/admin');
  const range = page.getByRole('radiogroup', { name: f.range });
  const summary = page.getByText(f.summary.split('{')[0].trim());
  await expect(range.getByRole('radio', { name: f.ranges['30d'] })).toBeChecked();
  await expect(summary).toContainText(f.allProviders);
  await expect(summary).toContainText(f.allModels);

  await range.getByText(f.ranges['7d']).click();
  await expect(page).toHaveURL(/\/admin\?range=7d$/);
  await page.getByRole('combobox', { name: f.provider }).click();
  // AntD's role="option" elements are a hidden list for screen readers; the visible items carry a title.
  await page.locator('.ant-select-dropdown').getByTitle('MOCK', { exact: true }).click();
  await expect(page).toHaveURL(/\/admin\?range=7d&provider=MOCK$/);
  await expect(summary).toContainText('MOCK');

  // A reload keeps them, and Back steps through them.
  await page.reload();
  await expect(range.getByRole('radio', { name: f.ranges['7d'] })).toBeChecked();
  await expect(summary).toContainText('MOCK');
  await page.goBack({ waitUntil: 'commit' });
  await expect(page).toHaveURL(/\/admin\?range=7d$/);
  await expect(summary).toContainText(f.allProviders);

  // Custom starts from the dates the preset showed.
  await range.getByText(f.ranges.custom).click();
  await expect(page).toHaveURL(/\/admin\?range=custom&from=\d{4}-\d\d-\d\d&to=\d{4}-\d\d-\d\d$/);
  await expect(page.getByLabel(f.from, { exact: true })).not.toHaveValue('');
  await expect(page.getByLabel(f.to, { exact: true })).not.toHaveValue('');

  await page.getByRole('button', { name: f.reset }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(range.getByRole('radio', { name: f.ranges['30d'] })).toBeChecked();
});
