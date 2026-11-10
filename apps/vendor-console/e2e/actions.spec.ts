import {
  ACME,
  dialog,
  expect,
  field,
  fieldError,
  openTab,
  refusal,
  sql,
  tenantById,
  test,
  toast,
  vendorControlUrl,
} from './fixtures';

// Every test changes a customer of its own (the `tenant` fixture), in the run's throwaway vendor-control.

test('grant credit checks the amount, then adds it to the ledger', async ({ page, tenant }) => {
  await page.goto(`/tenants/${tenant.id}`);
  await page.getByRole('button', { name: 'Grant credit' }).click();
  await expect(field(page, 'Amount (USD)')).toHaveValue('2');
  for (const [value, message] of [
    ['abc', 'Use a number'],
    ['0', 'more than $0'],
    ['20000', 'at most $10,000.00'],
    ['1.0000000001', 'Use a number'],
  ]) {
    await field(page, 'Amount (USD)').fill(value);
    await expect(fieldError(page, message)).toBeVisible();
  }
  await field(page, 'Amount (USD)').fill('1.5');
  await dialog(page).getByRole('button', { name: 'Grant', exact: true }).click();
  await expect(toast(page, `+$1.50 test credit granted to ${tenant.name}`)).toBeVisible();
  await expect(dialog(page)).toBeHidden();

  expect((await tenantById(tenant.id))?.credit.remaining).toBe(3.5);
  await expect(page.getByText('$3.50').first()).toBeVisible();
  await expect(openTab(page).getByRole('row', { name: /Top-up/ })).toContainText('+$1.50');
});

test.describe('a grant vendor-control refuses', () => {
  test.use({ expectedErrors: [/status of 409/] });

  test('keeps the dialog open with the reason', async ({ page, tenant }) => {
    await page.route(`${vendorControlUrl()}/admin/tenants/${tenant.id}/credits`, (route) =>
      route.fulfill(refusal(409, 'Reference already used for a different transaction')),
    );
    await page.goto(`/tenants/${tenant.id}`);
    await page.getByRole('button', { name: 'Grant credit' }).click();
    await field(page, 'Amount (USD)').fill('5');
    await dialog(page).getByRole('button', { name: 'Grant', exact: true }).click();
    await expect(dialog(page).getByText('Reference already used')).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    // Opened again, it starts from its defaults rather than the last amount.
    await page.getByRole('button', { name: 'Grant credit' }).click();
    await expect(field(page, 'Amount (USD)')).toHaveValue('2');
    expect((await tenantById(tenant.id))?.credit.remaining).toBe(2);
  });
});

test('suspend and resume after a confirmation', async ({ page, tenant }) => {
  await page.goto(`/tenants/${tenant.id}`);
  await page.getByRole('button', { name: 'Suspend' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Suspend' }).click();
  await expect(toast(page, 'is suspended')).toBeVisible();
  await expect(page.getByText('The gateway refuses this tenant')).toBeVisible();
  expect((await tenantById(tenant.id))?.enabled).toBe(false);

  await page.getByRole('button', { name: 'Resume' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Resume' }).click();
  await expect(toast(page, 'is active again')).toBeVisible();
  expect((await tenantById(tenant.id))?.enabled).toBe(true);
});

test('settle stale reservations charges what was held, as an estimate', async ({ page, tenant }) => {
  // A request admitted 10 minutes ago that never finished.
  sql(
    `INSERT INTO vendor.requests(tenant,request_id,model,kind,price_id,reserved,created_at)
     SELECT '${tenant.id}','stale-1','local-mock','CHAT',id,1000000,now()-interval '10 minutes'
     FROM vendor.prices WHERE model='local-mock' ORDER BY id DESC LIMIT 1`,
  );
  await page.goto(`/tenants/${tenant.id}`);
  await page.getByRole('button', { name: 'More actions' }).click();
  const settle = page.getByRole('menuitem', { name: /Settle stale reservations/ });
  await expect(settle).toContainText('1 running');
  await settle.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Settle' }).click();
  await expect(toast(page, /settled/i)).toBeVisible();

  expect(sql(`SELECT state FROM vendor.requests WHERE tenant='${tenant.id}' AND request_id='stale-1'`)).toBe(
    'ESTIMATED',
  );
  await expect(openTab(page).getByRole('row', { name: /Estimated charge/ })).toContainText('−$0.001');
  await page.getByRole('tab', { name: 'Requests' }).click();
  await expect(openTab(page).getByRole('row', { name: /stale-1/ })).toContainText('Estimated');
});

test('settling is offered only while requests are running', async ({ page, tenant }) => {
  await page.goto(`/tenants/${tenant.id}`);
  await page.getByRole('button', { name: 'More actions' }).click();
  await expect(page.getByRole('menuitem', { name: /Settle stale reservations/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
});

test('rotating the gateway credential points to the vendor host', async ({ page }) => {
  await page.goto(`/tenants/${ACME.id}`);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Rotate gateway credential' }).click();
  await expect(page.getByRole('dialog')).toContainText(`npm run tenant:rotate -- ${ACME.id}`);
  await page.getByRole('dialog').getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
});
