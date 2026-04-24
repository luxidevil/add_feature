#!/usr/bin/env node
/**
 * DEALER-DXB end-to-end test suite — covers every dashboard feature.
 *
 *   npm run test:e2e:fast            # safe: no DB writes, no Netflix call (~30s)
 *   MONGO_URI=... ALLOW_DB_MUTATION=1 npm run test:e2e
 *                                    # full incl. live OTP roundtrip (~2min)
 *   MONGO_URI=... ALLOW_DB_MUTATION=1 ADMIN_USERNAME=... ADMIN_PASSWORD=... npm run test:e2e
 *                                    # also covers admin-only routes (~3min)
 *
 * Required env (only when ALLOW_DB_MUTATION=1 or admin tests):
 *   MONGO_URI         MongoDB URI (no fallback — must be supplied)
 *
 * Optional env:
 *   BASE                base URL of dashboard (default http://localhost:5000)
 *   ADMIN_USERNAME      admin login → enables admin/* tests
 *   ADMIN_PASSWORD      admin password
 *   ALLOW_DB_MUTATION=1 enable direct-DB seeding for live OTP test
 *   SKIP_LIVE_OTP=1     skip the signup-code droplet round-trip
 *   IMAP_USER_ID        ObjectId of the user whose IMAP creds to clone for OTP
 *                       (default = dmahesh)
 *   TEST_OTP_EMAIL      email to send the OTP to
 */

"use strict";

const { MongoClient, ObjectId } = require("mongodb");

const BASE = (process.env.BASE || "http://localhost:5000").replace(/\/$/, "");
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SKIP_LIVE_OTP = process.env.SKIP_LIVE_OTP === "1";
const ALLOW_DB_MUTATION = process.env.ALLOW_DB_MUTATION === "1";
const IMAP_USER_ID = process.env.IMAP_USER_ID || "69e4fbde0d7b4af04edbdcae";
const MONGO_URI = process.env.MONGO_URI || "";
const TEST_OTP_EMAIL = process.env.TEST_OTP_EMAIL || "ciaa009988@outlook.com";

const TEST_USERNAME = `e2e_test_${Date.now().toString(36)}`;
const TEST_PASSWORD = "e2e_pass_1234";
const TEST_USERNAME_2 = `e2e_test2_${Date.now().toString(36)}`; // for admin user CRUD
const LIVE_TIMEOUT_MS = 180_000;

const results = [];
let passed = 0, failed = 0, skipped = 0;
function record(name, status, detail) {
  results.push({ name, status, detail });
  const tag = status === "PASS" ? "\x1b[32m✓\x1b[0m" : status === "FAIL" ? "\x1b[31m✗\x1b[0m" : "\x1b[33m∘\x1b[0m";
  if (status === "PASS") passed++; else if (status === "FAIL") failed++; else skipped++;
  console.log(`  ${tag} ${name.padEnd(60)} ${detail || ""}`);
}

async function api(method, path, body, token, { timeout = 30_000, raw = false } = {}) {
  const hasBody = body !== undefined && body !== null && method !== "GET";
  const headers = {};
  if (hasBody) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: hasBody ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await r.text();
    if (raw) return { status: r.status, text, contentType: r.headers.get("content-type") };
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data, contentType: r.headers.get("content-type") };
  } finally { clearTimeout(t); }
}

async function apiStream(method, path, body, token, { timeout = LIVE_TIMEOUT_MS } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    const text = await r.text();
    const lines = text.trim().split("\n").filter(Boolean);
    const events = lines.map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } });
    return { status: r.status, events };
  } finally { clearTimeout(t); }
}

let mongoClient = null;
async function mongo() {
  if (!MONGO_URI) throw new Error("MONGO_URI not set");
  if (!mongoClient) { mongoClient = new MongoClient(MONGO_URI); await mongoClient.connect(); }
  return mongoClient.db("dealer-dxb");
}

// Wraps an async test in try/catch → records FAIL on throw.
async function check(name, fn) {
  try { await fn(); }
  catch (e) { record(name, "FAIL", e.message); }
}

