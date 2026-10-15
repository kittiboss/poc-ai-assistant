import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const web = process.env.WEB_URL || "http://localhost:3000";
const api = process.env.API_URL || "http://localhost:3001/api";
let conversationId;
try {
  await page.goto(web);
  await page.getByRole("button", { name: "Continue with company SSO" }).click();
  await page.locator("#username").fill("employee1");
  await page
    .locator("#password")
    .fill(process.env.EMPLOYEE_DEMO_PASSWORD || "Employee123!");
  await page.locator("#kc-login").click();
  await page.getByRole("heading", { name: "New conversation" }).waitFor();
  assert.equal(
    await page
      .getByRole("navigation")
      .getByRole("link", { name: "Projects & tools" })
      .count(),
    0,
  );
  for (const label of [
    "Response mode",
    "Prompt persona",
    "Comparison model",
    "Filter project",
    "Move chat to project",
  ]) {
    assert.equal(
      await page.getByLabel(label).count(),
      0,
      `${label} was removed`,
    );
  }
  await page.getByLabel("Chat model").selectOption("local-mock");
  await page.getByLabel("Message").fill("Explain Docker Compose");
  const chatCreated = page.waitForResponse(
    (response) =>
      response.url().endsWith("/conversations") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Send" }).click();
  conversationId = (await (await chatCreated).json()).id;
  await page
    .getByText("This is a mock AI response for local POC testing.", {
      exact: true,
    })
    .waitFor();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Live tokens" })
    .click();
  await page
    .getByRole("heading", { name: "Token usage in real time" })
    .waitFor();
  await page.getByText("All-time completed tokens").waitFor();
  const firstBar = page.locator(".live-token-bar").first();
  await firstBar.waitFor();
  assert(
    ((await firstBar.boundingBox())?.height || 0) > 0,
    "Live token bars must have visible height",
  );
  const adminPage = await browser.newPage();
  await adminPage.goto(`${web}/admin`);
  await adminPage
    .getByRole("button", { name: "Continue with company SSO" })
    .click();
  await adminPage.locator("#username").fill("admin");
  await adminPage
    .locator("#password")
    .fill(process.env.ADMIN_DEMO_PASSWORD || "Admin123!");
  await adminPage.locator("#kc-login").click();
  try {
    await adminPage
      .getByRole("link", { name: "Admin console" })
      .waitFor({ timeout: 10000 });
  } catch (error) {
    console.error("Admin page path:", new URL(adminPage.url()).pathname);
    console.error(
      "Admin page text:",
      (await adminPage.locator("body").innerText()).slice(0, 500),
    );
    throw error;
  }
  await adminPage.getByRole("link", { name: "Admin console" }).click();
  await adminPage
    .getByRole("heading", { name: "Workspace controls" })
    .waitFor();
  await adminPage.getByText("Quotas & simulated budgets").waitFor();
  await adminPage.close();
  console.log(
    "Browser UI smoke: simplified chat, removed Projects & tools UI, live tokens, and admin controls passed",
  );
} finally {
  const token = await page
    .evaluate(() => {
      const key = Object.keys(sessionStorage).find((name) =>
        name.startsWith("oidc.user:"),
      );
      return key
        ? JSON.parse(sessionStorage.getItem(key) || "{}").access_token
        : null;
    })
    .catch(() => null);
  if (token) {
    for (const path of [
      conversationId ? `/conversations/${conversationId}` : null,
    ].filter(Boolean)) {
      await fetch(`${api}${path}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
  }
  await browser.close();
}
