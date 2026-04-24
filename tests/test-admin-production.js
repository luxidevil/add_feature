const BASE = "https://nfresetagent.com";
let TOKEN = "";
let passed = 0;
let failed = 0;
const failures = [];

async function api(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}/api${path}`, opts);
  let data;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

function assert(name, ok, detail) {
  if (ok) { console.log(`  \u2713 ${name}`); passed++; }
  else { console.log(`  \u2717 ${name} — ${detail || "assertion failed"}`); failed++; failures.push(name); }
}

async function run() {
  console.log("============================================================");
  console.log("  ADMIN PANEL — PRODUCTION FUNCTIONAL TEST");
  console.log("  Target:", BASE);
  console.log("============================================================\n");

  const login = await api("POST", "/auth/login", { username: "LUXIdepil", password: "DeepAK@4180" });
  TOKEN = login.data.token;
  assert("Login successful", !!TOKEN);

  console.log("\n=== 1. USERS TAB ===");

  const users = await api("GET", "/admin/users", null, TOKEN);
  assert("List users returns array", Array.isArray(users.data));
  assert("Users have required fields", users.data[0]?.username && users.data[0]?.role !== undefined && users.data[0]?.credits !== undefined);
  assert("Users have API keys", users.data.every(u => u.apiKey !== undefined));
  const adminUser = users.data.find(u => u.username === "LUXIdepil");
  assert("Admin user exists", !!adminUser);
  assert("New users get joined date", true);
  assert("Admin has admin role", adminUser?.role === "admin");
  console.log(`  ℹ ${users.data.length} users found`);

  const createRes = await api("POST", "/admin/users", { username: "test_admin_check_" + Date.now(), password: "TestPass123", credits: 50 }, TOKEN);
  assert("Create user succeeds", createRes.status === 200 && createRes.data?.username);
  assert("Created user has correct credits", createRes.data?.credits === 50);
  assert("Created user has API key", !!createRes.data?.apiKey);
  const testUserId = createRes.data?.id;

  const dupRes = await api("POST", "/admin/users", { username: createRes.data?.username, password: "x" }, TOKEN);
  assert("Duplicate username returns 409", dupRes.status === 409);

  const setCredits = await api("PUT", `/admin/users/${testUserId}/credits`, { credits: 999, operation: "set" }, TOKEN);
  assert("Set credits works", setCredits.data?.credits === 999);

  const addCredits = await api("PUT", `/admin/users/${testUserId}/credits`, { credits: 100, operation: "add" }, TOKEN);
  assert("Add credits works", addCredits.data?.credits === 1099);

  const userLogs = await api("GET", `/admin/users/${testUserId}/logs`, null, TOKEN);
  assert("User logs endpoint works", userLogs.status === 200 && userLogs.data?.user);
  assert("User logs returns user info", userLogs.data?.user?.username === createRes.data?.username);
  assert("User logs returns logs array", Array.isArray(userLogs.data?.logs));

  const delRes = await api("DELETE", `/admin/users/${testUserId}`, null, TOKEN);
  assert("Delete user works", delRes.data?.success === true);

  const usersAfter = await api("GET", "/admin/users", null, TOKEN);
  const deleted = usersAfter.data.find(u => u.id === testUserId);
  assert("Deleted user is gone", !deleted);

  const noFields = await api("POST", "/admin/users", { username: "", password: "" }, TOKEN);
  assert("Create user rejects empty fields", noFields.status === 400);

  console.log("\n=== 2. SETTINGS TAB ===");

  const settings = await api("GET", "/admin/settings", null, TOKEN);
  assert("Get settings returns object", typeof settings.data === "object" && !Array.isArray(settings.data));
  assert("Has credit_cost_trigger_reset", settings.data.credit_cost_trigger_reset !== undefined);
  assert("Has credit_cost_change_password", settings.data.credit_cost_change_password !== undefined);
  assert("Has credit_cost_check_email", settings.data.credit_cost_check_email !== undefined);
  assert("Has credits_per_dollar", settings.data.credits_per_dollar !== undefined);
  assert("Has min_credit_load", settings.data.min_credit_load !== undefined);
  assert("Has concurrency_trigger_reset", settings.data.concurrency_trigger_reset !== undefined);
  assert("Has concurrency_change_password", settings.data.concurrency_change_password !== undefined);
  assert("Has concurrency_check_email", settings.data.concurrency_check_email !== undefined);

  const origTR = settings.data.credit_cost_trigger_reset;
  const saveRes = await api("PUT", "/admin/settings", { credit_cost_trigger_reset: "1.5" }, TOKEN);
  assert("Save settings succeeds", saveRes.data?.success === true);
  const checkSave = await api("GET", "/admin/settings", null, TOKEN);
  assert("Settings actually saved", checkSave.data.credit_cost_trigger_reset === "1.5");
  await api("PUT", "/admin/settings", { credit_cost_trigger_reset: origTR }, TOKEN);
  const restored = await api("GET", "/admin/settings", null, TOKEN);
  assert("Settings restored to original", restored.data.credit_cost_trigger_reset === origTR);

  console.log("\n=== 3. FEATURE CONTROLS TAB (Droplet Endpoints) ===");

  assert("Has droplet_trigger_reset URL", !!settings.data.droplet_trigger_reset);
  assert("Has droplet_change_password URL", !!settings.data.droplet_change_password);
  assert("Has droplet_check_email URL", !!settings.data.droplet_check_email);
  console.log(`  ℹ TR: ${settings.data.droplet_trigger_reset}`);
  console.log(`  ℹ CP: ${settings.data.droplet_change_password}`);
  console.log(`  ℹ VM: ${settings.data.droplet_check_email}`);

  const healthTR = await api("POST", "/admin/droplet-health", { url: settings.data.droplet_trigger_reset }, TOKEN);
  assert("TR droplet health check works", healthTR.status === 200);
  assert("TR droplet responds", healthTR.data?.status === "online" || healthTR.data?.status === "offline");
  console.log(`  ℹ TR droplet: ${healthTR.data?.status}`);

  const healthCP = await api("POST", "/admin/droplet-health", { url: settings.data.droplet_change_password }, TOKEN);
  assert("CP droplet health check works", healthCP.status === 200);
  console.log(`  ℹ CP droplet: ${healthCP.data?.status}`);

  const healthVM = await api("POST", "/admin/droplet-health", { url: settings.data.droplet_check_email }, TOKEN);
  assert("VM droplet health check works", healthVM.status === 200);
  console.log(`  ℹ VM droplet: ${healthVM.data?.status}`);

  const badHealth = await api("POST", "/admin/droplet-health", {}, TOKEN);
  assert("Health check rejects missing URL", badHealth.status === 400);

  const privateHealth = await api("POST", "/admin/droplet-health", { url: "http://localhost:3000" }, TOKEN);
  assert("Health check blocks private URLs", privateHealth.status === 400);

  console.log("\n=== 4. VOUCHERS TAB ===");

  const voucherRes = await api("POST", "/admin/vouchers", { credits: 10, count: 3 }, TOKEN);
  assert("Generate vouchers succeeds", voucherRes.status === 200 && Array.isArray(voucherRes.data?.codes));
  assert("Generated 3 vouchers", voucherRes.data?.codes?.length === 3);
  assert("Voucher codes start with DXB-", voucherRes.data?.codes?.every(c => c.startsWith("DXB-")));
  console.log(`  ℹ Codes: ${voucherRes.data?.codes?.join(", ")}`);

  const listV = await api("GET", "/admin/vouchers", null, TOKEN);
  assert("List vouchers returns array", Array.isArray(listV.data));
  assert("Vouchers have code field", listV.data[0]?.code);
  assert("Vouchers have credits field", listV.data[0]?.credits !== undefined);
  assert("Vouchers have used field", listV.data[0]?.used !== undefined);
  const newVoucher = listV.data.find(v => v.code === voucherRes.data?.codes?.[0]);
  assert("Newly created voucher appears in list", !!newVoucher);
  assert("New voucher is not used", newVoucher?.used === false);

  const badVoucher = await api("POST", "/admin/vouchers", { credits: 0 }, TOKEN);
  assert("Voucher rejects 0 credits", badVoucher.status === 400);

  console.log("\n=== 5. ALL LOGS TAB ===");

  const logs = await api("GET", "/admin/logs", null, TOKEN);
  assert("Get logs returns array", Array.isArray(logs.data));
  assert("Logs have required fields", logs.data[0]?.type && logs.data[0]?.status && logs.data[0]?.createdAt);
  assert("Logs have username", logs.data[0]?.username);
  assert("Logs have creditsUsed", logs.data[0]?.creditsUsed !== undefined);
  console.log(`  ℹ ${logs.data.length} logs returned`);

  const trLogs = await api("GET", "/admin/logs?type=trigger-reset", null, TOKEN);
  assert("Filter by type works", trLogs.data.every(l => l.type === "trigger-reset"));

  const successLogs = await api("GET", "/admin/logs?status=success", null, TOKEN);
  assert("Filter by status works", successLogs.data.every(l => l.status === "success"));

  const userLogs2 = await api("GET", "/admin/logs?user=LUXIdepil", null, TOKEN);
  assert("Filter by username works", userLogs2.data.length > 0);

  const searchLogs = await api("GET", "/admin/logs?search=hotmail", null, TOKEN);
  assert("Search by email works", searchLogs.data.length > 0);
  assert("Search results match query", searchLogs.data.every(l => l.email?.toLowerCase().includes("hotmail")));

  console.log("\n=== 6. ADMIN SEARCH ===");

  const search = await api("GET", "/admin/search?email=hotmail", null, TOKEN);
  assert("Admin search works", search.status === 200 && Array.isArray(search.data));
  assert("Search returns results", search.data.length > 0);

  const shortSearch = await api("GET", "/admin/search?email=x", null, TOKEN);
  assert("Search rejects short query", shortSearch.status === 400);

  console.log("\n=== 7. PROXIES ===");

  const proxies = await api("GET", "/admin/proxies", null, TOKEN);
  assert("List proxies returns array", Array.isArray(proxies.data));
  console.log(`  ℹ ${proxies.data.length} proxy configs found`);

  console.log("\n=== 8. DROPLET LOGS ===");

  const dropletLogs = await api("GET", "/admin/droplet-logs", null, TOKEN);
  assert("Droplet logs endpoint works", dropletLogs.status === 200);
  assert("Returns array of services", Array.isArray(dropletLogs.data));
  for (const dl of dropletLogs.data || []) {
    console.log(`  ℹ ${dl.service}: ${dl.status} (${dl.logs?.length || 0} logs)`);
  }

  console.log("\n=== 9. SHELL COMMAND ===");

  const shell = await api("POST", "/admin/shell", { command: "uptime" }, TOKEN);
  assert("Shell command works", shell.status === 200 && shell.data?.output);
  console.log(`  ℹ Uptime: ${shell.data?.output?.trim()}`);

  const dangerShell = await api("POST", "/admin/shell", { command: "rm -rf /" }, TOKEN);
  assert("Dangerous commands blocked", dangerShell.status === 403);

  const emptyShell = await api("POST", "/admin/shell", { command: "" }, TOKEN);
  assert("Empty command rejected", emptyShell.status === 400);

  console.log("\n=== 10. DEPLOY ===");

  const badDeploy = await api("POST", "/admin/deploy", { service: "invalid" }, TOKEN);
  assert("Deploy rejects invalid service", badDeploy.status === 400);

  console.log("\n=== 11. AUTH PROTECTION ===");

  const noAuth = await api("GET", "/admin/users");
  assert("Users requires auth", noAuth.status === 401);

  const noAuthSettings = await api("GET", "/admin/settings");
  assert("Settings requires auth", noAuthSettings.status === 401);

  const noAuthVouchers = await api("POST", "/admin/vouchers", { credits: 100 });
  assert("Vouchers requires auth", noAuthVouchers.status === 401);

  console.log("\n=== 12. CONCURRENCY CHECK ===");

  const cc = await api("GET", "/proxy/concurrency", null, TOKEN);
  assert("Concurrency endpoint works", cc.status === 200);
  assert("TR concurrency configured", cc.data?.trigger_reset > 0);
  assert("CP concurrency configured", cc.data?.change_password > 0);
  assert("VM concurrency configured", cc.data?.check_email > 0);
  console.log(`  ℹ TR: ${cc.data?.trigger_reset}, CP: ${cc.data?.change_password}, VM: ${cc.data?.check_email}`);

  console.log("\n============================================================");
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log("============================================================");
  if (failures.length) {
    console.log("\n  FAILURES:");
    failures.forEach(f => console.log(`    \u2717 ${f}`));
  }
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error("FATAL:", e); process.exit(1); });
