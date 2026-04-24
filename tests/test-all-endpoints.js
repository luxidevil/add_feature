const { startAll } = require("./mock-droplets");

const BASE = "http://localhost:5000";
let TOKEN = "";
let TEST_API_KEY = "";
let mockServers = [];

async function api(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`${BASE}${path}`, opts);
  const text = await resp.text();
  try {
    return { status: resp.status, data: JSON.parse(text), headers: Object.fromEntries(resp.headers.entries()) };
  } catch {
    return { status: resp.status, data: text, headers: Object.fromEntries(resp.headers.entries()) };
  }
}

async function apiStream(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const resp = await fetch(`${BASE}${path}`, { method, headers, body: JSON.stringify(body) });
  const text = await resp.text();
  const lines = text.trim().split("\n").filter(Boolean);
  const results = [];
  for (const line of lines) {
    try { results.push(JSON.parse(line)); } catch { results.push({ raw: line }); }
  }
  return { status: resp.status, results, contentType: resp.headers.get("content-type") };
}

let passed = 0;
let failed = 0;
const failures = [];

function assert(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push({ name, detail });
    console.log(`  ✗ ${name} — ${detail || "assertion failed"}`);
  }
}

async function updateDropletUrls() {
  const r = await api("PUT", "/api/admin/settings", {
    droplet_trigger_reset: "http://localhost:4001",
    droplet_change_password: "http://localhost:4002",
    droplet_check_email: "http://localhost:4003",
  }, TOKEN);
  assert("Update droplet URLs to mock servers", r.status === 200, `status=${r.status} data=${JSON.stringify(r.data)}`);
}

async function testHealth() {
  console.log("\n=== Health Check ===");
  const r = await api("GET", "/api/healthz");
  assert("Health returns ok", r.status === 200 && r.data.status === "ok", JSON.stringify(r.data));
}

async function testAuth() {
  console.log("\n=== Auth ===");
  const r = await api("POST", "/api/auth/login", { username: "LUXIdepil", password: "DeepAK@4180" });
  assert("Login returns token", r.status === 200 && r.data.token, `status=${r.status}`);
  TOKEN = r.data.token;

  const me = await api("GET", "/api/auth/me", null, TOKEN);
  assert("Me returns user", me.status === 200 && me.data.username === "LUXIdepil", JSON.stringify(me.data));

  const badLogin = await api("POST", "/api/auth/login", { username: "bad", password: "bad" });
  assert("Bad login returns 401", badLogin.status === 401, `status=${badLogin.status}`);

  const noAuth = await api("GET", "/api/auth/me");
  assert("No token returns 401", noAuth.status === 401, `status=${noAuth.status}`);
}

async function testTestMode() {
  console.log("\n=== Test Mode ===");
  const status = await api("GET", "/api/test/status");
  assert("Test status accessible without auth", status.status === 200, `status=${status.status}`);

  const info = await api("GET", "/api/test/info", null, TOKEN);
  assert("Test info returns key", info.status === 200 && info.data.test_api_key, JSON.stringify(info.data));
  TEST_API_KEY = info.data.test_api_key;

  const ping = await api("GET", "/api/test/ping", null, TOKEN);
  assert("Ping with JWT works", ping.status === 200 && ping.data.ok, JSON.stringify(ping.data));

  const pingTest = await api("GET", "/api/test/ping", null, TEST_API_KEY);
  assert("Ping with test key works", pingTest.status === 200 && pingTest.data.mode === "test_key", JSON.stringify(pingTest.data));
}

async function testSettings() {
  console.log("\n=== Settings ===");
  const get = await api("GET", "/api/admin/settings", null, TOKEN);
  assert("Get settings", get.status === 200 && get.data.credit_cost_trigger_reset, JSON.stringify(get.data).slice(0, 100));

  const conc = await api("GET", "/api/proxy/concurrency", null, TOKEN);
  assert("Get concurrency", conc.status === 200 && conc.data.trigger_reset > 0, JSON.stringify(conc.data));
}

