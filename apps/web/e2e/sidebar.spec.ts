import { accounts, composer, expect, test } from './fixtures';

// The desktop project only; a phone uses the menu drawer (mobile.spec.ts).

test('the sidebar starts open, folds to a rail and opens again with the keyboard focus', async ({ page, m }) => {
  await page.goto('/settings');
  const sidebar = page.locator('aside');
  const close = sidebar.getByRole('button', { name: m.nav.closeSidebar });
  const open = sidebar.getByRole('button', { name: m.nav.openSidebar });
  await expect(sidebar).toHaveCSS('width', '288px');
  await expect(open).toHaveCount(0);

  await close.click();
  await expect(sidebar).toHaveCSS('width', '64px');
  await expect(open).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(sidebar).toHaveCSS('width', '288px');
  await expect(close).toBeFocused();
});

test('the rail keeps New chat and the menu as icons, also on other pages', async ({ page, m }) => {
  const sidebar = page.locator('aside');
  const newChat = sidebar.getByRole('button', { name: m.chat.newChat });
  await sidebar.getByRole('button', { name: m.nav.closeSidebar }).click();
  await expect(sidebar).toHaveCSS('width', '64px');
  await expect(newChat).toBeVisible();
  // No search and no chat list.
  await expect(sidebar.getByRole('textbox')).toHaveCount(0);
  await expect(sidebar.locator('a[href^="/c/"]')).toHaveCount(0);

  await sidebar.getByRole('link', { name: m.nav.usage }).click();
  await expect(page.getByRole('heading', { name: m.usage.title })).toBeVisible();
  await expect(sidebar).toHaveCSS('width', '64px');
  await expect(newChat).toHaveCount(0);

  // A client-side navigation has no load event to wait for.
  await page.goBack({ waitUntil: 'commit' });
  await expect(composer(page, m)).toBeVisible();
  await expect(sidebar).toHaveCSS('width', '64px');
});

test('shows the signed-in user at the bottom, folded to the initial in the rail', async ({ page, m }) => {
  const { username, email } = accounts.admin;
  const label = m.nav.signedInAs.replace('{username}', username);
  const profile = page.getByRole('group', { name: label });
  await expect(profile).toContainText(username);
  await expect(profile).toContainText(email);

  await page.getByRole('button', { name: m.nav.closeSidebar }).click();
  await expect(profile).toHaveCount(0);
  await expect(page.getByRole('img', { name: label })).toHaveText('A');
});
