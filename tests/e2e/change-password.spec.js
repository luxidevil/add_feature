const { test, expect } = require("@playwright/test");
const { login } = require("./helpers");

test.describe("Change Password", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.click("aside >> text=Change Password");
    await expect(page.locator("h1:has-text('Change Password')")).toBeVisible();
  });

  test("shows change password page with input fields", async ({ page }) => {
    await expect(page.locator("text=Reset URLs")).toBeVisible();
    await expect(page.locator("text=Default Password")).toBeVisible();
    await expect(page.locator("text=Default IP")).toBeVisible();
    await expect(page.locator("text=cr/url")).toBeVisible();
  });

  test("start button disabled when no input", async ({ page }) => {
    const startBtn = page.locator('button:has-text("Start Change")');
    await expect(startBtn).toBeDisabled();
  });

  test("processes single change password", async ({ page }) => {
    const textarea = page.locator("textarea");
    await textarea.fill("https://www.netflix.com/password?nftoken=abc123");
    await page.locator('input[placeholder="NewPass123"]').fill("TestPass!123");
    await page.locator('input[placeholder="US"]').fill("US");

    await page.click('button:has-text("Start Change")');
    await expect(page.locator("text=1 / 1")).toBeVisible({ timeout: 30000 });
  });

  test("processes bulk change password (5 items)", async ({ page }) => {
    const urls = Array.from({ length: 5 }, (_, i) =>
      `https://www.netflix.com/password?nftoken=bulk${i + 1}`
    ).join("\n");
    const textarea = page.locator("textarea");
    await textarea.fill(urls);
    await page.locator('input[placeholder="NewPass123"]').fill("BulkPass!123");
    await page.locator('input[placeholder="US"]').fill("US");

    await page.click('button:has-text("Start Change")');
    await expect(page.locator("text=5 / 5")).toBeVisible({ timeout: 60000 });

    const allFilter = page.locator('button:has-text("All (5)")');
    await expect(allFilter).toBeVisible();
  });
});
