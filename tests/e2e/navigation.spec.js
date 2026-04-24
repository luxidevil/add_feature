const { test, expect } = require("@playwright/test");
const { login } = require("./helpers");

test.describe("Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("sidebar shows all navigation items", async ({ page }) => {
    const aside = page.locator("aside");
    await expect(aside.locator("text=Trigger Reset")).toBeVisible();
    await expect(aside.locator("text=Change Password")).toBeVisible();
    await expect(aside.locator("text=VM Email")).toBeVisible();
    await expect(aside.locator("text=Proxy")).toBeVisible();
    await expect(aside.locator("text=My Logs")).toBeVisible();
    await expect(aside.locator("text=IMAP / Gmail")).toBeVisible();
    await expect(aside.locator("text=Buy Credits")).toBeVisible();
    await expect(aside.locator("text=Admin Panel")).toBeVisible();
  });

  test("navigates to Check Email page", async ({ page }) => {
    await page.locator("aside").locator("text=VM Email").click();
    await expect(page.locator("h1:has-text('VM Email')")).toBeVisible();
  });

  test("navigates to Change Password page", async ({ page }) => {
    await page.locator("aside").locator("text=Change Password").click();
    await expect(page.locator("h1:has-text('Change Password')")).toBeVisible();
  });

  test("navigates to Logs page", async ({ page }) => {
    await page.locator("aside").locator("text=My Logs").click();
    await expect(page.locator("h1:has-text('My Logs')")).toBeVisible();
  });

  test("navigates to Proxy page", async ({ page }) => {
    await page.locator("aside").locator("text=Proxy").click();
    await expect(page.locator("h1:has-text('Proxy')")).toBeVisible();
  });

  test("navigates to IMAP page", async ({ page }) => {
    await page.locator("aside").locator("text=IMAP / Gmail").click();
    await expect(page.locator("h1:has-text('IMAP')")).toBeVisible();
  });

  test("navigates to Buy Credits page", async ({ page }) => {
    await page.locator("aside").locator("text=Buy Credits").click();
    await expect(page.locator("h1:has-text('Buy Credits')")).toBeVisible();
  });

  test("navigates to Admin Panel", async ({ page }) => {
    await page.locator("aside").locator("text=Admin Panel").click();
    await expect(page.locator("h1:has-text('Admin')")).toBeVisible();
  });
});
