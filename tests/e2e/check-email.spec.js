const { test, expect } = require("@playwright/test");
const { login } = require("./helpers");

test.describe("Check Email (VM)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.locator("aside").locator("text=VM Email").click();
    await expect(page.locator("h1:has-text('VM Email')")).toBeVisible();
  });

  test("shows check email page with input fields", async ({ page }) => {
    await expect(page.locator("text=Email List")).toBeVisible();
    await expect(page.locator("text=cr/email")).toBeVisible();
    await expect(page.locator('button:has-text("Start Check")')).toBeVisible();
  });

  test("start button disabled when no input", async ({ page }) => {
    const startBtn = page.locator('button:has-text("Start Check")');
    await expect(startBtn).toBeDisabled();
  });

  test("processes single email check", async ({ page }) => {
    const textarea = page.locator("textarea");
    await textarea.fill("vmtest_single@gmail.com");

    await page.click('button:has-text("Start Check")');
    await expect(page.locator('[data-testid="progress-text"]:has-text("1 / 1")')).toBeVisible({ timeout: 30000 });
    await expect(page.locator("main span.font-mono:has-text('vmtest_single@gmail.com')")).toBeVisible();
  });

  test("processes bulk email check (10 emails)", async ({ page }) => {
    const emails = Array.from({ length: 10 }, (_, i) => `vmbulk${i + 1}@gmail.com`).join("\n");
    const textarea = page.locator("textarea");
    await textarea.fill(emails);

    await page.click('button:has-text("Start Check")');
    await expect(page.locator('[data-testid="progress-text"]:has-text("10 / 10")')).toBeVisible({ timeout: 60000 });

    await expect(page.locator('button:has-text("All (10)")')).toBeVisible();
  });

  test("shows status badges in results", async ({ page }) => {
    const textarea = page.locator("textarea");
    await textarea.fill("badgetest@gmail.com");

    await page.click('button:has-text("Start Check")');
    await expect(page.locator('[data-testid="progress-text"]:has-text("1 / 1")')).toBeVisible({ timeout: 30000 });

    const badge = page.locator("main span.inline-flex");
    await expect(badge.first()).toBeVisible();
  });
});
