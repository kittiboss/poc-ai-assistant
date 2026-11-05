import type { Locator, Page } from '@playwright/test';
import { CHAT_PATH, chatId, composer, expect, lastReply, sendButton, test, type Messages } from './fixtures';

type FilePayload = { name: string; mimeType: string; buffer: Buffer };

/** A sample picture drawn by the browser: a gradient with a line of text. */
async function drawImage(page: Page, width: number, height: number): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ([w, h]) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext('2d')!;
      const gradient = context.createLinearGradient(0, 0, w, h);
      gradient.addColorStop(0, '#1e3a8a');
      gradient.addColorStop(1, '#f59e0b');
      context.fillStyle = gradient;
      context.fillRect(0, 0, w, h);
      context.fillStyle = '#ffffff';
      context.font = `${Math.round(h / 8)}px sans-serif`;
      context.fillText('Sample receipt 123.45 THB', w / 12, h / 2);
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let text = '';
      for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(text);
    },
    [width, height],
  );
  return Buffer.from(base64, 'base64');
}

/** Picks files with the attach button's file picker; its name says whether it offers images. */
async function attach(page: Page, button: string, ...files: FilePayload[]) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: button }).click();
  await (await chooser).setFiles(files);
}

const composerFiles = (page: Page, m: Messages) =>
  page.locator('footer').getByRole('list', { name: m.chat.attachedFiles }).getByRole('listitem');
const sentFiles = (page: Page, m: Messages): Locator =>
  page.locator('.ant-bubble-end').last().getByRole('list', { name: m.chat.attachedFiles });

async function choose(page: Page, m: Messages, name: string) {
  await page.getByRole('combobox', { name: m.chat.chatModel }).click();
  await page.locator('.ant-select-item-option').filter({ hasText: name }).click();
}

async function waitForReply(page: Page, m: Messages) {
  await expect(lastReply(page)).toContainText('This is a mock AI response');
  // The reply text arrives before the stream ends, and the composer ignores Enter until it has.
  await expect(page.getByRole('button', { name: m.chat.stop })).toHaveCount(0);
}

