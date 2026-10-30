import type { Locator, Page } from '@playwright/test';
import {
  CHAT_PATH,
  chatId,
  composer,
  expect,
  lastReply,
  MOCK_REPLY,
  sendButton,
  test,
  type Messages,
} from './fixtures';

type FilePayload = { name: string; mimeType: string; buffer: Buffer };
const textFile = (name: string, text: string): FilePayload => ({
  name,
  mimeType: 'text/plain',
  buffer: Buffer.from(text),
});

/** Picks files with the attach button's file picker. */
async function attach(page: Page, m: Messages, ...files: FilePayload[]) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: m.chat.attach }).click();
  await (await chooser).setFiles(files);
}

/** The files of a sent message, or of the composer (`footer`). */
const attachedFiles = (scope: Page | Locator, m: Messages) =>
  scope.getByRole('list', { name: m.chat.attachedFiles }).getByRole('listitem');
const composerFiles = (page: Page, m: Messages) => attachedFiles(page.locator('footer'), m);
const sentMessage = (page: Page) => page.locator('.ant-bubble-end').last();

async function waitForReply(page: Page, m: Messages) {
  await expect(lastReply(page)).toContainText(MOCK_REPLY);
  // The reply text arrives before the stream ends, and the composer ignores Enter until it has.
  await expect(page.getByRole('button', { name: m.chat.stop })).toHaveCount(0);
}

/** Retrieved products are context too; with them, the mock model's 8,192 window is too small for a file. */
async function withoutCatalog(page: Page, m: Messages) {
  const catalog = page.getByRole('checkbox', { name: m.chat.productCatalog });
  if (await catalog.isChecked()) await catalog.uncheck();
}

test('sends files without a message: the reply is an overview and the chat is named after the file', async ({
  page,
  m,
  createdChats,
}) => {
  const text = 'Monday meeting: three budgets were approved.';
  await attach(page, m, textFile('บันทึกประชุม.txt', text));
  const chip = composerFiles(page, m);
  // The Thai name survives the upload: browsers send multipart filenames as UTF-8.
  await expect(chip).toContainText('บันทึกประชุม');
  await expect(chip).toContainText(m.chat.attachChars.replace('{chars}', String(text.length)));

  await sendButton(page, m).click();
  await expect(page).toHaveURL(CHAT_PATH);
  createdChats.add(chatId(page));
  await waitForReply(page, m);
  // The mock answers with the last message it received: the note that stands in for the empty one.
  await expect(lastReply(page)).toContainText('[Attached without a message: บันทึกประชุม.txt]');
  await expect(attachedFiles(sentMessage(page), m)).toHaveCount(1);
  await expect(sentMessage(page).locator('.ant-bubble-content')).toBeHidden();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('บันทึกประชุม.txt');
  await expect(composerFiles(page, m)).toHaveCount(0);

  // The files are saved with the message.
  await page.reload();
  await expect(attachedFiles(sentMessage(page), m)).toContainText('บันทึกประชุม');
});

test('sends files with a question, and regenerating sends them again', async ({ page, m, createdChats }) => {
  await withoutCatalog(page, m);
  await attach(page, m, textFile('policy.md', '# Leave policy\nEmployees get 10 days of annual leave.'));
  await expect(composerFiles(page, m)).toContainText(m.chat.attachChars.replace('{chars}', ''));
  await composer(page, m).fill('How many days of leave?');
  await sendButton(page, m).click();
  await expect(page).toHaveURL(CHAT_PATH);
  const first = chatId(page);
  createdChats.add(first);
  await waitForReply(page, m);
  await expect(lastReply(page)).toContainText('Received: How many days of leave?');
  await expect(attachedFiles(sentMessage(page), m)).toContainText('policy');
  await expect(sentMessage(page)).toContainText('How many days of leave?');

  // Regenerate copies the chat up to the question and sends it again, with its file.
  await lastReply(page).hover();
  await lastReply(page).getByRole('button', { name: m.chat.regenerate }).click();
  await expect(page).not.toHaveURL(new RegExp(first));
  await expect(page).toHaveURL(CHAT_PATH);
  createdChats.add(chatId(page));
  await waitForReply(page, m);
  await expect(attachedFiles(sentMessage(page), m)).toContainText('policy');
});

test('refuses what the API cannot read, and files over the limits before they are uploaded', async ({ page, m }) => {
  const chips = composerFiles(page, m);
  // The API finds no text: the file stays in the composer with the reason, until it is removed.
  await attach(page, m, textFile('blank.txt', ' \n '));
  await expect(chips).toContainText(m.chat.attachError.NO_TEXT);
  await page.getByRole('button', { name: m.chat.attachRemove.replace('{name}', 'blank.txt') }).click();
  await expect(chips).toHaveCount(0);

  // A type or size the API does not take is not added.
  await attach(page, m, { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') });
  await expect(page.getByText(m.chat.attachError.TYPE)).toBeVisible();
  await attach(page, m, textFile('huge.txt', 'a'.repeat(6 * 1024 * 1024)));
  await expect(page.getByText(m.chat.attachError.SIZE)).toBeVisible();
  await expect(chips).toHaveCount(0);

  // At most three files a message.
  await attach(page, m, ...['a', 'b', 'c', 'd'].map((name) => textFile(`${name}.txt`, name)));
  await expect(page.getByText(m.chat.attachLimit.replace('{max}', '3'))).toBeVisible();
  await expect(chips).toHaveCount(3);
  await expect(page.getByRole('button', { name: m.chat.attach })).toBeDisabled();
  for (const name of ['a', 'b', 'c'])
    await page.getByRole('button', { name: m.chat.attachRemove.replace('{name}', `${name}.txt`) }).click();
  await expect(chips).toHaveCount(0);
});

test('a message too long for the model is refused and comes back to the composer', async ({
  page,
  m,
  createdChats,
}) => {
  await withoutCatalog(page, m);
  // 9,000 bytes of text alone are over the mock model's 8,192.
  await attach(page, m, textFile('long.txt', 'a'.repeat(9000)));
  await expect(composerFiles(page, m)).toContainText(m.chat.attachChars.replace('{chars}', '9,000'));
  await composer(page, m).fill('Summarize');
  await sendButton(page, m).click();
  await expect(page).toHaveURL(CHAT_PATH);
  createdChats.add(chatId(page));
  await expect(page.getByRole('alert').filter({ hasText: m.chat.contextTooLong })).toBeVisible();
  // Nothing was saved, so the message and its file can be sent again, for example with another model.
  await expect(composer(page, m)).toHaveValue('Summarize');
  await expect(composerFiles(page, m)).toContainText('long');
  await page.getByRole('button', { name: m.chat.attachRemove.replace('{name}', 'long.txt') }).click();
});
