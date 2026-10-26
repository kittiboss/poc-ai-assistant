import { accountButton, accountMenu, accounts, composer, expect, test } from './fixtures';

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

test('the pages and logging out are in the account menu, not in the sidebar', async ({ page, m }) => {
  const { username, email } = accounts.admin;
  const sidebar = page.locator('aside');
  await expect(sidebar.getByRole('link', { name: m.nav.usage })).toHaveCount(0);
  await expect(accountButton(page, m)).toContainText(username);
  await expect(accountButton(page, m)).toContainText(email);

  await accountButton(page, m).click();
  for (const item of [m.nav.chat, m.nav.usage, m.nav.liveUsage, m.nav.admin, m.nav.settings, m.nav.logout])
    await expect(page.getByRole('menuitem', { name: item })).toBeVisible();
  // The current page is marked.
  await expect(page.getByRole('menuitem', { name: m.nav.chat })).toHaveClass(/ant-dropdown-menu-item-selected/);

  await page.getByRole('menuitem', { name: m.nav.settings }).click();
  await expect(page.getByRole('heading', { name: m.settings.title })).toBeVisible();
});

test('the rail keeps New chat and the account menu, also on other pages', async ({ page, m }) => {
  const sidebar = page.locator('aside');
  const newChat = sidebar.getByRole('button', { name: m.chat.newChat });
  await sidebar.getByRole('button', { name: m.nav.closeSidebar }).click();
  await expect(sidebar).toHaveCSS('width', '64px');
  await expect(newChat).toBeVisible();
  // No search and no chat list.
  await expect(sidebar.getByRole('textbox')).toHaveCount(0);
  await expect(sidebar.locator('a[href^="/c/"]')).toHaveCount(0);
  // Folded to the avatar, whose menu starts with the user.
  await accountButton(page, m).click();
  await expect(page.getByRole('menu')).toContainText(accounts.admin.email);
  await page.getByRole('menuitem', { name: m.nav.usage }).click();

  await expect(page.getByRole('heading', { name: m.usage.title })).toBeVisible();
  await expect(sidebar).toHaveCSS('width', '64px');
  await expect(newChat).toHaveCount(0);

  // A client-side navigation has no load event to wait for.
  await page.goBack({ waitUntil: 'commit' });
  await expect(composer(page, m)).toBeVisible();
  await expect(sidebar).toHaveCSS('width', '64px');
  await accountMenu(page, m, m.nav.liveUsage);
  await expect(page).toHaveURL(/\/usage\/live$/);
});
