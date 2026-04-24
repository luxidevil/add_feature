const { test, expect } = require("@playwright/test");

test.describe("Authentication", () => {
  test("shows login page when not authenticated", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("h2:has-text('Sign In')")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("text=DEALER")).toBeVisible();
  });

  test("rejects invalid credentials", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.locator('input[placeholder="Enter username"]')).toBeVisible({ timeout: 15000 });
    await page.fill('input[placeholder="Enter username"]', "wronguser");
    await page.fill('input[placeholder="Enter password"]', "wrongpass");
    await page.click('button:has-text("Sign In")');
    await expect(page.locator("text=Invalid credentials")).toBeVisible({ timeout: 10000 });
  });

  test("logs in with valid credentials", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.locator('input[placeholder="Enter username"]')).toBeVisible({ timeout: 15000 });
    await page.fill('input[placeholder="Enter username"]', "LUXIdepil");
    await page.fill('input[placeholder="Enter password"]', "DeepAK@4180");
    await page.click('button:has-text("Sign In")');
    await expect(page.locator("h1:has-text('Trigger Reset')")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("aside >> text=LUXIdepil")).toBeVisible();
  });

  test("shows credit balance after login", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.locator('input[placeholder="Enter username"]')).toBeVisible({ timeout: 15000 });
    await page.fill('input[placeholder="Enter username"]', "LUXIdepil");
    await page.fill('input[placeholder="Enter password"]', "DeepAK@4180");
    await page.click('button:has-text("Sign In")');
    await expect(page.locator("h1:has-text('Trigger Reset')")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("aside >> text=credits >> nth=0")).toBeVisible();
  });

  test("logout works", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.locator('input[placeholder="Enter username"]')).toBeVisible({ timeout: 15000 });
    await page.fill('input[placeholder="Enter username"]', "LUXIdepil");
    await page.fill('input[placeholder="Enter password"]', "DeepAK@4180");
    await page.click('button:has-text("Sign In")');
    await expect(page.locator("h1:has-text('Trigger Reset')")).toBeVisible({ timeout: 15000 });
    await page.click('button:has-text("Sign Out")');
    await expect(page.locator('input[placeholder="Enter username"]')).toBeVisible({ timeout: 10000 });
  });
});
