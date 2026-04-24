const { test, expect } = require("@playwright/test");

const PROD_URL = "https://nfresetagent.com";
const USERNAME = "LUXIdepil";
const PASSWORD = "DeepAK@4180";

const SAMPLE_EMAILS = `pxajjqqhssq@hotmail.com
exudbfpjnj@hotmail.com
fybgkyq@hotmail.com
xnnvwxv@hotmail.com
dwmkgh@hotmail.com
sfhgqxehweu@hotmail.com
gtpnhqfa@hotmail.com
punsbf@hotmail.com
qjrfsrjmxf@hotmail.com
xmnrqus@hotmail.com
wjfkkyjskt@hotmail.com
myksqwerf@hotmail.com
ghmrsecxx@hotmail.com
bsyvrvsmj@hotmail.com
sxpfuq@hotmail.com
yfkpevk@hotmail.com
daxnhqpxt@hotmail.com
ayxbypmtgv@hotmail.com
hvffhtxnqax@hotmail.com
rejcvxff@hotmail.com
sckxuktrd@hotmail.com
pmagjfs@hotmail.com
sywnkxpp@hotmail.com
mjwvtnrfnrt@hotmail.com
jgrcjenpg@hotmail.com
vcmdrbp@hotmail.com
tgbntgyn@hotmail.com
vjrtbeq@hotmail.com
yqxkpxtakx@hotmail.com
xxdamu@hotmail.com
wqnakmu@hotmail.com
twruqs@hotmail.com
tamfyrjvnp@hotmail.com
ugshefdr@hotmail.com
nesefapx@hotmail.com
rxhkvcftubv@hotmail.com
snqybkfmfns@hotmail.com
vayjhtk@hotmail.com
ykbyfmxm@hotmail.com
njwnqucnb@hotmail.com
uteeenkvmky@hotmail.com
ysrtjktyv@hotmail.com
dpucswnbx@hotmail.com
tqmyiejhbx02@outlook.com
lvealbjyzz89@outlook.com
ohrtfdvczu14@outlook.com
mockhptwxy40@outlook.com
fxcaxzrefg67@outlook.com
sqglxrobfs05@outlook.com
ofpnhsebml54@outlook.com
epijhhexlo73@outlook.com
jdkpfsztno65@outlook.com
rdmycqejxq11@outlook.com
iolkknshyh40@outlook.com
jixolimjmd17@outlook.com
jlgmywkcpg15@outlook.com
hruxeeowfv50@outlook.com
mqvjealmhf75@outlook.com
efkedordye76@outlook.com
oamlroawxd59@outlook.com
jdxxyaltwe70@outlook.com
hiijieokvz54@outlook.com
hblajzlzce99@outlook.com
tpaplxwlez46@outlook.com
twpgcudihc25@outlook.com
kwefxhiqvr31@outlook.com
xfvhsawqpw18@outlook.com
pbydodvzem43@outlook.com
szvzkchhbm56@outlook.com
paztswiyif82@outlook.com
zmojsxgvzy64@outlook.com
xvmrlksfek78@outlook.com
jvgvxtxfex20@outlook.com
sevuzeehov84@outlook.com
kpabxxkpvv73@outlook.com
bweboqsrzf11@outlook.com
kpdqutxiid59@outlook.com
ujurvxmnwu11@outlook.com
mgxbhw@hotmail.com
dryhqkmfkc@hotmail.com
nfebaxsfqt@hotmail.com
hjkqbnav@hotmail.com
eunwfrng@hotmail.com
upmffqurtw@hotmail.com
gtcqrg@hotmail.com
ccegynb@hotmail.com
aubakwjrfjb@hotmail.com
jqynedmvt@hotmail.com
cnyqpsmbyn@hotmail.com
xdjfwtn@hotmail.com
rnaabq@hotmail.com
gnepumybbpu@hotmail.com
uxqmrga@hotmail.com
xnutbt@hotmail.com
caponetamsiniw@hotmail.com
daykfigus@hotmail.com
cbmmzkwbcm25@outlook.com
sjbktobvhm86@outlook.com
qapaftbliu82@outlook.com
xmeoinzcgc10@outlook.com
epxvdlaajr48@outlook.com
iqzieefseb73@outlook.com
mympdqcsgf23@outlook.com
yzmdceghnq64@outlook.com
lquxxzjgsy74@outlook.com
mefgnvtmvt40@outlook.com
ffebutcwwq@hotmail.com`;

