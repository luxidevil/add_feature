async function login(page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.waitForSelector('input[placeholder="Enter username"]', { timeout: 15000 });
  await page.fill('input[placeholder="Enter username"]', "LUXIdepil");
  await page.fill('input[placeholder="Enter password"]', "DeepAK@4180");
  await page.click('button:has-text("Sign In")');
  await page.waitForSelector("h1", { timeout: 15000 });
}

module.exports = { login };
