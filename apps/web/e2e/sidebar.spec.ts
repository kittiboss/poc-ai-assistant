import {
  accountButton,
  accountMenu,
  accounts,
  chatMenu,
  chatRow,
  composer,
  expect,
  lastReply,
  MOCK_REPLY,
  startChat,
  test,
} from './fixtures';

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

test('the account menu has the other pages and logging out, with the current page marked', async ({ page, m }) => {
  const { username, email } = accounts.admin;
  await page.goto('/usage');
  await expect(accountButton(page, m)).toContainText(username);
  await expect(accountButton(page, m)).toContainText(email);

  await accountButton(page, m).click();
  // Chats are in the sidebar, so there is no "Chat" item.
  const items = page.getByRole('menu').getByRole('menuitem');
  await expect(items).toHaveText([m.nav.usage, m.nav.liveUsage, m.nav.admin, m.nav.settings, m.nav.logout]);
  await expect(items.first()).toHaveClass(/ant-dropdown-menu-item-selected/);

  await page.getByRole('menuitem', { name: m.nav.settings }).click();
  await expect(page.getByRole('heading', { name: m.settings.title })).toBeVisible();
});

test('every page has the chat list; a chat or New chat opens the chat page', async ({ page, m, createdChats }) => {
  const id = await startChat(page, m, createdChats, 'A chat to open from another page');
  const sidebar = page.locator('aside');
  const newChat = sidebar.getByRole('button', { name: m.chat.newChat });

  await accountMenu(page, m, m.nav.settings);
  await expect(page.getByRole('heading', { name: m.settings.title })).toBeVisible();
  await expect(newChat).toBeVisible();
  await expect(sidebar.getByRole('textbox', { name: m.chat.searchLabel })).toBeVisible();
  await expect(sidebar.getByRole('checkbox', { name: m.chat.showArchived })).toBeVisible();
  // The chat menu works away from the chat page too.
  await chatMenu(page, m, id, m.chat.pin);
  await expect(chatRow(page, id).getByLabel(m.chat.pinned)).toBeVisible();

  await chatRow(page, id).getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/c/${id}$`));
  await expect(lastReply(page)).toContainText(MOCK_REPLY);

  await accountMenu(page, m, m.nav.usage);
  await expect(page.getByRole('heading', { name: m.usage.title })).toBeVisible();
  await newChat.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(composer(page, m)).toBeVisible();
});

test('the rail keeps New chat and the account menu on every page', async ({ page, m }) => {
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
  await newChat.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(composer(page, m)).toBeVisible();
  await expect(sidebar).toHaveCSS('width', '64px');
});