async function testPricing() {
  console.log("\n=== Pricing ===");
  const r = await api("GET", "/api/user/pricing", null, TOKEN);
  assert("Pricing returns array", r.status === 200 && Array.isArray(r.data), `length=${r.data?.length}`);
  assert("Pricing has credit costs", r.data.some(i => i.key === "credit_cost_check_email"), "missing credit_cost_check_email");
}

async function testSingleCheckEmail() {
  console.log("\n=== Single Check Email ===");
  const r = await api("POST", "/api/proxy/check-email", { email: "test@gmail.com" }, TOKEN);
  assert("Check email returns result", r.status === 200, `status=${r.status}`);
  assert("Check email has status field", !!r.data.status, JSON.stringify(r.data));
  assert("Check email deducted credits", r.data.creditsUsed === 0.25, `creditsUsed=${r.data.creditsUsed}`);
  assert("Check email returns newCredits", typeof r.data.newCredits === "number", `newCredits=${r.data.newCredits}`);

  const noEmail = await api("POST", "/api/proxy/check-email", {}, TOKEN);
  assert("Check email requires email", noEmail.status === 400, `status=${noEmail.status}`);

  const testKeyR = await api("POST", "/api/proxy/check-email", { email: "testkey@gmail.com" }, TEST_API_KEY);
  assert("Check email works with test key", testKeyR.status === 200, `status=${testKeyR.status} data=${JSON.stringify(testKeyR.data)}`);
}

async function testSingleTriggerReset() {
  console.log("\n=== Single Trigger Reset ===");
  const r = await api("POST", "/api/proxy/trigger-reset", { email: "test@gmail.com", country: "US" }, TOKEN);
  assert("Trigger reset returns result", r.status === 200, `status=${r.status}`);
  assert("Trigger reset has status", r.data.status === "success" || r.data.status === "failed", `status=${r.data.status}`);
  assert("Trigger reset deducted credits", r.data.creditsUsed === 1, `creditsUsed=${r.data.creditsUsed}`);

  const noBody = await api("POST", "/api/proxy/trigger-reset", {}, TOKEN);
  assert("Trigger reset requires fields", noBody.status === 400, `status=${noBody.status}`);
}

async function testSingleChangePassword() {
  console.log("\n=== Single Change Password ===");
  const r = await api("POST", "/api/proxy/change-password", {
    resetUrl: "https://netflix.com/reset/abc123",
    newPassword: "NewPass!123",
    country: "US",
  }, TOKEN);
  assert("Change password returns result", r.status === 200, `status=${r.status}`);
  assert("Change password has status", r.data.status === "success" || r.data.status === "failed", `status=${r.data.status}`);
  assert("Change password deducted credits", r.data.creditsUsed === 1.5, `creditsUsed=${r.data.creditsUsed}`);

  const noBody = await api("POST", "/api/proxy/change-password", {}, TOKEN);
  assert("Change password requires fields", noBody.status === 400, `status=${noBody.status}`);
}