const COUNTRY = "TH";
const TOTAL_EMAILS = 107;

async function login(page) {
  await page.goto(PROD_URL);
  await expect(page.locator('input[placeholder="Enter username"]')).toBeVisible({ timeout: 15000 });
  await page.fill('input[placeholder="Enter username"]', USERNAME);
  await page.fill('input[placeholder="Enter password"]', PASSWORD);
  await page.click('button:has-text("Sign In")');
  await expect(page.locator("h1:has-text('Trigger Reset')")).toBeVisible({ timeout: 15000 });
}

test.describe("Production Site — Login & Navigation", () => {
  test("login page loads", async ({ page }) => {
    await page.goto(PROD_URL);
    await expect(page.locator('input[placeholder="Enter username"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('input[placeholder="Enter password"]')).toBeVisible();
    await expect(page.locator('button:has-text("Sign In")')).toBeVisible();
  });

  test("login with valid credentials", async ({ page }) => {
    await login(page);
    await expect(page.locator("h1:has-text('Trigger Reset')")).toBeVisible();
  });

  test("shows credit balance in sidebar", async ({ page }) => {
    await login(page);
    await expect(page.locator("aside >> text=credits >> nth=0")).toBeVisible();
  });

  test("navigate to all sidebar pages", async ({ page }) => {
    await login(page);
    const pages = [
      { nav: "Trigger Reset", heading: "Trigger Reset" },
      { nav: "Change Password", heading: "Change Password" },
      { nav: "VM Email", heading: "VM Email" },
      { nav: "Proxy", heading: "Proxy" },
      { nav: "My Logs", heading: "Logs" },
      { nav: "IMAP / Gmail", heading: "IMAP" },
      { nav: "Buy Credits", heading: "Buy Credits" },
      { nav: "Admin Panel", heading: "Admin" },
    ];
    for (const p of pages) {
      await page.locator("aside").locator(`text=${p.nav}`).click();
      await expect(page.locator(`h1:has-text("${p.heading}")`)).toBeVisible({ timeout: 10000 });
    }
  });

  test("logout works", async ({ page }) => {
    await login(page);
    await page.locator("aside").locator("text=Logout").click();
    await expect(page.locator('input[placeholder="Enter username"]')).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Production Site — Trigger Reset (10 emails UI test)", () => {
  test.setTimeout(300000);

  test("bulk trigger reset with 10 emails — no freeze, streams results, buttons work", async ({ page }) => {
    await login(page);

    await page.locator("aside").locator("text=Trigger Reset").click();
    await expect(page.locator("h1:has-text('Trigger Reset')")).toBeVisible({ timeout: 10000 });

    const first10 = SAMPLE_EMAILS.split("\n").slice(0, 10).join("\n");
    const textarea = page.locator('textarea[data-testid="input-emails"]');
    await expect(textarea).toBeVisible();
    await textarea.fill(first10);

    const countryInput = page.locator('input[placeholder="US"]');
    await countryInput.fill(COUNTRY);

    const startButton = page.locator('[data-testid="button-start"]');
    await expect(startButton).toBeEnabled();
    await startButton.click();

    await expect(page.locator('[data-testid="progress-text"]')).toBeVisible({ timeout: 10000 });
    const progressText = page.locator('[data-testid="progress-text"]');

    let lastCompleted = 0;
    const startTime = Date.now();

    while (true) {
      const text = await progressText.textContent();
      const match = text.match(/(\d+)\s*\/\s*(\d+)/);
      if (match) {
        const completed = parseInt(match[1]);
        const total = parseInt(match[2]);
        expect(total).toBe(10);

        if (completed > lastCompleted) lastCompleted = completed;
        if (completed >= 10) break;
      }

      if (Date.now() - startTime > 240000) {
        throw new Error(`Timed out after 4 minutes. Progress: ${lastCompleted}/10`);
      }

      await page.waitForTimeout(2000);
    }

    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`TR bulk completed: 10 emails in ${elapsed.toFixed(1)}s`);

    await expect(page.locator('[data-testid="filter-all"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="filter-success"]')).toBeVisible();
    await expect(page.locator('[data-testid="filter-failed"]')).toBeVisible();

    const allButton = page.locator('[data-testid="filter-all"]');
    const allText = await allButton.textContent();
    expect(allText).toContain("10");

    const resultRows = page.locator('[data-testid^="result-row-"]');
    const rowCount = await resultRows.count();
    expect(rowCount).toBe(10);

    await page.locator('[data-testid="filter-success"]').click();
    await page.waitForTimeout(500);
    const successRows = await page.locator('[data-testid^="result-row-"]').count();

    await page.locator('[data-testid="filter-failed"]').click();
    await page.waitForTimeout(500);
    const failedRows = await page.locator('[data-testid^="result-row-"]').count();

    expect(successRows + failedRows).toBe(10);
    console.log(`TR results: ${successRows} success, ${failedRows} failed`);

    await page.locator('[data-testid="filter-all"]').click();
    await page.waitForTimeout(500);

    const copyButton = page.locator('button:has-text("Copy")');
    await expect(copyButton).toBeVisible();
    const excelButton = page.locator('button:has-text("Excel")');
    await expect(excelButton).toBeVisible();
  });
});

test.describe("Production Site — VM Email Check (107 emails)", () => {
  test.setTimeout(600000);

  test("bulk VM email check with 107 emails — no freeze, streams results", async ({ page }) => {
    await login(page);

    await page.locator("aside").locator("text=VM Email").click();
    await expect(page.locator("h1:has-text('VM Email')")).toBeVisible({ timeout: 10000 });

    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible();
    await textarea.fill(SAMPLE_EMAILS);

    const startButton = page.locator('button:has-text("Start Check")');
    await expect(startButton).toBeEnabled();
    await startButton.click();

    await expect(page.locator('[data-testid="progress-text"]')).toBeVisible({ timeout: 10000 });
    const progressText = page.locator('[data-testid="progress-text"]');

    let lastCompleted = 0;
    const startTime = Date.now();

    while (true) {
      const text = await progressText.textContent();
      const match = text.match(/(\d+)\s*\/\s*(\d+)/);
      if (match) {
        const completed = parseInt(match[1]);
        const total = parseInt(match[2]);
        expect(total).toBe(TOTAL_EMAILS);

        if (completed > lastCompleted) lastCompleted = completed;
        if (completed >= TOTAL_EMAILS) break;
      }

      if (Date.now() - startTime > 540000) {
        throw new Error(`Timed out after 9 minutes. Progress: ${lastCompleted}/${TOTAL_EMAILS}`);
      }

      await page.waitForTimeout(2000);
    }

    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`VM bulk completed: ${TOTAL_EMAILS} emails in ${elapsed.toFixed(1)}s`);

    const workingButton = page.locator('button:has-text("Working")');
    const invalidButton = page.locator('button:has-text("Invalid")');
    await expect(workingButton).toBeVisible({ timeout: 10000 });

    const allButton = page.locator('button:has-text("All")').first();
    const allText = await allButton.textContent();
    expect(allText).toContain(`${TOTAL_EMAILS}`);

    const workingText = await workingButton.textContent();
    const invalidText = await invalidButton.textContent();
    const workingMatch = workingText.match(/\((\d+)\)/);
    const invalidMatch = invalidText.match(/\((\d+)\)/);
    const workingCount = workingMatch ? parseInt(workingMatch[1]) : 0;
    const invalidCount = invalidMatch ? parseInt(invalidMatch[1]) : 0;
    console.log(`VM results: ${workingCount} working, ${invalidCount} invalid`);

    const copyButton = page.locator('button:has-text("Copy")');
    await expect(copyButton).toBeVisible();
    const excelButton = page.locator('button:has-text("Excel")');
    await expect(excelButton).toBeVisible();

    await workingButton.click();
    await page.waitForTimeout(500);
    await invalidButton.click();
    await page.waitForTimeout(500);
    await allButton.click();
  });
});

test.describe("Production Site — Admin Panel", () => {
  test("admin tabs and settings load", async ({ page }) => {
    await login(page);
    await page.locator("aside").locator("text=Admin Panel").click();
    await expect(page.locator("h1:has-text('Admin')")).toBeVisible({ timeout: 10000 });

    await expect(page.locator("main").locator("button:has-text('Users')").first()).toBeVisible();
    await expect(page.locator("main").locator("button:has-text('Settings')").first()).toBeVisible();
    await expect(page.locator("main").locator("button:has-text('Feature Controls')").first()).toBeVisible();
    await expect(page.locator("main").locator("button:has-text('Vouchers')").first()).toBeVisible();
    await expect(page.locator("main").locator("button:has-text('All Logs')").first()).toBeVisible();

    await page.locator("main").locator("button:has-text('Settings')").first().click();
    await expect(page.locator("text=Credit Costs")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=Concurrency Settings")).toBeVisible();
    await expect(page.locator("text=TR Workers")).toBeVisible();
    await expect(page.locator("text=CP Workers")).toBeVisible();
    await expect(page.locator("text=VM Workers")).toBeVisible();
  });

  test("users tab shows users", async ({ page }) => {
    await login(page);
    await page.locator("aside").locator("text=Admin Panel").click();
    await expect(page.locator("h1:has-text('Admin')")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("main").locator(`button:has-text("${USERNAME}")`)).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Production Site — Other Pages", () => {
  test("Proxy page loads", async ({ page }) => {
    await login(page);
    await page.locator("aside").locator("text=Proxy").click();
    await expect(page.locator("h1:has-text('Proxy')")).toBeVisible({ timeout: 10000 });
  });

  test("Logs page loads", async ({ page }) => {
    await login(page);
    await page.locator("aside").locator("text=My Logs").click();
    await expect(page.locator("h1:has-text('Logs')")).toBeVisible({ timeout: 10000 });
  });

  test("IMAP page loads", async ({ page }) => {
    await login(page);
    await page.locator("aside").locator("text=IMAP").click();
    await expect(page.locator("h1:has-text('IMAP')")).toBeVisible({ timeout: 10000 });
  });

  test("Buy Credits page loads", async ({ page }) => {
    await login(page);
    await page.locator("aside").locator("text=Buy Credits").click();
    await expect(page.locator("h1:has-text('Buy Credits')")).toBeVisible({ timeout: 10000 });
  });

  test("Change Password page loads with inputs", async ({ page }) => {
    await login(page);
    await page.locator("aside").locator("text=Change Password").click();
    await expect(page.locator("h1:has-text('Change Password')")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("textarea")).toBeVisible();
    const startBtn = page.locator('button:has-text("Start Change")');
    await expect(startBtn).toBeVisible();
    await expect(startBtn).toBeDisabled();
  });

  test("Trigger Reset start button disabled when empty", async ({ page }) => {
    await login(page);
    const startBtn = page.locator('[data-testid="button-start"]');
    await expect(startBtn).toBeVisible({ timeout: 10000 });
    await expect(startBtn).toBeDisabled();
  });
});
