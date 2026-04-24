const { test, expect } = require("@playwright/test");
const { login } = require("./helpers");

test.describe("Admin Panel", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.locator("aside").locator("text=Admin Panel").click();
    await expect(page.locator("h1:has-text('Admin')")).toBeVisible({ timeout: 10000 });
  });

  test("shows admin tabs", async ({ page }) => {
    await expect(page.locator("main >> text=Users").first()).toBeVisible();
  });

  test("lists users in admin panel", async ({ page }) => {
    await expect(page.locator("main").locator("button:has-text('LUXIdepil')")).toBeVisible({ timeout: 10000 });
  });

  test("shows settings section", async ({ page }) => {
    const settingsTab = page.locator("main").locator('button:has-text("Settings")');
    await settingsTab.click();
    await expect(page.locator("main").locator("text=Credit Costs")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("main").locator("text=Concurrency Settings")).toBeVisible();
  });
});