async function testBulkCheckEmail() {
  console.log("\n=== Bulk Check Email (100 emails) ===");
  const emails = [];
  for (let i = 1; i <= 100; i++) emails.push(`bulktest${i}@gmail.com`);

  const startCredits = (await api("GET", "/api/auth/me", null, TOKEN)).data.credits;
  const start = Date.now();
  const r = await apiStream("POST", "/api/proxy/check-email-bulk", { emails }, TOKEN);
  const elapsed = Date.now() - start;
  const endCredits = (await api("GET", "/api/auth/me", null, TOKEN)).data.credits;

  assert("Bulk CE content-type is NDJSON", r.contentType?.includes("ndjson"), `type=${r.contentType}`);
  assert("Bulk CE returns 100 results + done marker", r.results.length === 101, `got ${r.results.length} lines`);

  const resultLines = r.results.filter(l => !l.__done && !l.__error);
  const doneLine = r.results.find(l => l.__done);
  assert("Bulk CE has 100 result lines", resultLines.length === 100, `got ${resultLines.length}`);
  assert("Bulk CE done marker present", !!doneLine, "missing __done");
  assert("Bulk CE done has newCredits", typeof doneLine?.newCredits === "number", `newCredits=${doneLine?.newCredits}`);

  const allHaveEmail = resultLines.every(l => l.email);
  assert("Bulk CE all results have email field", allHaveEmail, "some missing email");
  const allHaveStatus = resultLines.every(l => l.status);
  assert("Bulk CE all results have status field", allHaveStatus, "some missing status");
  const allHaveCreditsUsed = resultLines.every(l => l.creditsUsed === 0.25);
  assert("Bulk CE all results have correct creditsUsed", allHaveCreditsUsed, "some wrong creditsUsed");

  const expectedDeduction = 100 * 0.25;
  const actualDeduction = startCredits - endCredits;
  assert("Bulk CE correct total credits deducted", Math.abs(actualDeduction - expectedDeduction) < 0.01,
    `expected=${expectedDeduction} actual=${actualDeduction}`);

  const noError = r.results.filter(l => l.__error);
  assert("Bulk CE no fatal errors", noError.length === 0, `errors: ${JSON.stringify(noError)}`);

  console.log(`  ℹ Bulk CE completed in ${elapsed}ms for 100 emails`);

  const empty = await apiStream("POST", "/api/proxy/check-email-bulk", { emails: [] }, TOKEN);
  assert("Bulk CE rejects empty array", empty.status === 400, `status=${empty.status}`);
}

async function testBulkTriggerReset() {
  console.log("\n=== Bulk Trigger Reset (100 items) ===");
  const items = [];
  for (let i = 1; i <= 100; i++) items.push({ email: `bulktr${i}@gmail.com`, country: "US" });

  const startCredits = (await api("GET", "/api/auth/me", null, TOKEN)).data.credits;
  const start = Date.now();
  const r = await apiStream("POST", "/api/proxy/trigger-reset-bulk", { items }, TOKEN);
  const elapsed = Date.now() - start;
  const endCredits = (await api("GET", "/api/auth/me", null, TOKEN)).data.credits;

  assert("Bulk TR content-type is NDJSON", r.contentType?.includes("ndjson"), `type=${r.contentType}`);
  const resultLines = r.results.filter(l => !l.__done && !l.__error);
  const doneLine = r.results.find(l => l.__done);
  assert("Bulk TR has 100 result lines", resultLines.length === 100, `got ${resultLines.length}`);
  assert("Bulk TR done marker present", !!doneLine, "missing __done");

  const allHaveEmail = resultLines.every(l => l.email);
  assert("Bulk TR all results have email", allHaveEmail, "some missing email");
  const allHaveStatus = resultLines.every(l => l.status === "success" || l.status === "failed");
  assert("Bulk TR all results have valid status", allHaveStatus, "some invalid status");
  const allHaveCredits = resultLines.every(l => l.creditsUsed === 1);
  assert("Bulk TR all results have correct creditsUsed", allHaveCredits, "some wrong creditsUsed");

  const expectedDeduction = 100 * 1;
  const actualDeduction = startCredits - endCredits;
  assert("Bulk TR correct total credits deducted", Math.abs(actualDeduction - expectedDeduction) < 0.01,
    `expected=${expectedDeduction} actual=${actualDeduction}`);

  console.log(`  ℹ Bulk TR completed in ${elapsed}ms for 100 items`);
}

