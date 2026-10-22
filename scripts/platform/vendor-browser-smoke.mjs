// Browser verification with local mock chat only; leaves one small test-credit grant/history entry.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { join } from "node:path";
import { readPlatformEnv, readEnvFile, tenantsDir } from "./lib.mjs";

const env = readEnvFile(join(tenantsDir, "a.env"));
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
try {
  const vendor = await browser.newContext({
    httpCredentials: {
      username: "vendor",
      password: readPlatformEnv().VENDOR_ADMIN_KEY,
    },
    viewport: { width: 1440, height: 1000 },
  });
  const consolePage = await vendor.newPage();
  const errors = [];
  consolePage.on("pageerror", (e) => errors.push(e.message));
  await consolePage.goto("http://localhost:4050/console/");
  await consolePage
    .getByRole("heading", { name: "Credits, tenants & model pricing" })
    .waitFor();
  await consolePage.getByRole("cell", { name: /Customer A \(a\)/ }).waitFor();
  assert.ok((await consolePage.locator("#prices tr").count()) >= 2);
  await consolePage
    .locator("#tenants tr")
    .filter({ hasText: "Customer A (a)" })
    .getByRole("button", { name: "History", exact: true })
    .click();
  await consolePage.locator("#ledger tr").first().waitFor();
  await consolePage.screenshot({
    path: "/tmp/vendor-console-poc.png",
    fullPage: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.addCookies([
    { name: "NEXT_LOCALE", value: "en", url: env.WEB_PUBLIC_URL },
  ]);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${env.WEB_PUBLIC_URL}/billing`);
  await page.getByRole("button", { name: "Continue with company SSO" }).click();
  await page.locator("#username").fill("tenant-admin");
  await page.locator("#password").fill(env.TENANT_ADMIN_PASSWORD);
  await page.locator("#kc-login").click();
  await page
    .getByRole("heading", { name: "Test credits & billing", exact: true })
    .waitFor();
  await page
    .getByRole("cell", { name: "local-mock", exact: true })
    .first()
    .waitFor();
  await page.getByRole("spinbutton").fill("0.01");
  const receiptResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/admin/billing/topups") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Grant test credit", exact: true })
    .click();
  const receipt = await (await receiptResponse).json();
  assert.equal(receipt.simulation, true);
  await page
    .getByText(`${receipt.id} · $0.010000000 · Test credit granted`, {
      exact: true,
    })
    .waitFor();
  await page.screenshot({
    path: "/tmp/tenant-billing-poc.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "/tmp/tenant-billing-mobile-poc.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "No page-level mobile overflow",
  );
  await page.goto(`${env.WEB_PUBLIC_URL}/admin`);
  await page
    .getByRole("heading", { name: "Pricing management", exact: true })
    .waitFor({ state: "hidden" });
  await page
    .getByRole("heading", { name: "Gross margin (actual)", exact: true })
    .waitFor({ state: "hidden" });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        vendorConsole: "passed",
        tenantBilling: "passed",
        mockTopup: receipt.id,
        mobileLayout: "passed",
        browserErrors: 0,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