// ════════════════════════════════════════════════════════════════════════════
async function run() {
  console.log(`\n=== DEALER-DXB E2E suite ===`);
  console.log(`Base:           ${BASE}`);
  console.log(`Admin tests:    ${ADMIN_USERNAME ? "enabled" : "skipped (no ADMIN_USERNAME)"}`);
  console.log(`Live OTP smoke: ${SKIP_LIVE_OTP ? "skipped" : (ALLOW_DB_MUTATION && MONGO_URI ? "enabled" : "skipped (needs MONGO_URI + ALLOW_DB_MUTATION=1)")}`);

  let userToken = "", userId = "", adminToken = "", createdUserId = "", createdVoucher = "", mutated = false;
  let createdProxyId = "";

  try {
    // ────────────────────────────────────────────────────────────────────
    // [1] HEALTH
    // ────────────────────────────────────────────────────────────────────
    console.log(`\n[1] Health & public routes`);
    await check("dashboard /api/healthz", async () => {
      const r = await api("GET", "/api/healthz");
      record("dashboard /api/healthz", r.status === 200 && r.data?.status === "ok" ? "PASS" : "FAIL", `HTTP ${r.status}`);
    });
    await check("/api/test/status (public)", async () => {
      const r = await api("GET", "/api/test/status");
      record("/api/test/status (public)", r.status === 200 ? "PASS" : "FAIL", `HTTP ${r.status}`);
    });

    // ────────────────────────────────────────────────────────────────────
    // [2] AUTH + AUTHZ
    // ────────────────────────────────────────────────────────────────────
    console.log(`\n[2] Auth + authz`);
    {
      const reg = await api("POST", "/api/auth/register", { username: TEST_USERNAME, password: TEST_PASSWORD });
      record("register temp user", reg.status === 200 || reg.status === 201 ? "PASS" : "FAIL", `HTTP ${reg.status}`);

      const dup = await api("POST", "/api/auth/register", { username: TEST_USERNAME, password: TEST_PASSWORD });
      record("register rejects duplicate username", dup.status === 409 || dup.status === 400 ? "PASS" : "FAIL", `HTTP ${dup.status}`);

      const short = await api("POST", "/api/auth/register", { username: "x", password: "123" });
      record("register rejects short password", short.status === 400 ? "PASS" : "FAIL", `HTTP ${short.status}`);

      const lo = await api("POST", "/api/auth/login", { username: TEST_USERNAME, password: TEST_PASSWORD });
      userToken = lo.data?.token || "";
      record("login temp user", lo.status === 200 && userToken ? "PASS" : "FAIL", `HTTP ${lo.status}`);

      const me = await api("GET", "/api/auth/me", null, userToken);
      const u = me.data?.user || me.data;
      userId = u?.id || u?._id || "";
      record("/api/auth/me returns user", me.status === 200 && u?.username === TEST_USERNAME ? "PASS" : "FAIL", `HTTP ${me.status}`);

      const bad = await api("POST", "/api/auth/login", { username: TEST_USERNAME, password: "wrong_password" });
      record("login rejects wrong password", bad.status === 401 ? "PASS" : "FAIL", `HTTP ${bad.status}`);

      const noauth = await api("GET", "/api/user/imap");
      record("user route requires auth", noauth.status === 401 ? "PASS" : "FAIL", `HTTP ${noauth.status}`);

      const denied = await api("GET", "/api/admin/users", null, userToken);
      record("non-admin blocked from /admin", denied.status === 403 || denied.status === 401 ? "PASS" : "FAIL", `HTTP ${denied.status}`);

      const denied2 = await api("GET", "/api/test/info", null, userToken);
      record("non-admin blocked from /test/info", denied2.status === 403 || denied2.status === 401 ? "PASS" : "FAIL", `HTTP ${denied2.status}`);

      const ping = await api("GET", "/api/test/ping", null, userToken);
      record("/api/test/ping (authed)", ping.status === 200 ? "PASS" : "FAIL", `HTTP ${ping.status}`);
    }

    // ────────────────────────────────────────────────────────────────────
    // [3] USER profile + reads
    // ────────────────────────────────────────────────────────────────────
    console.log(`\n[3] User reads`);
    {
      const p = await api("GET", "/api/user/pricing", null, userToken);
      const hasSC = p.data && JSON.stringify(p.data).includes("signup_code");
      record("/user/pricing has signup_code", p.status === 200 && hasSC ? "PASS" : "FAIL", `HTTP ${p.status}`);

      const im = await api("GET", "/api/user/imap", null, userToken);
      record("/user/imap (empty list)", im.status === 200 && Array.isArray(im.data) && im.data.length === 0 ? "PASS" : "FAIL", `HTTP ${im.status} len=${Array.isArray(im.data)?im.data.length:'?'}`);

      const px = await api("GET", "/api/user/proxy", null, userToken);
      record("/user/proxy (null for new user)", px.status === 200 && px.data === null ? "PASS" : "FAIL", `HTTP ${px.status}`);

      const ch = await api("GET", "/api/user/credits/history", null, userToken);
      record("/user/credits/history responds", ch.status === 200 ? "PASS" : "FAIL", `HTTP ${ch.status}`);

      const lg = await api("GET", "/api/user/logs", null, userToken);
      record("/user/logs responds", lg.status === 200 ? "PASS" : "FAIL", `HTTP ${lg.status}`);

      const th = await api("GET", "/api/user/credits/topup/history", null, userToken);
      record("/user/credits/topup/history responds", th.status === 200 ? "PASS" : "FAIL", `HTTP ${th.status}`);
    }

    // ────────────────────────────────────────────────────────────────────
    // [4] USER mutations: IMAP + Proxy CRUD lifecycle
    // ────────────────────────────────────────────────────────────────────
    console.log(`\n[4] User mutations (IMAP + Proxy CRUD)`);
    {
      // IMAP CRUD: validation → create → list → delete
      const noField = await api("POST", "/api/user/imap", { provider: "gmail" }, userToken);
      record("POST /user/imap rejects missing email/password", noField.status === 400 ? "PASS" : "FAIL", `HTTP ${noField.status}`);

      const cr = await api("POST", "/api/user/imap",
        { provider: "gmail", email: "fake_e2e@gmail.com", password: "fakepass", imapHost: "imap.gmail.com", imapPort: 993 }, userToken);
      const newImapId = cr.data?.id || "";
      record("POST /user/imap creates row", cr.status === 200 && newImapId ? "PASS" : "FAIL", `id=${newImapId.slice(0,8)}…`);

      const list = await api("GET", "/api/user/imap", null, userToken);
      record("GET /user/imap shows new row", list.status === 200 && Array.isArray(list.data) && list.data.length === 1 ? "PASS" : "FAIL", `len=${Array.isArray(list.data)?list.data.length:'?'}`);

      if (newImapId) {
        const del = await api("DELETE", `/api/user/imap/${newImapId}`, undefined, userToken);
        record("DELETE /user/imap/:id", del.status === 200 && del.data?.success ? "PASS" : "FAIL", `HTTP ${del.status}`);

        const list2 = await api("GET", "/api/user/imap", null, userToken);
        record("GET /user/imap empty after delete", list2.data?.length === 0 ? "PASS" : "FAIL", `len=${list2.data?.length}`);
      }

      // Proxy CRUD: validation → upsert → get → delete
      const pxBad = await api("POST", "/api/user/proxy", { host: "1.2.3.4" }, userToken);
      record("POST /user/proxy rejects missing fields", pxBad.status === 400 ? "PASS" : "FAIL", `HTTP ${pxBad.status}`);

      const pxOk = await api("POST", "/api/user/proxy",
        { host: "127.0.0.1", port: 8080, username: "u", password: "p" }, userToken);
      record("POST /user/proxy upserts", pxOk.status === 200 && pxOk.data?.success ? "PASS" : "FAIL", `HTTP ${pxOk.status}`);

      const pxGet = await api("GET", "/api/user/proxy", null, userToken);
      record("GET /user/proxy returns saved row", pxGet.status === 200 && pxGet.data?.host === "127.0.0.1" ? "PASS" : "FAIL", `host=${pxGet.data?.host}`);

      const pxDel = await api("DELETE", "/api/user/proxy", undefined, userToken);
      record("DELETE /user/proxy", pxDel.status === 200 && pxDel.data?.success ? "PASS" : "FAIL", `HTTP ${pxDel.status}`);
    }

    // ────────────────────────────────────────────────────────────────────
    // [5] CREDITS — voucher (invalid) + topup hash validation
    // ────────────────────────────────────────────────────────────────────
    console.log(`\n[5] Credits (validation only, no spend)`);
    {
      const noCode = await api("POST", "/api/user/credits/redeem", {}, userToken);
      record("redeem rejects missing code", noCode.status === 400 ? "PASS" : "FAIL", `HTTP ${noCode.status}`);

      const badCode = await api("POST", "/api/user/credits/redeem", { code: "DXB-NONEXISTENT-XXXX" }, userToken);
      record("redeem rejects invalid code", badCode.status === 404 ? "PASS" : "FAIL", `HTTP ${badCode.status}`);

      const badHash = await api("POST", "/api/user/credits/topup", { txHash: "not_a_hash" }, userToken);
      record("topup rejects malformed tx hash", badHash.status === 400 ? "PASS" : "FAIL", `HTTP ${badHash.status}`);

      const badAmt = await api("POST", "/api/user/credits/topup/auto", { usdtAmount: -1 }, userToken);
      record("topup/auto rejects invalid amount", badAmt.status === 400 ? "PASS" : "FAIL", `HTTP ${badAmt.status}`);
    }

    // ────────────────────────────────────────────────────────────────────
    // [6] CR + Proxy operation route validation (no spend)
    // ────────────────────────────────────────────────────────────────────
    console.log(`\n[6] CR + Proxy operation routes (validation)`);
    {
      const sets = await api("GET", "/api/cr/settings", null, userToken);
      record("/cr/settings", sets.status === 200 ? "PASS" : "FAIL", `HTTP ${sets.status}`);

      // Empty inputs → 4xx (proves route mounted + auth'd, no credit spend)
      const validations = [
        ["POST", "/api/cr/check-bulk",            { accounts: "" }],
        ["POST", "/api/cr/signup-code-bulk",      { emails: "" }],
        ["POST", "/api/proxy/check-email",        { email: "" }],
        ["POST", "/api/proxy/check-email-bulk",   { emails: [] }],
        ["POST", "/api/proxy/trigger-reset",      { email: "" }],
        ["POST", "/api/proxy/trigger-reset-bulk", { emails: "" }],
        ["POST", "/api/proxy/change-password",    { email: "" }],
        ["POST", "/api/proxy/change-password-bulk", { accounts: "" }],
      ];
      for (const [m, p, b] of validations) {
        const r = await api(m, p, b, userToken);
        record(`${m} ${p} validates input`, r.status >= 400 && r.status < 500 ? "PASS" : "FAIL", `HTTP ${r.status}`);
      }

      const conc = await api("GET", "/api/proxy/concurrency", null, userToken);
      record("/proxy/concurrency returns config", conc.status === 200 ? "PASS" : "FAIL", `HTTP ${conc.status}`);
    }

    // ────────────────────────────────────────────────────────────────────
    // [7] ADMIN — full coverage
    // ────────────────────────────────────────────────────────────────────
    console.log(`\n[7] Admin (${ADMIN_USERNAME ? "running full suite" : "skipped"})`);
    if (ADMIN_USERNAME && ADMIN_PASSWORD) {
      const lo = await api("POST", "/api/auth/login", { username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
      adminToken = lo.data?.token || "";
      record("admin login", adminToken ? "PASS" : "FAIL", `HTTP ${lo.status}`);

      if (adminToken) {
        // Reads
        const dh = await api("POST", "/api/admin/droplet-health", null, adminToken, { timeout: 60_000 });
        const arr = dh.data?.droplets || (Array.isArray(dh.data) ? dh.data : []);
        const online = arr.filter((d) => d.status === "online" || d.online === true || d.healthy === true).length;
        record("admin droplet-health (≥1 online)", dh.status === 200 && online >= 1 ? "PASS" : "FAIL", `online=${online}/${arr.length || Object.keys(dh.data||{}).length}`);

        for (const [m, p, expectStatus] of [
          ["GET", "/api/admin/users", 200],
          ["GET", "/api/admin/settings", 200],
          ["GET", "/api/admin/vouchers", 200],
          ["GET", "/api/admin/topups", 200],
          ["GET", "/api/admin/logs", 200],
          ["GET", "/api/admin/proxies", 200],
          ["GET", "/api/admin/imap", 200],
          ["GET", "/api/admin/droplet-logs?service=signup-code&limit=5", 200],
        ]) {
          const r = await api(m, p, null, adminToken, { timeout: 60_000 });
          record(`${m} ${p}`, r.status === expectStatus ? "PASS" : "FAIL", `HTTP ${r.status}`);
        }

        // Search (needs ≥2-char query)
        const sBad = await api("GET", "/api/admin/search?email=x", null, adminToken);
        record("/admin/search rejects short query", sBad.status === 400 ? "PASS" : "FAIL", `HTTP ${sBad.status}`);
        const sOk = await api("GET", "/api/admin/search?email=test", null, adminToken);
        record("/admin/search runs", sOk.status === 200 ? "PASS" : "FAIL", `HTTP ${sOk.status}`);

        // Logs export → CSV
        const exp = await api("GET", "/api/admin/logs/export?type=cr-check", null, adminToken, { raw: true, timeout: 60_000 });
        const isCsv = exp.contentType?.includes("text/csv") && exp.text?.startsWith("username,type,email");
        record("/admin/logs/export returns CSV", exp.status === 200 && isCsv ? "PASS" : "FAIL", `HTTP ${exp.status} ct=${exp.contentType}`);

        // User logs (own user)
        if (userId) {
          const ul = await api("GET", `/api/admin/users/${userId}/logs`, null, adminToken);
          record("/admin/users/:id/logs", ul.status === 200 && ul.data?.user?.username === TEST_USERNAME ? "PASS" : "FAIL", `HTTP ${ul.status}`);
        }

        // ── Settings round-trip (preserve original) ─────────────────────
        const cur = await api("GET", "/api/admin/settings", null, adminToken);
        const origCC = cur.data?.credit_cost_signup_code;
        const put = await api("PUT", "/api/admin/settings", { credit_cost_signup_code: origCC ?? "4" }, adminToken);
        record("PUT /admin/settings round-trips", put.status === 200 && put.data?.success ? "PASS" : "FAIL", `HTTP ${put.status}`);

        // ── Voucher create + list + redeem from temp user ───────────────
        const vCr = await api("POST", "/api/admin/vouchers", { credits: 5, count: 1 }, adminToken);
        createdVoucher = vCr.data?.codes?.[0] || "";
        record("POST /admin/vouchers creates", vCr.status === 200 && createdVoucher ? "PASS" : "FAIL", `code=${createdVoucher}`);

        if (createdVoucher) {
          const vUse = await api("POST", "/api/user/credits/redeem", { code: createdVoucher }, userToken);
          record("redeem voucher (full flow)", vUse.status === 200 && vUse.data?.credits === 5 ? "PASS" : "FAIL", `+${vUse.data?.credits} credits, balance=${vUse.data?.newBalance}`);

          const vAgain = await api("POST", "/api/user/credits/redeem", { code: createdVoucher }, userToken);
          record("redeem rejects already-used voucher", vAgain.status === 409 ? "PASS" : "FAIL", `HTTP ${vAgain.status}`);
        }

        // ── User CRUD (admin creates + deletes a 2nd test user) ─────────
        const uCr = await api("POST", "/api/admin/users", { username: TEST_USERNAME_2, password: TEST_PASSWORD, credits: 10 }, adminToken);
        createdUserId = uCr.data?.id || uCr.data?._id || "";
        record("POST /admin/users creates user", uCr.status === 200 && createdUserId ? "PASS" : "FAIL", `id=${createdUserId.slice(0,8)}…`);

        if (createdUserId) {
          const cAdd = await api("PUT", `/api/admin/users/${createdUserId}/credits`, { credits: 50, operation: "set" }, adminToken);
          record("PUT /admin/users/:id/credits sets balance", cAdd.status === 200 && cAdd.data?.credits === 50 ? "PASS" : "FAIL", `credits=${cAdd.data?.credits}`);

          const uDel = await api("DELETE", `/api/admin/users/${createdUserId}`, undefined, adminToken);
          record("DELETE /admin/users/:id", uDel.status === 200 ? "PASS" : "FAIL", `HTTP ${uDel.status}`);
          createdUserId = ""; // cleaned
        }

        // ── Proxy CRUD via admin ────────────────────────────────────────
        if (userId) {
          const pCr = await api("POST", "/api/admin/proxies",
            { userId, host: "127.0.0.1", port: 9999, username: "u", password: "p" }, adminToken);
          record("POST /admin/proxies upserts", pCr.status === 200 && pCr.data?.success ? "PASS" : "FAIL", `HTTP ${pCr.status}`);

          const pList = await api("GET", "/api/admin/proxies", null, adminToken);
          const found = (pList.data || []).find((p) => p.userId === userId);
          createdProxyId = found?.id || "";
          record("GET /admin/proxies includes new row", createdProxyId ? "PASS" : "FAIL", `id=${createdProxyId.slice(0,8)}…`);

          if (createdProxyId) {
            const pPut = await api("PUT", `/api/admin/proxies/${createdProxyId}`, { port: 8888 }, adminToken);
            record("PUT /admin/proxies/:id", pPut.status === 200 ? "PASS" : "FAIL", `HTTP ${pPut.status}`);

            const pDel = await api("DELETE", `/api/admin/proxies/${createdProxyId}`, undefined, adminToken);
            record("DELETE /admin/proxies/:id", pDel.status === 200 ? "PASS" : "FAIL", `HTTP ${pDel.status}`);
            createdProxyId = "";
          }
        }
      }
    } else {
      record("admin tests", "SKIP", "set ADMIN_USERNAME/ADMIN_PASSWORD");
    }

    // ────────────────────────────────────────────────────────────────────
    // [8] LIVE OTP smoke (real Netflix roundtrip)
    // ────────────────────────────────────────────────────────────────────
    console.log(`\n[8] Live OTP smoke (signup-code droplet round-trip)`);
    if (SKIP_LIVE_OTP) {
      record("live signup-code-bulk e2e", "SKIP", "SKIP_LIVE_OTP=1");
    } else if (!MONGO_URI || !ALLOW_DB_MUTATION) {
      record("live signup-code-bulk e2e", "SKIP", "needs MONGO_URI + ALLOW_DB_MUTATION=1");
    } else if (!userId) {
      record("live signup-code-bulk e2e", "SKIP", "no temp userId");
    } else {
      try {
        const db = await mongo();
        const imap = await db.collection("imapcredentials").findOne({ userId: new ObjectId(IMAP_USER_ID) });
        if (!imap) { record("live signup-code-bulk e2e", "SKIP", `no IMAP creds for ${IMAP_USER_ID}`); }
        else {
          await db.collection("users").updateOne({ _id: new ObjectId(userId) }, { $set: { credits: 100 } });
          await db.collection("imapcredentials").updateOne(
            { userId: new ObjectId(userId) },
            { $set: { email: imap.email, password: imap.password, host: imap.host, port: imap.port } },
            { upsert: true }
          );
          mutated = true;
          record("seed credits + IMAP for temp user", "PASS");

          const r = await apiStream("POST", "/api/cr/signup-code-bulk",
            { emails: TEST_OTP_EMAIL }, userToken, { timeout: LIVE_TIMEOUT_MS });
          const final = r.events.find((e) => e.email === TEST_OTP_EMAIL && e.status && e.status !== "queued") ||
                        r.events.find((e) => e.status && e.status !== "queued");
          const strictPass = r.status === 200 && final?.status === "success" && /^\d{4}$/.test(final?.otp || "");
          record("signup-code-bulk → success + OTP",
            strictPass ? "PASS" : "FAIL",
            `events=${r.events.length} status=${final?.status || "?"} otp=${final?.otp || "-"}`);
        }
      } catch (e) { record("live signup-code-bulk e2e", "FAIL", e.message); }
    }

  } finally {
    // ────────────────────────────────────────────────────────────────────
    // [9] CLEANUP — guaranteed even on crash
    // ────────────────────────────────────────────────────────────────────
    console.log(`\n[9] Cleanup`);
    if (MONGO_URI) {
      try {
        const db = await mongo();
        // Temp user 1
        const u = await db.collection("users").findOne({ username: TEST_USERNAME });
        if (u) {
          await db.collection("imapcredentials").deleteMany({ userId: u._id });
          await db.collection("proxycredentials").deleteMany({ userId: u._id });
          await db.collection("logs").deleteMany({ userId: u._id });
          await db.collection("users").deleteOne({ _id: u._id });
        }
        // Temp user 2 (if admin-created and somehow not deleted)
        const u2 = await db.collection("users").findOne({ username: TEST_USERNAME_2 });
        if (u2) {
          await db.collection("imapcredentials").deleteMany({ userId: u2._id });
          await db.collection("proxycredentials").deleteMany({ userId: u2._id });
          await db.collection("users").deleteOne({ _id: u2._id });
        }
        // Test voucher (if admin-created and somehow not used/cleaned)
        if (createdVoucher) await db.collection("vouchers").deleteOne({ code: createdVoucher });
        record("delete temp users + creds + voucher", "PASS", mutated ? "(mutated → cleaned)" : "");
      } catch (e) { record("delete temp users + creds + voucher", "FAIL", e.message); }
      try { await mongoClient?.close(); } catch {}
    } else {
      record("delete temp users + creds + voucher", "SKIP", "no MONGO_URI");
    }

    console.log(`\n=== Summary ===`);
    console.log(`PASS: ${passed}    FAIL: ${failed}    SKIP: ${skipped}`);
    if (failed) {
      console.log(`\nFailures:`);
      for (const r of results.filter((x) => x.status === "FAIL")) console.log(`  - ${r.name}: ${r.detail || ""}`);
    }
    process.exit(failed ? 1 : 0);
  }
}

run().catch((e) => { console.error("Fatal:", e); process.exit(2); });