async function testBulkChangePassword() {
  console.log("\n=== Bulk Change Password (100 items) ===");
  const items = [];
  for (let i = 1; i <= 100; i++) {
    items.push({ resetUrl: `https://netflix.com/reset/bulk${i}`, newPassword: `BulkPass${i}!`, country: "US" });
  }

  const startCredits = (await api("GET", "/api/auth/me", null, TOKEN)).data.credits;
  const start = Date.now();
  const r = await apiStream("POST", "/api/proxy/change-password-bulk", { items }, TOKEN);
  const elapsed = Date.now() - start;
  const endCredits = (await api("GET", "/api/auth/me", null, TOKEN)).data.credits;

  assert("Bulk CP content-type is NDJSON", r.contentType?.includes("ndjson"), `type=${r.contentType}`);
  const resultLines = r.results.filter(l => !l.__done && !l.__error);
  const doneLine = r.results.find(l => l.__done);
  assert("Bulk CP has 100 result lines", resultLines.length === 100, `got ${resultLines.length}`);
  assert("Bulk CP done marker present", !!doneLine, "missing __done");

  const allHaveStatus = resultLines.every(l => l.status === "success" || l.status === "failed");
  assert("Bulk CP all results have valid status", allHaveStatus, "some invalid status");
  const allHaveCredits = resultLines.every(l => l.creditsUsed === 1.5);
  assert("Bulk CP all results have correct creditsUsed", allHaveCredits, "some wrong creditsUsed");

  const expectedDeduction = 100 * 1.5;
  const actualDeduction = startCredits - endCredits;
  assert("Bulk CP correct total credits deducted", Math.abs(actualDeduction - expectedDeduction) < 0.01,
    `expected=${expectedDeduction} actual=${actualDeduction}`);

  console.log(`  ℹ Bulk CP completed in ${elapsed}ms for 100 items`);
}

async function testAdminEndpoints() {
  console.log("\n=== Admin Endpoints ===");
  const users = await api("GET", "/api/admin/users", null, TOKEN);
  assert("List users", users.status === 200 && Array.isArray(users.data), `count=${users.data?.length}`);

  const logs = await api("GET", "/api/admin/logs?limit=5", null, TOKEN);
  assert("Admin logs", logs.status === 200 && Array.isArray(logs.data), `count=${logs.data?.length}`);

  const vouchers = await api("POST", "/api/admin/vouchers", { amount: 10, credits: 100 }, TOKEN);
  assert("Create vouchers", vouchers.status === 200 || vouchers.status === 201, `status=${vouchers.status}`);

  const listVouchers = await api("GET", "/api/admin/vouchers", null, TOKEN);
  assert("List vouchers", listVouchers.status === 200, `status=${listVouchers.status}`);

  const proxies = await api("GET", "/api/admin/proxies", null, TOKEN);
  assert("List proxies", proxies.status === 200, `status=${proxies.status}`);

  const noAdminAuth = await api("GET", "/api/admin/users");
  assert("Admin requires auth", noAdminAuth.status === 401, `status=${noAdminAuth.status}`);
}

async function testUserEndpoints() {
  console.log("\n=== User Endpoints ===");
  const pricing = await api("GET", "/api/user/pricing", null, TOKEN);
  assert("User pricing", pricing.status === 200, `status=${pricing.status}`);

  const logs = await api("GET", "/api/user/logs", null, TOKEN);
  assert("User logs", logs.status === 200 && Array.isArray(logs.data), `status=${logs.status}`);

  const imap = await api("GET", "/api/user/imap", null, TOKEN);
  assert("User IMAP list", imap.status === 200, `status=${imap.status}`);

  const proxy = await api("GET", "/api/user/proxy", null, TOKEN);
  assert("User proxy list", proxy.status === 200, `status=${proxy.status}`);
}