test('an image is resized before upload, sent without a message, shown in the chat and kept in its context', async ({
  page,
  m,
  createdChats,
}) => {
  const uploaded = page.waitForResponse((response) => response.url().endsWith('/api/attachments'));
  await attach(page, m.chat.attachWithImages, {
    name: 'receipt.png',
    mimeType: 'image/png',
    buffer: await drawImage(page, 2400, 1200),
  });
  // The browser made it fit the API: WebP, at most 1,600 px on the longer side.
  expect(await (await uploaded).json()).toMatchObject({
    kind: 'IMAGE',
    filename: 'receipt.webp',
    mimeType: 'image/webp',
    width: 1600,
    height: 800,
  });
  await expect(composerFiles(page, m).getByRole('img', { name: 'receipt.webp' })).toBeVisible();

  await sendButton(page, m).click();
  await expect(page).toHaveURL(CHAT_PATH);
  createdChats.add(chatId(page));
  await waitForReply(page, m);
  // The mock names each image it received: this one only.
  await expect(lastReply(page)).toContainText(/Images: image\/webp, [\d,]+ bytes(?!;)/);
  await expect(page.getByRole('heading', { level: 1, name: 'receipt.webp' })).toBeVisible();

  // The sent message shows the picture, which opens in the viewer from the keyboard too.
  const picture = sentFiles(page, m).getByRole('button', { name: m.chat.imageOpen.replace('{name}', 'receipt.webp') });
  await expect(picture.getByRole('img', { name: 'receipt.webp' })).toHaveJSProperty('complete', true);
  await picture.focus();
  await page.keyboard.press('Enter');
  const viewer = page.locator('.ant-image-preview');
  await expect(viewer.getByRole('img', { name: 'receipt.webp' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();

  // Every later turn sends the chat's images again.
  await composer(page, m).fill('What does it say?');
  await composer(page, m).press('Enter');
  await waitForReply(page, m);
  await expect(lastReply(page)).toContainText('Received: What does it say?');
  await expect(lastReply(page)).toContainText(/Images: image\/webp, [\d,]+ bytes(?!;)/);
});

test('a pasted screenshot is attached, and removing it deletes the upload', async ({ page, m }) => {
  const screenshot = (await drawImage(page, 300, 200)).toString('base64');
  // Until the models have loaded, no model is known to read images and the paste would be refused.
  await expect(page.getByRole('button', { name: m.chat.attachWithImages })).toBeVisible();
  await page.evaluate((base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
    const field = document.querySelector('footer textarea')!;
    field.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, screenshot);
  await expect(composerFiles(page, m).getByRole('img', { name: 'image.webp' })).toBeVisible();

  const removed = page.waitForRequest(
    (request) => request.method() === 'DELETE' && /\/api\/attachments\//.test(request.url()),
  );
  await page.getByRole('button', { name: m.chat.attachRemove.replace('{name}', 'image.webp') }).click();
  await removed;
  await expect(composerFiles(page, m)).toHaveCount(0);
});

test.describe('a model that cannot read images', () => {
  // A stand-in for a text-only model next to local-mock; the API itself is not changed.
  test.beforeEach(async ({ page, m }) => {
    await page.route('**/api/models', async (route) => {
      const response = await route.fetch();
      const models: { id: string; capabilities: string[] }[] = await response.json();
      const mock = models.find((model) => model.id === 'local-mock')!;
      models.push({ ...mock, id: 'text-only', displayName: 'Text Only', capabilities: ['chat', 'streaming'] } as never);
      await route.fulfill({ response, json: models });
    });
    await page.reload();
    await expect(composer(page, m)).toBeVisible();
  });

  test('offers documents only, and an image attached before the switch cannot be sent', async ({ page, m }) => {
    await attach(page, m.chat.attachWithImages, {
      name: 'chart.png',
      mimeType: 'image/png',
      buffer: await drawImage(page, 400, 300),
    });
    await expect(composerFiles(page, m).getByRole('img', { name: 'chart.webp' })).toBeVisible();

    await choose(page, m, 'Text Only');
    await composer(page, m).fill('Describe it');
    await expect(page.locator('footer').getByText(m.chat.attachNeedsVision)).toBeVisible();
    await expect(sendButton(page, m)).toBeDisabled();
    await page.getByRole('button', { name: m.chat.attachRemove.replace('{name}', 'chart.webp') }).click();
    await expect(sendButton(page, m)).toBeEnabled();

    // Its picker lists documents only; an image given to it anyway is refused with the reason.
    await attach(page, m.chat.attach, {
      name: 'again.png',
      mimeType: 'image/png',
      buffer: await drawImage(page, 40, 30),
    });
    await expect(page.getByText(`again.png: ${m.chat.attachNeedsVision}`)).toBeVisible();
    await expect(composerFiles(page, m)).toHaveCount(0);
  });
});

test.describe('models that take fewer images a chat', () => {
  // A vendor-managed deployment reports the vendor's limit as maxImages. Here local-mock takes 2 images
  // a chat, and a stand-in next to it takes 1; nothing is ever sent to the stand-in.
  test.beforeEach(async ({ page, m }) => {
    await page.route('**/api/models', async (route) => {
      const response = await route.fetch();
      const models: { id: string; maxImages?: number }[] = await response.json();
      const mock = models.find((model) => model.id === 'local-mock')!;
      mock.maxImages = 2;
      models.push({ ...mock, id: 'one-image', displayName: 'One Image', maxImages: 1 } as never);
      await route.fulfill({ response, json: models });
    });
    await page.reload();
    await expect(composer(page, m)).toBeVisible();
  });

  const images = async (page: Page, ...names: string[]) =>
    Promise.all(names.map(async (name) => ({ name, mimeType: 'image/png', buffer: await drawImage(page, 120, 90) })));

  test('the composer attaches no more images than the model takes, and a chat over the limit cannot go on', async ({
    page,
    m,
    createdChats,
  }) => {
    await attach(page, m.chat.attachWithImages, ...(await images(page, 'one.png', 'two.png', 'three.png')));
    await expect(page.getByText('A chat holds at most 2 images')).toBeVisible();
    await expect(composerFiles(page, m)).toHaveCount(2);
    await expect(composerFiles(page, m).getByRole('img', { name: 'two.webp' })).toBeVisible();

    await sendButton(page, m).click();
    await expect(page).toHaveURL(CHAT_PATH);
    const id = chatId(page);
    createdChats.add(id);
    await waitForReply(page, m);
    await expect(lastReply(page)).toContainText(/Images: image\/webp, [\d,]+ bytes; image\/webp, [\d,]+ bytes(?!;)/);

    // The chat is full now: another image is not attached.
    await page.getByText('A chat holds at most 2 images').waitFor({ state: 'detached' });
    await attach(page, m.chat.attachWithImages, ...(await images(page, 'four.png')));
    await expect(page.getByText('A chat holds at most 2 images')).toBeVisible();
    await expect(composerFiles(page, m)).toHaveCount(0);

    // A model that takes fewer images cannot continue it, nor regenerate a reply that has them all.
    await choose(page, m, 'One Image');
    const overLimit = m.chat.chatImageLimit.replace('{count}', '2').replace('{max}', '1');
    await expect(page.locator('footer').getByRole('alert').filter({ hasText: overLimit })).toBeVisible();
    await composer(page, m).fill('And now?');
    await expect(sendButton(page, m)).toBeDisabled();
    await lastReply(page).getByRole('button', { name: m.chat.regenerate }).click();
    // Warned before any copy of the chat is made.
    await expect(page.locator('.ant-message').getByText(overLimit)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/c/${id}$`));

    await choose(page, m, 'Local Mock');
    await expect(page.locator('footer').getByText(overLimit)).toHaveCount(0);
    await expect(sendButton(page, m)).toBeEnabled();
  });

  test('images beyond what the chosen model takes stay in the composer but cannot be sent', async ({ page, m }) => {
    await attach(page, m.chat.attachWithImages, ...(await images(page, 'one.png', 'two.png')));
    await expect(composerFiles(page, m).getByRole('img', { name: 'two.webp' })).toBeVisible();
    await composer(page, m).fill('Compare them');
    await expect(sendButton(page, m)).toBeEnabled();

    await choose(page, m, 'One Image');
    await expect(
      page.locator('footer').getByText('The chosen model takes at most 1 image a chat. Remove 1 image to send.'),
    ).toBeVisible();
    await expect(sendButton(page, m)).toBeDisabled();
    await page.getByRole('button', { name: m.chat.attachRemove.replace('{name}', 'two.webp') }).click();
    await expect(sendButton(page, m)).toBeEnabled();
  });
});
