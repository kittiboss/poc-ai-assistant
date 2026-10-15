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
const tag = `browser-smoke-${Date.now()}`;
let projectId;
let conversationId;
let memoryId;
try {
  await page.goto(web);
  await page.getByRole("button", { name: "Continue with company SSO" }).click();
  await page.locator("#username").fill("employee1");
  await page
    .locator("#password")
    .fill(process.env.EMPLOYEE_DEMO_PASSWORD || "Employee123!");
  await page.locator("#kc-login").click();
  const workspaceLink = page
    .getByRole("navigation")
    .getByRole("link", { name: "Projects & tools" });
  await workspaceLink.waitFor();
  await workspaceLink.click();
  await page.getByRole("heading", { name: "Create a project" }).waitFor();
  await page.getByText("Name", { exact: true }).locator("input").fill(tag);
  await page
    .getByText("Instructions", { exact: true })
    .locator("textarea")
    .fill("Answer using the uploaded handbook.");
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/workspace/projects") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save project" }).click();
  projectId = (await (await created).json()).id;
  assert(projectId);
  await page.getByLabel("Upload project document").setInputFiles({
    name: "handbook.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Annual leave allowance is 18 days."),
  });
  await page.getByText("Document indexed").waitFor();
  await page.getByRole("button", { name: "Instructions & memory" }).click();
  await page.getByPlaceholder("Preferred language: Thai").fill(tag);
  const memoryCreated = page.waitForResponse(
    (response) =>
      response.url().endsWith("/workspace/memories") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Add memory" }).click();
  memoryId = (await (await memoryCreated).json()).id;
  await page.getByText(tag, { exact: true }).waitFor();
  await page.getByRole("button", { name: "CSV analysis" }).click();
  await page.getByLabel("Upload CSV for analysis").setInputFiles({
    name: "sample.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("team,score\nA,2\nB,4"),
  });
  await page.getByLabel("Numeric column").selectOption("1");
  await page
    .getByText("2 rows · 2 numeric values · Sum 6", {
      exact: false,
    })
    .waitFor();
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page.getByRole("link", { name: "Chat in project" }).click();
  await page.getByLabel("Response mode").selectOption("search");
  await page.getByLabel("Message").fill("leave allowance");
  const chatCreated = page.waitForResponse(
    (response) =>
      response.url().endsWith("/conversations") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Run tool" }).click();
  conversationId = (await (await chatCreated).json()).id;
  await page.getByText("Local tool: search · no model call").waitFor();
  await page.getByText("18 days", { exact: false }).first().waitFor();
  await page
    .getByText("Retrieved sources · verify against these excerpts")
    .waitFor();
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
    "Browser UI smoke: project, upload, memory, CSV, chat tool, citation, admin controls passed",
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
      memoryId ? `/workspace/memories/${memoryId}` : null,
      projectId ? `/workspace/projects/${projectId}` : null,
    ].filter(Boolean)) {
      await fetch(`${api}${path}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
  }
  await browser.close();
}