async function testConcurrencyLimits() {
  console.log("\n=== Concurrency Limits ===");
  await api("PUT", "/api/admin/settings", { concurrency_check_email: "0" }, TOKEN);
  const conc0 = await api("GET", "/api/proxy/concurrency", null, TOKEN);
  assert("Concurrency 0 clamped to 1", conc0.data.check_email >= 1, `check_email=${conc0.data.check_email}`);

  await api("PUT", "/api/admin/settings", { concurrency_check_email: "999" }, TOKEN);
  const conc999 = await api("GET", "/api/proxy/concurrency", null, TOKEN);
  assert("Concurrency 999 reported (clamped at runtime)", typeof conc999.data.check_email === "number", `check_email=${conc999.data.check_email}`);

  await api("PUT", "/api/admin/settings", { concurrency_check_email: "30" }, TOKEN);
}

async function testInsufficientCredits() {
  console.log("\n=== Insufficient Credits ===");
  const createR = await api("POST", "/api/admin/users", { username: "broke_user", password: "Test1234!", role: "user" }, TOKEN);
  let brokeUserId = createR.data?.id || createR.data?._id;

  if (brokeUserId) {
    await api("PUT", `/api/admin/users/${brokeUserId}/credits`, { credits: 0, mode: "set" }, TOKEN);
    const loginR = await api("POST", "/api/auth/login", { username: "broke_user", password: "Test1234!" });
    const brokeToken = loginR.data?.token;

    if (brokeToken) {
      const ce = await api("POST", "/api/proxy/check-email", { email: "test@gmail.com" }, brokeToken);
      assert("Insufficient credits returns 402", ce.status === 402, `status=${ce.status}`);
      assert("Insufficient credits error message", ce.data.error === "Insufficient credits", ce.data.error);
    }

    await api("DELETE", `/api/admin/users/${brokeUserId}`, null, TOKEN);
  }
}

async function testDropletHealth() {
  console.log("\n=== Droplet Health Check ===");
  const r = await api("POST", "/api/admin/droplet-health", { url: "http://142.93.4.225:3000" }, TOKEN);
  assert("Droplet health endpoint accepts valid URL", r.status === 200 || r.status === 500, `status=${r.status} data=${JSON.stringify(r.data).slice(0, 200)}`);

  const noUrl = await api("POST", "/api/admin/droplet-health", {}, TOKEN);
  assert("Droplet health requires URL", noUrl.status === 400, `status=${noUrl.status}`);

  const privateUrl = await api("POST", "/api/admin/droplet-health", { url: "http://localhost:4001" }, TOKEN);
  assert("Droplet health blocks private URLs", privateUrl.status === 400, `status=${privateUrl.status}`);
}

async function run() {
  console.log("Starting mock droplet servers...");
  mockServers = await startAll();

  console.log("\n" + "=".repeat(60));
  console.log("  DEALER-DXB DASHBOARD — COMPREHENSIVE API TEST SUITE");
  console.log("=".repeat(60));

  await testHealth();
  await testAuth();
  await testTestMode();
  await testSettings();
  await updateDropletUrls();
  await testPricing();
  await testSingleCheckEmail();
  await testSingleTriggerReset();
  await testSingleChangePassword();
  await testBulkCheckEmail();
  await testBulkTriggerReset();
  await testBulkChangePassword();
  await testAdminEndpoints();
  await testUserEndpoints();
  await testConcurrencyLimits();
  await testInsufficientCredits();
  await testDropletHealth();

  console.log("\n" + "=".repeat(60));
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log("=".repeat(60));

  if (failures.length > 0) {
    console.log("\n  FAILURES:");
    for (const f of failures) {
      console.log(`    ✗ ${f.name}: ${f.detail}`);
    }
  }

  await api("PUT", "/api/admin/settings", {
    droplet_trigger_reset: "http://142.93.4.225:3000",
    droplet_change_password: "http://159.89.172.195:3000",
    droplet_check_email: "http://139.59.42.65:3000",
  }, TOKEN);
  console.log("\n  ✓ Restored original droplet URLs");

  for (const s of mockServers) s.close();
  console.log("  ✓ Mock servers stopped");
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error("Test runner crashed:", err);
  for (const s of mockServers) s.close();
  process.exit(1);
});
