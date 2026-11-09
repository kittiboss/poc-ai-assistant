import { ACME, dialog, expect, field, fieldError, tenantById, test } from './fixtures';

// Registers `beta` in the run's throwaway vendor-control; the next run starts from an empty one again.
test('registering a deployment checks its ID, name and ports, then names the host command', async ({ page }) => {
  await page.goto('/tenants');
  await page.getByRole('button', { name: 'Register deployment' }).click();
  // After the highest web port in use (at least 3300); the other tests' customers stay below it.
  await expect(field(page, 'Web port')).toHaveValue('3400');

  await field(page, 'Tenant ID').fill('Beta');
  await field(page, 'Web port').fill(String(ACME.webPort - 1));
  await dialog(page).getByRole('button', { name: 'Register' }).click();
  await expect(fieldError(page, 'lowercase')).toBeVisible();
  await expect(fieldError(page, 'Enter the organization name')).toBeVisible();
  // Its API port (web + 1) would be Acme's web port.
  await expect(fieldError(page, `Port ${ACME.webPort} is used by ${ACME.name} (${ACME.id})`)).toBeVisible();
  await field(page, 'Tenant ID').fill(ACME.id);
  await expect(fieldError(page, 'already exists')).toBeVisible();

  await field(page, 'Tenant ID').fill('beta');
  await field(page, 'Organization name').fill('Beta Ltd');
  await field(page, 'Web port').fill('3400');
  await field(page, 'Web port').press('Enter');
  await expect(dialog(page).getByText('npm run tenant:create -- beta')).toBeVisible();
  expect(await tenantById('beta')).toMatchObject({ name: 'Beta Ltd', provisioned: false, config: { webPort: 3400 } });

  await dialog(page).getByRole('button', { name: 'Open tenant' }).click();
  await expect(page).toHaveURL(/\/tenants\/beta$/);
  await expect(page.getByText('Awaiting activation on the vendor host')).toBeVisible();
  // No gateway credential to rotate before the host has activated it.
  await page.getByRole('button', { name: 'More actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Rotate gateway credential' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
});
