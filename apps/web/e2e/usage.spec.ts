import { accountMenu, expect, startChat, test } from './fixtures';

test('the live token page charts a completed reply as a bar', async ({ page, m, createdChats }) => {
  await startChat(page, m, createdChats, 'Explain Docker Compose');

  await accountMenu(page, m, m.nav.liveUsage);
  await expect(page.getByRole('heading', { name: m.liveUsage.title })).toBeVisible();
  await expect(page.getByText(m.liveUsage.allTime)).toBeVisible();

  // The newest request is the last bar, and its title names the model.
  const chart = page.getByRole('img', { name: m.liveUsage.chartLabel });
  const newest = chart.locator('[title]').last();
  await expect(newest).toHaveAttribute('title', /^Local Mock: [\d,]+ tokens$/);
  // Each bar rises from nothing when it appears, so wait for its height.
  await expect
    .poll(async () => (await newest.locator('.live-token-bar').boundingBox())?.height ?? 0)
    .toBeGreaterThan(0);
});
