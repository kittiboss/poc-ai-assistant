import { accountMenu, chatRow, expect, lastReply, startChat, test } from './fixtures';

// The mobile project only (390 × 844, touch).

test('the menu drawer opens, closes from its button, navigates and closes', async ({ page, m }) => {
  const openMenu = page.getByRole('button', { name: m.nav.openMenu });
  const drawer = page.getByRole('dialog');
  await openMenu.click();
  await drawer.getByRole('button', { name: m.nav.closeSidebar }).click();
  await expect(drawer).toBeHidden();

  await openMenu.click();
  await expect(drawer).toBeVisible();
  await accountMenu(page, m, m.nav.usage);
  await expect(page).toHaveURL(/\/usage$/);
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('heading', { name: m.usage.title })).toBeVisible();
});

test('the admin overview filters open in a drawer on a phone', async ({ page, m }) => {
  const f = m.admin.filters;
  await page.goto('/admin');
  await page.getByRole('button', { name: f.button, exact: true }).click();
  const drawer = page.getByRole('dialog', { name: f.title });
  await drawer.getByText(f.ranges['7d']).click();
  await expect(page).toHaveURL(/\/admin\?range=7d$/);
  await drawer.getByRole('button', { name: f.done }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('button', { name: f.buttonCount.replace('{count}', '1') })).toBeVisible();
});

test('chats on a phone: send, reply and the chat menu without hover', async ({ page, m, createdChats }) => {
  const id = await startChat(page, m, createdChats, 'Explain Docker Compose on a phone');
  await expect(lastReply(page)).toBeInViewport();

  // On a touch screen the ⋯ button shows without hovering.
  await page.getByRole('button', { name: m.nav.openMenu }).click();
  const actions = chatRow(page, id).getByRole('button', { name: m.chat.chatActions });
  await expect(actions).toBeVisible();
  await actions.click();
  await expect(page.getByRole('menuitem', { name: m.chat.rename })).toBeVisible();
});
