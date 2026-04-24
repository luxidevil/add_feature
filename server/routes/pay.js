const { Router } = require("express");
const fs = require("fs");
const path = require("path");
const { randomIdentity, warmPool } = require("../identity");
const { logger } = require("../lib/logger");

warmPool();

const router = Router();

// ────────────────────────────────────────────────────────────────────────────
// HAR-style audit logging (non-invasive wrapper around fetch).
// Each /pay/session and /pay/checkout attempt produces one JSON file under
// LOG_DIR containing a HAR-like capture (request + response + timing) for
// every external HTTP call it makes. The in-memory ring buffer at
// GET /api/pay/logs keeps a lightweight summary; the full capture is fetched
// on demand from GET /api/pay/logs/har/:file. Files older than 14 days are
// pruned hourly.
// ────────────────────────────────────────────────────────────────────────────
const LOG_DIR = path.resolve(
  process.env.PAY_LOG_DIR ||
  path.join(__dirname, "..", "..", "logs", "pay")
);
try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
} catch (e) {
  logger.warn({ err: e.message, dir: LOG_DIR }, "[pay] could not create HAR log dir");
}

const MAX_RESP_BODY_BYTES = 200 * 1024;
const MAX_REQ_BODY_BYTES  = 50  * 1024;
const HAR_RETENTION_MS    = 14 * 24 * 60 * 60 * 1000;

