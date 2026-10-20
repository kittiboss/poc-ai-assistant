import { composer, expect, test } from './fixtures';

// The desktop project only; a phone uses the menu drawer (mobile.spec.ts).

test('the sidebar starts open, folds away and comes back with the keyboard focus', async ({ page, m }) => {
  // Settings has no header of its own; one shows while the sidebar is closed.
  await page.goto('/settings');
  const sidebar = page.locator('aside');
  const close = sidebar.getByRole('button', { name: m.nav.closeSidebar });
  const open = page.getByRole('button', { name: m.nav.openSidebar });
  await expect(sidebar).toHaveCSS('width', '288px');
  await expect(open).toBeHidden();

  await close.click();
  await expect(sidebar).toHaveCSS('width', '0px');
  await expect(open).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(sidebar).toHaveCSS('width', '288px');
  await expect(close).toBeFocused();
  await expect(open).toBeHidden();
});

test('a closed sidebar stays closed on the page the browser goes back to', async ({ page, m }) => {
  const sidebar = page.locator('aside');
  await sidebar.getByRole('link', { name: m.nav.usage }).click();
  await expect(page.getByRole('heading', { name: m.usage.title })).toBeVisible();
  await sidebar.getByRole('button', { name: m.nav.closeSidebar }).click();

  // A client-side navigation has no load event to wait for.
  await page.goBack({ waitUntil: 'commit' });
  await expect(composer(page, m)).toBeVisible();
  await expect(sidebar).toHaveCSS('width', '0px');
});
