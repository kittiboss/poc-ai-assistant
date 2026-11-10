import { ACME, expect, fact, openTab, pageTitle, test } from './fixtures';

// Read-only views of the seeded customer; tests that change a customer use their own (see actions.spec.ts).

test('the tenant list shows each deployment with its credit', async ({ page }) => {
  await page.goto('/tenants');
  await expect(pageTitle(page)).toHaveText('Tenants');
  const row = page.getByRole('row', { name: new RegExp(ACME.name) });
  await expect(row).toContainText(ACME.id);
  await expect(row).toContainText('Active');
  await expect(row).toContainText('$2.00');
});

test('a tenant page shows its credit, plan, limits and ledger', async ({ page }) => {
  await page.goto('/tenants');
  await page.getByRole('link', { name: new RegExp(ACME.name) }).click();
  await expect(page).toHaveURL(new RegExp(`/tenants/${ACME.id}$`));
  await expect(page.getByRole('heading', { name: ACME.name })).toBeVisible();

  await expect(page.getByText('Available for new requests')).toBeVisible();
  await expect(fact(page, 'Granted in total')).toHaveText('$2.00');
  await expect(fact(page, 'Requests')).toHaveText('0');
  await expect(fact(page, 'Web / API port')).toHaveText(`${ACME.webPort} / ${ACME.apiPort}`);
  // Knowledge usage comes from the RAG engine (a stub in these tests: 3 documents, 1.5 MB, 120 chunks).
  await expect(fact(page, 'Documents')).toContainText('3 /');
  await expect(fact(page, 'Extracted text (MB)')).toContainText('1.50 /');
  await expect(fact(page, 'Chunks')).toContainText('120 /');
  await expect(fact(page, 'Images per chat')).toHaveText('6');

  await expect(page.getByRole('tab', { name: 'Credit history' })).toHaveAttribute('aria-selected', 'true');
  const opening = openTab(page).getByRole('row', { name: /Opening credit/ });
  await expect(opening).toContainText(/SIM-/);
  await expect(opening).toContainText('+$2.00');
  await page.getByRole('tab', { name: 'Requests' }).click();
  await expect(openTab(page).getByText('No requests')).toBeVisible();
});

test('a tenant that does not exist says so', async ({ page }) => {
  await page.goto('/tenants/nope');
  await expect(page.getByText('No such tenant')).toBeVisible();
  await page.getByRole('button', { name: /All tenants/ }).click();
  await expect(page).toHaveURL(/\/tenants$/);
});

test('usage lists every deployment and links to it', async ({ page }) => {
  await page.goto('/usage');
  await expect(pageTitle(page)).toHaveText('Usage');
  await page.getByRole('link', { name: new RegExp(`${ACME.name} · ${ACME.id}`) }).click();
  await expect(page).toHaveURL(new RegExp(`/tenants/${ACME.id}$`));
});

test('pricing shows the current version of each model and the history', async ({ page }) => {
  await page.goto('/pricing');
  const current = page.locator('.ant-card').filter({ hasText: 'Current prices' });
  for (const model of ['local-mock', 'mock-embedding', 'google-gemini'])
    await expect(current.getByRole('row', { name: new RegExp(`^${model} v\\d+`) })).toBeVisible();
  await expect(
    page.locator('.ant-card').filter({ hasText: 'Version history' }).locator('tr.ant-table-row').first(),
  ).toBeVisible();
});
