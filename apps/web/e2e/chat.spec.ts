import {
  CHAT_PATH,
  chatId,
  chatLinks,
  chatMenu,
  chatRow,
  chosenModel,
  expect,
  lastReply,
  MOCK_REPLY,
  modelField,
  sendButton,
  sendPrompt,
  startChat,
  test,
} from './fixtures';

test('streams a reply from the mock model into a new chat', async ({ page, m, createdChats }) => {
  await startChat(page, m, createdChats, 'Explain Docker Compose');
  await expect(page.locator('.ant-bubble-end').last()).toContainText('Explain Docker Compose');

  // The chat is saved: it is still there after a reload.
  await page.reload();
  await expect(lastReply(page)).toContainText(MOCK_REPLY);
});

test('each model in the list shows where it runs, its status and provider; the field only its name', async ({
  page,
  m,
}) => {
  // The mock model is always there and available, and the first one, so it is chosen.
  await expect(chosenModel(page, m)).toHaveText('Local Mock');
  await modelField(page, m).click();
  const mock = page.getByRole('option', { name: /^Local Mock/ });
  await expect(mock).toContainText(m.enums.location.LOCAL);
  await expect(mock).toContainText(m.enums.modelStatus.available);
  await expect(mock).toContainText('MOCK');

  await mock.click();
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(chosenModel(page, m)).toHaveText('Local Mock');
});

test('stops a reply while it is generating', async ({ page, m, createdChats }) => {
  // The mock waits 5 seconds before answering this prompt.
  await sendPrompt(page, m, 'Stop test [mock:timeout]');
  const stop = page.getByRole('button', { name: m.chat.stop });
  await expect(stop).toBeVisible();
  await expect(page).toHaveURL(CHAT_PATH);
  createdChats.add(chatId(page));

  await stop.click();
  await expect(page.getByRole('alert').filter({ hasText: m.chat.stopped })).toBeVisible();
  await expect(lastReply(page)).toContainText(m.enums.messageStatus.INTERRUPTED);
  await expect(stop).toHaveCount(0);
  await expect(sendButton(page, m)).toBeVisible();
});

test('renames a chat and finds it by search', async ({ page, m, createdChats }) => {
  const id = await startChat(page, m, createdChats, 'A chat to rename');
  const title = `Renamed ${Date.now()}`;

  await chatMenu(page, m, id, m.chat.rename);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill('   ');
  await dialog.getByRole('button', { name: m.common.save }).click();
  await expect(dialog.getByText(m.chat.titleRequired)).toBeVisible();

  await dialog.getByRole('textbox').fill(title);
  await dialog.getByRole('button', { name: m.common.save }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(m.chat.renamed)).toBeVisible();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  await page.getByRole('textbox', { name: m.chat.searchLabel }).fill(title);
  await expect(chatLinks(page)).toHaveCount(1);
  await expect(chatRow(page, id)).toContainText(title);
});

test('deletes a chat after confirming', async ({ page, m, createdChats }) => {
  const id = await startChat(page, m, createdChats, 'A chat to delete');

  await chatMenu(page, m, id, m.chat.delete);
  const confirm = page.getByRole('dialog');
  await expect(confirm).toContainText(m.chat.deleteTitle);
  await confirm.getByRole('button', { name: m.chat.delete }).click();

  await expect(page.getByText(m.chat.deleted)).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(chatRow(page, id)).toHaveCount(0);
  createdChats.delete(id);
});

test("the header has the open chat's menu, right of the export button", async ({ page, m, createdChats }) => {
  const id = await startChat(page, m, createdChats, 'A chat for the header menu');
  const header = page.locator('header');
  const actions = header.getByRole('button', { name: m.chat.chatActions });
  const exportBox = await header.getByRole('button', { name: m.chat.export }).boundingBox();
  expect((await actions.boundingBox())!.x).toBeGreaterThan(exportBox!.x);

  await actions.click();
  await page.getByRole('menuitem', { name: m.chat.pin }).click();
  await expect(chatRow(page, id).getByLabel(m.chat.pinned)).toBeVisible();

  await actions.click();
  await expect(page.getByRole('menuitem', { name: m.chat.unpin })).toBeVisible();
  await page.getByRole('menuitem', { name: m.chat.delete }).click();
  await page.getByRole('dialog').getByRole('button', { name: m.chat.delete }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(chatRow(page, id)).toHaveCount(0);
  createdChats.delete(id);
});
