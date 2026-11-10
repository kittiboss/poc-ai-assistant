import { ACME, expect, refusal, test, vendorControlUrl } from './fixtures';

test.describe('vendor-control unreachable', () => {
  test.use({ expectedErrors: [/net::ERR_/] });

  test('says so and offers a retry', async ({ page }) => {
    await page.route(`${vendorControlUrl()}/**`, (route) => route.abort('connectionrefused'));
    await page.goto('/tenants');
    const alert = page.locator('main [role=alert]');
    // The list is retried a few times first.
    await expect(alert).toContainText("vendor-control can't be reached", { timeout: 30_000 });
    await page.unroute(`${vendorControlUrl()}/**`);
    await alert.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('link', { name: new RegExp(ACME.name) })).toBeVisible();
  });
});

test.describe('the RAG engine unavailable', () => {
  test.use({ expectedErrors: [/status of 503/] });

  test('keeps the knowledge limits and says why usage is missing', async ({ page }) => {
    await page.route(`${vendorControlUrl()}/admin/rag/usage`, (route) =>
      route.fulfill(refusal(503, 'RAG engine is unavailable')),
    );
    await page.goto(`/tenants/${ACME.id}`);
    await expect(page.getByText('Current usage is unavailable: RAG engine is unavailable')).toBeVisible();
    await expect(page.locator('dt:text-is("Documents") + dd')).toContainText('— /');
  });
});
