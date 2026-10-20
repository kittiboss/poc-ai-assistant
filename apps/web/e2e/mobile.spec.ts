import { chatRow, expect, lastReply, startChat, test } from './fixtures';

// The mobile project only (390 × 844, touch).

test('the menu drawer opens, navigates and closes', async ({ page, m }) => {
  await page.getByRole('button', { name: m.nav.openMenu }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await drawer.getByRole('link', { name: m.nav.usage }).click();
  await expect(page).toHaveURL(/\/usage$/);
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('heading', { name: m.usage.title })).toBeVisible();
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