function cleanupOldHar() {
  try {
    const cutoff = Date.now() - HAR_RETENTION_MS;
    for (const name of fs.readdirSync(LOG_DIR)) {
      if (!name.endsWith(".json")) continue;
      const full = path.join(LOG_DIR, name);
      try {
        const st = fs.statSync(full);
        if (st.mtimeMs < cutoff) fs.unlinkSync(full);
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}
cleanupOldHar();
setInterval(cleanupOldHar, 60 * 60 * 1000).unref();

const PAY_LOGS = [];
const PAY_LOG_MAX = 200;

function payLog(entry) {
  PAY_LOGS.push({ ts: new Date().toISOString(), ...entry });
  if (PAY_LOGS.length > PAY_LOG_MAX) PAY_LOGS.shift();
}

function safeSlice(s, n) {
  if (typeof s !== "string") return s;
  if (s.length <= n) return s;
  return s.slice(0, n) + `\n…[truncated ${s.length - n} more bytes; total=${s.length}]`;
}

function headersToObject(h) {
  if (!h) return {};
  if (typeof h.entries === "function") return Object.fromEntries(h.entries());
  return { ...h };
}

function getSetCookies(res) {
  const raw = res.headers.raw?.()?.["set-cookie"] || res.headers.getSetCookie?.() || [];
  return raw;
}

// captureFetch — wraps fetch() and pushes a HAR-style entry into `steps`.
// The response body is consumed inside; callers must use the returned `body`.
// If `steps` is null (e.g. caller doesn't want capture), behaves like fetch +
// res.text().
async function captureFetch(steps, label, url, opts = {}) {
  const reqBody = typeof opts.body === "string"
    ? opts.body
    : (opts.body == null ? null : String(opts.body));
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const reqEntry = {
    label,
    startedAt,
    request: {
      method:    (opts.method || "GET").toUpperCase(),
      url,
      redirect:  opts.redirect || "manual",
      headers:   headersToObject(opts.headers),
      bodyBytes: reqBody == null ? 0 : Buffer.byteLength(reqBody),
      body:      reqBody == null ? null : safeSlice(reqBody, MAX_REQ_BODY_BYTES),
    },
  };

  let res = null;
  let body = "";
  let networkErr = null;
  try {
    res  = await fetch(url, opts);
    body = await res.text();
  } catch (e) {
    networkErr = e;
  }
  const elapsedMs = Date.now() - t0;

  const respEntry = networkErr
    ? { networkError: networkErr.message, elapsedMs }
    : {
        status:        res.status,
        statusText:    res.statusText || "",
        finalUrl:      res.url || url,
        headers:       headersToObject(res.headers),
        setCookie:     getSetCookies(res).map(c => c.split(";")[0]),
        bodyBytes:     Buffer.byteLength(body),
        bodyTruncated: body.length > MAX_RESP_BODY_BYTES,
        body:          safeSlice(body, MAX_RESP_BODY_BYTES),
        elapsedMs,
      };

  if (steps) steps.push({ ...reqEntry, response: respEntry });

  if (networkErr) {
    const wrapped = new Error(networkErr.message);
    wrapped.cause = networkErr;
    wrapped.networkStep = label;
    throw wrapped;
  }
  return { res, body };
}

function safeFileName(name) {
  return String(name).replace(/[^A-Za-z0-9._-]/g, "_");
}

function savePayHar(meta, steps) {
  const ts   = new Date().toISOString().replace(/[:.]/g, "-");
  const sid8 = (meta.sessionId || "nosid").slice(0, 8);
  const file = safeFileName(`${ts}_${meta.event || "evt"}_${sid8}.json`);
  const full = path.join(LOG_DIR, file);
  const payload = { ts: new Date().toISOString(), ...meta, stepCount: steps.length, steps };
  try {
    fs.writeFileSync(full, JSON.stringify(payload, null, 2), { mode: 0o600 });
    return file;
  } catch (e) {
    logger.error({ err: e.message, file }, "[pay] failed to persist HAR");
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// HAR audit endpoints (used by Admin.jsx)
// ────────────────────────────────────────────────────────────────────────────
router.get("/pay/logs", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, PAY_LOG_MAX);
  res.json(PAY_LOGS.slice(-limit).reverse());
});

router.get("/pay/logs/har", async (_req, res) => {
  try {
    const files = fs.readdirSync(LOG_DIR)
      .filter(f => f.endsWith(".json"))
      .map(f => {
        const st = fs.statSync(path.join(LOG_DIR, f));
        return { file: f, mtime: st.mtimeMs, sizeBytes: st.size };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 100);
    res.json(files);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/pay/logs/har/:file", async (req, res) => {
  const name = safeFileName(req.params.file || "");
  if (!name.endsWith(".json")) return res.status(400).json({ error: "invalid filename" });
  const full = path.join(LOG_DIR, name);
  if (!full.startsWith(LOG_DIR + path.sep)) return res.status(400).json({ error: "invalid path" });
  if (!fs.existsSync(full)) return res.status(404).json({ error: "not found" });
  try {
    res.type("application/json").send(fs.readFileSync(full, "utf8"));
  } catch (e) {
    res.status(500).json({ error: "failed to read HAR: " + e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Identity pool — used by GuestPay autofill button (GET /api/pay/identity)
// ────────────────────────────────────────────────────────────────────────────
router.get("/pay/identity", async (_req, res) => {
  try {
    const id = await randomIdentity();
    res.json(id);
  } catch (e) {
    logger.error({ err: e.message }, "[pay] identity generation failed");
    res.status(503).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Session store — TTL 15 minutes
// ────────────────────────────────────────────────────────────────────────────
const sessions = new Map();
const SESSION_TTL = 15 * 60 * 1000;

function makeSessionId() {
  return require("crypto").randomBytes(24).toString("hex");
}

function cleanSessions() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL) sessions.delete(id);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Upstream WooCommerce constants — kept identical to the working reference.
// ────────────────────────────────────────────────────────────────────────────
const WC_BASE       = "https://unclejimswormfarm.com";
const CHECKOUT_PAGE = `${WC_BASE}/checkouts/check/`;
const CHECKOUT_AJAX = `${WC_BASE}/?wc-ajax=checkout&wfacp_id=1226456&wfacp_is_checkout_override=yes`;
const CART_AJAX     = `${WC_BASE}/?wc-ajax=add_to_cart`;
const PRODUCT_ID    = "773932";
const WFACP_POST_ID = "1226456";

const COMMON_HEADERS = {
  "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

// Extract set-cookie values from a response into a cookie string
function extractCookies(res) {
  const raw = res.headers.raw?.()?.["set-cookie"] || res.headers.getSetCookie?.() || [];
  return raw.map(c => c.split(";")[0]).join("; ");
}

// Merge cookie strings (second wins on duplicate keys)
function mergeCookies(existing, incoming) {
  const map = new Map();
  for (const part of (existing + "; " + incoming).split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    map.set(trimmed.slice(0, eq).trim(), trimmed);
  }
  return Array.from(map.values()).join("; ");
}

// Regex helpers for extracting values from WooCommerce HTML
function extractNonce(html) {
  const m = html.match(/["']woocommerce-process-checkout-nonce["']\s*:\s*["']([a-f0-9]+)["']/i)
         || html.match(/woocommerce-process-checkout-nonce["']?\s+value=["']([a-f0-9]+)["']/i)
         || html.match(/woocommerce_process_checkout.*?nonce.*?["']([a-f0-9]{10})["']/is);
  return m ? m[1] : null;
}

function extractBraintreeToken(html) {
  // WooCommerce Braintree plugin embeds client token in JS params
  const patterns = [
    /wc_braintree_client_token\s*=\s*\[["']([A-Za-z0-9+/=._-]{40,})["']/,
    /client_token["']\s*:\s*["']([A-Za-z0-9+/=._-]{40,})["']/,
    /clientToken["']\s*:\s*["']([A-Za-z0-9+/=._-]{40,})["']/,
    /authorization["']\s*:\s*["']([A-Za-z0-9+/=._-]{40,})["']/,
    /data-client-token=["']([A-Za-z0-9+/=._-]{40,})["']/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1];
  }
  return null;
}

function extractBraintreeConfig(html) {
  const m = html.match(/braintree_cc_config_data["']?\s*:\s*(\{.+?\}(?=\s*[,}]))/s)
          || html.match(/config_data["']?\s*:\s*JSON\.parse\(decodeURIComponent\(['"](.+?)['"]\)\)/);
  if (m) {
    try { return JSON.parse(m[1]); } catch { return null; }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// GET /api/pay/session
// 3-step bootstrap: visit → cart → revisit (matches the working reference).
// ────────────────────────────────────────────────────────────────────────────
router.get("/pay/session", async (req, res) => {
  cleanSessions();
  const t0 = Date.now();
  const steps = [];

  try {
    // Step 1: Visit checkout page — establishes WC session cookies
    const { res: pageResp, body: pageHtml } = await captureFetch(steps, "checkout_page_initial", CHECKOUT_PAGE, {
      headers: COMMON_HEADERS,
      redirect: "follow",
    });
    let cookies = extractCookies(pageResp);

    const nonce       = extractNonce(pageHtml);
    const clientToken = extractBraintreeToken(pageHtml);
    const btConfig    = extractBraintreeConfig(pageHtml);

    // Step 2: Add product to cart
    const { res: cartResp, body: cartBody } = await captureFetch(steps, "add_to_cart", CART_AJAX, {
      method: "POST",
      headers: {
        ...COMMON_HEADERS,
        "Content-Type":     "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "Accept":           "application/json, text/javascript, */*; q=0.01",
        "Referer":          CHECKOUT_PAGE,
        "Cookie":           cookies,
      },
      body: `product_sku=&product_id=${PRODUCT_ID}&quantity=1`,
    });
    cookies = mergeCookies(cookies, extractCookies(cartResp));

    // bwfan_cart_id may appear in the cart response JSON
    let bwfanCartId = "";
    try {
      const cartJson = JSON.parse(cartBody);
      const cartStr  = JSON.stringify(cartJson);
      const bm = cartStr.match(/bwfan_cart_id['":\s]+(\d+)/);
      if (bm) bwfanCartId = bm[1];
    } catch {}

    // Step 3: Re-fetch checkout page with cart in session — fresh nonce
    const { res: page2Resp, body: page2Html } = await captureFetch(steps, "checkout_page_refetch", CHECKOUT_PAGE, {
      headers: { ...COMMON_HEADERS, Cookie: cookies },
      redirect: "follow",
    });
    cookies = mergeCookies(cookies, extractCookies(page2Resp));
    const freshNonce       = extractNonce(page2Html)          || nonce;
    const freshClientToken = extractBraintreeToken(page2Html) || clientToken;
    const freshBtConfig    = extractBraintreeConfig(page2Html) || btConfig;

    // Store session
    const sessionId = makeSessionId();
    sessions.set(sessionId, {
      cookies,
      nonce:       freshNonce,
      bwfanCartId,
      createdAt:   Date.now(),
      used:        false,
    });

    const elapsed = Date.now() - t0;
    const harFile = savePayHar({
      event: "session_ok",
      sessionId,
      elapsed,
      nonceFound: !!freshNonce,
      tokenFound: !!freshClientToken,
      bwfanCartId,
    }, steps);
    payLog({
      event: "session_ok",
      sessionId: sessionId.slice(0, 8) + "…",
      elapsed,
      nonceFound: !!freshNonce,
      tokenFound: !!freshClientToken,
      harFile,
    });

    res.json({
      sessionId,
      clientToken:     freshClientToken,
      braintreeConfig: freshBtConfig,
      merchantId:      "zgmjz6bk4shsk2zd",
      nonceFound:      !!freshNonce,
      tokenFound:      !!freshClientToken,
    });
  } catch (err) {
    const elapsed = Date.now() - t0;
    req.log?.error?.({ err }, "pay/session error");
    const harFile = savePayHar({
      event: "session_fail",
      error: err.message,
      networkStep: err.networkStep || null,
      elapsed,
    }, steps);
    payLog({ event: "session_fail", error: err.message, networkStep: err.networkStep || null, elapsed, harFile });
    res.status(502).json({ error: "Failed to initialize payment session: " + err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/pay/checkout
// Submits the order to WooCommerce. Body shape and field set match the
// working reference exactly — do NOT add UTM/attribution/Stripe/PPCP fields.
// ────────────────────────────────────────────────────────────────────────────
router.post("/pay/checkout", async (req, res) => {
  const {
    sessionId,
    paymentNonce,
    billing_first_name = "",
    billing_last_name  = "",
    billing_email      = "",
    billing_phone      = "",
    billing_address_1  = "",
    billing_city       = "",
    billing_postcode   = "",
    billing_country    = "US",
    billing_state      = "",
  } = req.body;

  if (!sessionId || !paymentNonce) {
    return res.status(400).json({ error: "sessionId and paymentNonce are required" });
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return res.status(400).json({ error: "Session expired or invalid. Please refresh and try again." });
  }
  if (session.used) {
    return res.status(400).json({ error: "This payment session has already been used." });
  }
  if (Date.now() - session.createdAt > SESSION_TTL) {
    sessions.delete(sessionId);
    return res.status(400).json({ error: "Session expired. Please refresh and try again." });
  }

  const { cookies, nonce, bwfanCartId } = session;
  const t0 = Date.now();
  const steps = [];
  const logCtx = { sessionId: sessionId.slice(0, 8) + "…", billing_email };

  // Build the exact POST body WooCommerce expects (matches working reference).
  const params = new URLSearchParams({
    _wfacp_post_id:                   WFACP_POST_ID,
    wfacp_cart_hash:                  "",
    wfacp_has_active_multi_checkout:  "",
    wfacp_source:                     `${WC_BASE}/checkouts/check/`,
    product_switcher_need_refresh:    "1",
    wfacp_cart_contains_subscription: "0",
    wfacp_exchange_keys:              JSON.stringify({ pre_built: {}, elementor: { wfacp_form: "6bd44386", wfacp_form_summary: "122408a" } }),
    wfacp_input_hidden_data:          "{}",
    wfacp_input_phone_field:          JSON.stringify({ billing: { code: "1", number: billing_phone, hidden: "no" }, shipping: { code: "", number: "", hidden: "" } }),
    wfacp_timezone:                   "America/New_York",
    wc_order_attribution_source_type: "typein",
    wc_order_attribution_referrer:    "(none)",
    wc_order_attribution_utm_source:  "(direct)",
    wc_order_attribution_utm_medium:  "(none)",
    wfacp_billing_same_as_shipping:   "0",
    wfacp_billing_address_present:    "yes",
    wfob_input_hidden_data:           "{}",
    wfob_input_bump_shown_ids:        "1227685",
    wfob_input_bump_global_data:      "",
    billing_email,
    ...(bwfanCartId ? { bwfan_cart_id: bwfanCartId } : {}),
    account_username:                 "",
    account_password:                 "",
    billing_first_name,
    billing_last_name,
    shipping_first_name:              billing_first_name,
    shipping_last_name:               billing_last_name,
    shipping_address_1:               billing_address_1,
    shipping_city:                    billing_city,
    shipping_postcode:                billing_postcode,
    shipping_country:                 billing_country,
    shipping_state:                   billing_state,
    billing_address_1,
    billing_city,
    billing_postcode,
    billing_country,
    billing_state,
    billing_phone,
    billing_address_2:                "",
    shipping_address_2:               "",
    order_comments:                   "",
    wfacp_coupon_field:               "",
    payment_method:                   "braintree_cc",
    braintree_cc_nonce_key:           paymentNonce,
    braintree_cc_device_data:         "",
    braintree_cc_3ds_nonce_key:       "",
    braintree_cc_config_data:         "",
    bwfan_user_consent:               "1",
    "woocommerce-process-checkout-nonce": nonce || "",
    _wp_http_referer:                 `/?wc-ajax=update_order_review&wfacp_id=${WFACP_POST_ID}&wfacp_is_checkout_override=yes`,
    wfacp_subscription_gifting:       "",
    ship_to_different_address:        "on",
  });

  try {
    const { res: checkoutResp, body: rawBody } = await captureFetch(steps, "checkout_submit", CHECKOUT_AJAX, {
      method: "POST",
      headers: {
        ...COMMON_HEADERS,
        "Content-Type":     "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "Accept":           "application/json, text/javascript, */*; q=0.01",
        "Referer":          CHECKOUT_PAGE,
        "Origin":           WC_BASE,
        "Cookie":           cookies,
      },
      body: params.toString(),
    });

    const elapsed = Date.now() - t0;

    let data;
    try {
      data = JSON.parse(rawBody);
    } catch (parseErr) {
      const errMsg = "WooCommerce returned non-JSON response";
      const harFile = savePayHar({ event: "checkout_fail", sessionId, error: errMsg, httpStatus: checkoutResp.status, elapsed, ...logCtx }, steps);
      payLog({ event: "checkout_fail", ...logCtx, error: errMsg, httpStatus: checkoutResp.status, rawBody: rawBody.slice(0, 500), elapsed, harFile });
      return res.status(502).json({ error: errMsg + ". Check server logs for details." });
    }

    if (data.result === "success") {
      session.used = true;
      const orderIdMatch = (data.redirect || "").match(/order_id=(\d+)/);
      const orderId = orderIdMatch ? orderIdMatch[1] : null;

      const harFile = savePayHar({ event: "checkout_success", sessionId, orderId, elapsed, ...logCtx }, steps);
      payLog({ event: "checkout_success", ...logCtx, orderId, elapsed, harFile });

      return res.json({
        success:  true,
        orderId,
        redirect: data.redirect,
        messages: data.messages,
      });
    }

    // Payment declined / WooCommerce error
    const errText = typeof data.messages === "string"
      ? data.messages.replace(/<[^>]+>/g, "").trim()
      : (data.message || JSON.stringify(data));

    const harFile = savePayHar({ event: "checkout_declined", sessionId, result: data.result, error: errText, rawData: data, elapsed, ...logCtx }, steps);
    payLog({ event: "checkout_declined", ...logCtx, result: data.result, error: errText, rawData: data, elapsed, harFile });

    return res.status(402).json({
      success:  false,
      error:    data.messages || data.message || "Payment declined.",
      raw:      data,
    });
  } catch (err) {
    const elapsed = Date.now() - t0;
    req.log?.error?.({ err }, "pay/checkout error");
    const harFile = savePayHar({ event: "checkout_fail", sessionId, error: err.message, networkStep: err.networkStep || null, elapsed, ...logCtx }, steps);
    payLog({ event: "checkout_fail", ...logCtx, error: err.message, networkStep: err.networkStep || null, elapsed, harFile });
    res.status(502).json({ error: "Checkout failed: " + err.message });
  }
});

module.exports = router;
