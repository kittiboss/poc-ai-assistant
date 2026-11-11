import { dialog, expect, fact, field, fieldError, tenantById, test, toast } from './fixtures';

test('knowledge limits are checked like vendor-control does, then saved', async ({ page, tenant }) => {
  await page.goto(`/tenants/${tenant.id}`);
  await page.getByRole('button', { name: 'Edit knowledge limits' }).click();
  for (const type of ['CSV', 'TXT', 'MD', 'PDF']) await dialog(page).getByLabel(type).uncheck();
  await field(page, 'Chunks in total').fill('100');
  await field(page, 'Chunks per document').fill('500');
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(fieldError(page, 'Choose at least one file type')).toBeVisible();
  await expect(fieldError(page, 'Cannot be more than the chunks in total')).toBeVisible();
  // gemini-embedding is not in this customer's plan.
  await expect(dialog(page)).toContainText('not in plan');

  await dialog(page).getByLabel('PDF').check();
  await dialog(page).getByLabel('MD').check();
  await field(page, 'Chunks per document').fill('50');
  await field(page, 'Documents').fill('42');
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(toast(page, 'Knowledge limits saved')).toBeVisible();

  const { rag } = (await tenantById(tenant.id))!;
  expect(rag).toMatchObject({
    maxDocuments: 42,
    maxTotalChunks: 100,
    maxChunksPerDocument: 50,
    allowedTypes: ['md', 'pdf'],
  });
  await expect(fact(page, 'File types')).toHaveText('MD, PDF');
  await expect(fact(page, 'Per document')).toContainText('50 chunks');
});

test('image limits turn images off for a customer', async ({ page, tenant }) => {
  await page.goto(`/tenants/${tenant.id}`);
  await page.getByRole('button', { name: 'Edit image limits' }).click();
  // The field keeps to 1–6 by itself.
  await field(page, 'Images per chat').fill('9');
  await field(page, 'Images per chat').blur();
  await expect(field(page, 'Images per chat')).toHaveValue('6');
  await field(page, 'Images per chat').fill('3');
  await dialog(page).getByRole('switch').click();
  await dialog(page).getByLabel('local-mock').uncheck();
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(toast(page, 'Image limits saved')).toBeVisible();

  expect((await tenantById(tenant.id))?.images).toEqual({ enabled: false, models: [], maxImages: 3 });
  const card = page.locator('.ant-card').filter({ hasText: 'Image limits' });
  await expect(card.getByText('Off', { exact: true })).toBeVisible();
  await expect(fact(page, 'Images per chat')).toHaveText('3');
});

test.describe('a customer with Groq and OpenRouter in its plan', () => {
  test.use({ tenantModels: ['local-mock', 'mock-embedding', 'groq-vision', 'openrouter-free'] });

  test('image limits show that a model never takes more images than its own', async ({ page, tenant }) => {
    await page.goto(`/tenants/${tenant.id}`);
    await page.getByRole('button', { name: 'Edit image limits' }).click();
    const option = (model: string) => dialog(page).locator('label').filter({ hasText: model });
    await expect(option('groq-vision')).toContainText('at most 2 a chat');
    await expect(option('openrouter-free')).toContainText('at most 4 a chat');
    await expect(option('local-mock')).not.toContainText('at most');
    await expect(dialog(page)).toContainText(
      'A model never takes more than its own, whatever this says: groq-vision 2, openrouter-free 4.',
    );

    await dialog(page).getByLabel('groq-vision').check();
    await dialog(page).getByLabel('openrouter-free').check();
    await field(page, 'Images per chat').fill('3');
    await dialog(page).getByRole('button', { name: 'Save' }).click();
    await expect(toast(page, 'Image limits saved')).toBeVisible();

    expect((await tenantById(tenant.id))?.images).toEqual({
      enabled: true,
      models: ['local-mock', 'groq-vision', 'openrouter-free'],
      maxImages: 3,
    });
    // Groq takes 2 of the 3; OpenRouter takes 4, so all 3.
    await expect(fact(page, 'Images per chat')).toContainText('3(groq-vision 2)');
    const card = page.locator('.ant-card').filter({ hasText: 'Image limits' });
    await expect(card).toContainText(
      '1,120 for local-mock and google-gemini, 2,048 for groq-vision and openrouter-free',
    );
  });
});
