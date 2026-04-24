const { test, expect } = require("@playwright/test");
const { login } = require("./helpers");

test.describe("Trigger Reset", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("shows trigger reset page with input fields", async ({ page }) => {
    await expect(page.locator("h1:has-text('Trigger Reset')")).toBeVisible();
    await expect(page.locator("text=Email List")).toBeVisible();
    await expect(page.locator("text=cr/email")).toBeVisible();
  });

  test("start button disabled when no input", async ({ page }) => {
    const startBtn = page.locator('button:has-text("Start Reset")');
    await expect(startBtn).toBeDisabled();
  });

  test("processes single email", async ({ page }) => {
    const textarea = page.locator("textarea");
    await textarea.fill("singletest@gmail.com");
    await page.locator('input[placeholder="US"]').fill("US");

    await page.click('button:has-text("Start Reset")');
    await expect(page.locator('[data-testid="progress-text"]:has-text("1 / 1")')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-testid="result-row-0"]')).toBeVisible();
  });

  test("processes bulk emails (5 emails)", async ({ page }) => {
    const emails = Array.from({ length: 5 }, (_, i) => `trtest${i + 1}@gmail.com`).join("\n");
    const textarea = page.locator("textarea");
    await textarea.fill(emails);
    await page.locator('input[placeholder="US"]').fill("US");

    await page.click('button:has-text("Start Reset")');
    await expect(page.locator('[data-testid="progress-text"]:has-text("5 / 5")')).toBeVisible({ timeout: 60000 });

    await expect(page.locator('button:has-text("All (5)")')).toBeVisible();
  });

  test("shows filter buttons after results", async ({ page }) => {
    const textarea = page.locator("textarea");
    await textarea.fill("filtertest@gmail.com");
    await page.locator('input[placeholder="US"]').fill("US");

    await page.click('button:has-text("Start Reset")');
    await expect(page.locator('[data-testid="progress-text"]:has-text("1 / 1")')).toBeVisible({ timeout: 30000 });

    await expect(page.locator('button:has-text("All (")')).toBeVisible();
  });
});
