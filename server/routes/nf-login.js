const express = require("express");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
// Lazy-require playwright so a missing module degrades this admin route to a
// clean 503 instead of crashing the whole server at boot. The /nf-login
// route is admin-only diagnostic tooling — nothing else in the app uses it.
let _chromium = null;
function getChromium() {
  if (_chromium) return _chromium;
  try { _chromium = require("playwright").chromium; return _chromium; }
  catch (e) { const err = new Error("playwright not installed on this server"); err.code = "NO_PLAYWRIGHT"; throw err; }
}
const { requireAuth, requireAdmin } = require("../middlewares/auth");
const router = express.Router();

router.use(requireAuth);
router.use(requireAdmin);

const NETFLIX_LOGIN_URL = "https://www.netflix.com/in/login";
const LOGS_DIR = path.join(__dirname, "..", "nf-logs");

if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

function httpRequest(urlStr, options = {}, postData = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === "https:" ? https : http;
    const reqOpts = {
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search,
      method: options.method || "GET",
      headers: options.headers || {},
    };
    const req = mod.request(reqOpts, (res) => {
      let data = "";
      res.on("data", c => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data: null, raw: data }); }
      });
    });
    req.on("error", reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error("timeout")); });
    if (postData) req.write(postData);
    req.end();
  });
}

async function getGmailAccessToken() {
  const pd = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GMAIL_REFRESH_TOKEN,
    grant_type: "refresh_token",
  }).toString();
  const r = await httpRequest("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(pd) },
  }, pd);
  if (r.data?.error) throw new Error("Gmail: " + r.data.error_description);
  return r.data.access_token;
}

function getEmailBody(payload) {
  if (payload.body?.data) return Buffer.from(payload.body.data, "base64url").toString();
  if (payload.parts) {
    for (const p of payload.parts) { if (p.mimeType === "text/plain" && p.body?.data) return Buffer.from(p.body.data, "base64url").toString(); }
    for (const p of payload.parts) { const r = getEmailBody(p); if (r) return r; }
  }
  return null;
}

function extractCode(body) {
  const m = body.match(/\n(\d{4,8})\n/) || body.match(/^(\d{4,8})$/m) || body.match(/(?:code)[:\s]*(\d{4,8})/i);
  return m ? m[1] : null;
}

async function fetchNetflixCode(email, startTime, maxWaitMs = 120000) {
  const deadline = startTime + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const at = await getGmailAccessToken();
      const sinceTs = Math.floor(startTime / 1000) - 10;
      const q = encodeURIComponent(`from:info@account.netflix.com to:${email} (subject:"sign-in code" OR subject:"temporary access code") after:${sinceTs}`);
      const msgs = await httpRequest(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5&q=${q}`, {
        headers: { Authorization: `Bearer ${at}` },
      });
      if (msgs.data?.messages) {
        for (const msg of msgs.data.messages) {
          const detail = await httpRequest(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`, {
            headers: { Authorization: `Bearer ${at}` },
          });
          const hdrs = detail.data?.payload?.headers || [];
          const to = hdrs.find(h => h.name.toLowerCase() === "to")?.value || "";
          if (!to.toLowerCase().includes(email.toLowerCase())) continue;
          const body = getEmailBody(detail.data.payload);
          if (!body) continue;
          const code = extractCode(body);
          if (code) return code;
        }
      }
    } catch (err) { console.error("Gmail poll:", err.message); }
    await new Promise(r => setTimeout(r, 4000));
  }
  return null;
}

function ts() { return Date.now(); }
function micro() { const [s, ns] = process.hrtime(); return s * 1e6 + Math.floor(ns / 1e3); }

router.post("/login", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "email required" });

  const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const t0 = micro();
  const t0ms = ts();

  const capture = {
    sessionId,
    email,
    startTime: new Date().toISOString(),
    startMs: t0ms,
    steps: [],
    requests: [],
    responses: [],
    cookies: { initial: [], afterPageLoad: [], afterSubmit: [], afterOtp: [], final: [] },
    recaptcha: { jsLoaded: false, enterpriseReady: false, tokenLength: 0, tokenPrefix: "", executionTimeMs: 0, anchorUrls: [], reloadUrls: [] },
    graphql: [],
    console: [],
    pageState: { initialUrl: "", finalUrl: "", serverState: null, clcsSessionId: "", flwssn: "" },
    browserInfo: { userAgent: "", viewport: {}, chromiumPath: "" },
    timing: {},
  };

  const log = (step, msg, data = {}) => {
    const entry = { step, message: msg, ts: ts(), elapsed_us: micro() - t0, ...data };
    capture.steps.push(entry);
    console.log(`[NF:${sessionId}] ${step}: ${msg}`);
  };

  let browser = null;

  try {
    log("init", "Launching browser");
    const chromiumPath = require("child_process").execSync("which chromium 2>/dev/null || echo ''").toString().trim();
    capture.browserInfo.chromiumPath = chromiumPath;

    browser = await getChromium().launch({
      headless: true,
      executablePath: chromiumPath || undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
      ],
    });
    log("browser_launched", "Chromium started");

    const contextOptions = {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1920, height: 1080 },
      locale: "en-IN",
      ignoreHTTPSErrors: true,
    };
    capture.browserInfo.userAgent = contextOptions.userAgent;
    capture.browserInfo.viewport = contextOptions.viewport;

    const proxyUrl = req.body.useProxy !== false ? process.env.PROXY_URL : null;
    if (proxyUrl) {
      const pu = new URL(proxyUrl);
      contextOptions.proxy = {
        server: `${pu.protocol}//${pu.hostname}:${pu.port}`,
        username: decodeURIComponent(pu.username),
        password: decodeURIComponent(pu.password),
      };
      log("proxy", `Proxy: ${pu.hostname}:${pu.port}`);
    } else {
      log("proxy", "Direct (no proxy)");
    }

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    page.on("console", (msg) => {
      capture.console.push({
        type: msg.type(),
        text: msg.text(),
        ts: ts(),
        elapsed_us: micro() - t0,
      });
    });

    let reqCounter = 0;
    const reqMap = new Map();

    page.on("request", (request) => {
      const idx = reqCounter++;
      const url = request.url();
      reqMap.set(request, idx);

      const allHeaders = request.headers();
      const entry = {
        idx,
        ts: ts(),
        elapsed_us: micro() - t0,
        method: request.method(),
        url,
        resourceType: request.resourceType(),
        headers: allHeaders,
        postData: null,
        postDataParsed: null,
      };

      if (request.method() === "POST") {
        const pd = request.postData();
        if (pd) {
          entry.postData = pd;
          try { entry.postDataParsed = JSON.parse(pd); } catch {}
        }
      }

      if (url.includes("recaptcha")) {
        entry.isRecaptcha = true;
        if (url.includes("/anchor")) capture.recaptcha.anchorUrls.push(url);
        if (url.includes("/reload")) capture.recaptcha.reloadUrls.push(url);
      }
      if (url.includes("graphql")) entry.isGraphql = true;

      capture.requests.push(entry);
    });

    page.on("response", async (response) => {
      const request = response.request();
      const idx = reqMap.get(request);
      const url = response.url();

      const entry = {
        idx,
        ts: ts(),
        elapsed_us: micro() - t0,
        url,
        status: response.status(),
        statusText: response.statusText(),
        headers: response.headers(),
        body: null,
        bodyParsed: null,
        bodyLength: 0,
      };

      const shouldCaptureBody = url.includes("graphql") ||
        (url.includes("recaptcha") && (url.includes("/reload") || url.includes("/anchor"))) ||
        url.includes("netflix.com/in/login") ||
        url.includes("netflix.com/th-en/login");

      if (shouldCaptureBody) {
        try {
          const body = await response.text();
          entry.bodyLength = body.length;
          if (body.length < 500000) {
            entry.body = body;
            try { entry.bodyParsed = JSON.parse(body); } catch {}
          }
        } catch (e) {
          entry.bodyError = e.message;
        }
      }

      if (url.includes("graphql") && entry.bodyParsed) {
        const bp = entry.bodyParsed;
        const result = bp.data?.result || bp.data?.clcsScreenUpdate || bp.data?.clcsSendFeedback || bp.data?.clcsHook;
        const gqlEntry = {
          idx,
          ts: entry.ts,
          elapsed_us: entry.elapsed_us,
          status: entry.status,
          operationName: capture.requests.find(r => r.idx === idx)?.postDataParsed?.operationName,
          requestHeaders: capture.requests.find(r => r.idx === idx)?.headers,
          requestBody: capture.requests.find(r => r.idx === idx)?.postDataParsed,
          responseHeaders: entry.headers,
          serverState: null,
          serverStateParsed: null,
          screenName: null,
          screenNodes: [],
          actionUrl: null,
          errors: [],
        };

        if (result?.serverState) {
          gqlEntry.serverState = result.serverState;
          try { gqlEntry.serverStateParsed = JSON.parse(result.serverState); } catch {}
          gqlEntry.screenName = gqlEntry.serverStateParsed?.name;
        }
        if (result?.screen?.componentTree?.nodes) {
          gqlEntry.screenNodes = result.screen.componentTree.nodes.map(n => ({
            testId: n.testId,
            typename: n.__typename,
            componentType: n.componentType,
            key: n.key,
            name: n.name,
            text: n.webTextWithTags?.text?.value || null,
            label: n.label?.value || null,
            children: n.children?.map(c => c.key) || null,
          })).filter(n => n.testId || n.text || n.name);
        }
        if (result?.screen?.action?.url) gqlEntry.actionUrl = result.screen.action.url;
        if (bp.errors) gqlEntry.errors = bp.errors;

        capture.graphql.push(gqlEntry);
      }

      capture.responses.push(entry);
    });

    capture.timing.browserLaunch_us = micro() - t0;

    log("navigate", `Opening ${NETFLIX_LOGIN_URL}`);
    const navStart = micro();
    await page.goto(NETFLIX_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    capture.timing.pageLoad_us = micro() - navStart;
    capture.pageState.initialUrl = page.url();
    log("page_loaded", `URL: ${page.url()} (${capture.timing.pageLoad_us}µs)`);

    const pageCookies = await context.cookies();
    capture.cookies.afterPageLoad = pageCookies.map(c => ({
      name: c.name, value: c.value, domain: c.domain, path: c.path,
      httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite, expires: c.expires,
    }));
    capture.pageState.flwssn = pageCookies.find(c => c.name === "flwssn")?.value || "";
    log("cookies", `${pageCookies.length} cookies: ${pageCookies.map(c => c.name).join(", ")}`);

    const reactContext = await page.evaluate(() => {
      try {
        if (window.netflix?.reactContext) {
          const ctx = window.netflix.reactContext;
          return {
            serverDefs: ctx.models?.serverDefs?.data,
            graphqlClcs: ctx.models?.graphqlClcs?.data,
            fastProps: (() => {
              const fp = ctx.models?.fastProps?.data || {};
              const relevant = {};
              for (const [k, v] of Object.entries(fp)) {
                if (k.toLowerCase().includes("recaptcha") || k.toLowerCase().includes("clcs") || k.toLowerCase().includes("captcha"))
                  relevant[k] = v;
              }
              return relevant;
            })(),
            flow: ctx.models?.flow?.data,
            geo: ctx.models?.geo?.data,
          };
        }
      } catch {}
      return null;
    });

    if (reactContext) {
      capture.pageState.reactContext = reactContext;
      if (reactContext.graphqlClcs) {
        const clcsKey = Object.keys(reactContext.graphqlClcs)[0];
        const clcsVal = reactContext.graphqlClcs[clcsKey];
        if (clcsVal?.clcsHook) {
          capture.pageState.serverState = clcsVal.clcsHook.serverState ? JSON.parse(clcsVal.clcsHook.serverState) : null;
          capture.pageState.clcsSessionId = capture.pageState.serverState?.clcsSessionId || "";

          if (clcsVal.clcsHook.onRender) {
            capture.recaptcha.onRenderConfig = clcsVal.clcsHook.onRender;
          }

          if (clcsVal.clcsHook.screen?.componentTree?.nodes) {
            capture.pageState.initialScreenNodes = clcsVal.clcsHook.screen.componentTree.nodes.map(n => ({
              testId: n.testId, typename: n.__typename, componentType: n.componentType,
              key: n.key, name: n.name,
            })).filter(n => n.testId || n.name);
          }
        }
      }
      log("react_context", `Build: ${reactContext.serverDefs?.BUILD_IDENTIFIER}, clcsSession: ${capture.pageState.clcsSessionId}`);
    }

    await page.waitForSelector('[data-testid="field-userLoginId"] input, input[name="userLoginId"]', { timeout: 15000 });
    log("form_ready", "Login form visible");

    const emailInput = await page.$('[data-testid="field-userLoginId"] input') || await page.$('input[name="userLoginId"]');
    if (!emailInput) throw new Error("Email input not found");

    await emailInput.click();
    await page.waitForTimeout(800);
    await emailInput.fill(email);
    await page.waitForTimeout(500);
    log("email_filled", `Typed: ${email}`);

    log("recaptcha_wait", "Waiting for reCAPTCHA Enterprise to initialize...");
    const recapWaitStart = micro();
    for (let i = 0; i < 20; i++) {
      const ready = await page.evaluate(() => {
        return {
          hasGrecaptcha: !!window.grecaptcha,
          hasEnterprise: !!(window.grecaptcha?.enterprise),
          hasExecute: !!(window.grecaptcha?.enterprise?.execute),
          hasRender: !!(window.grecaptcha?.enterprise?.render),
        };
      });
      capture.recaptcha.jsLoaded = ready.hasGrecaptcha;
      capture.recaptcha.enterpriseReady = ready.hasEnterprise;
      if (ready.hasExecute) {
        log("recaptcha_ready", `reCAPTCHA Enterprise loaded (${((micro() - recapWaitStart) / 1000).toFixed(1)}ms)`, ready);
        break;
      }
      if (i === 19) log("recaptcha_timeout", "reCAPTCHA did not fully load in 10s", ready);
      await page.waitForTimeout(500);
    }

    const continueBtn = await page.$('[data-testid="continue-button"] button') ||
                        await page.$('button[data-testid="continue-button"]') ||
                        await page.$('button:has-text("Continue")') ||
                        await page.$('button:has-text("Sign In")') ||
                        await page.$('button[type="submit"]');
    if (!continueBtn) throw new Error("Submit button not found");

    log("pre_submit", "About to click Continue");
    const submitStart = micro();
    const codeWaitStart = ts();

    const gqlResponsePromise = page.waitForResponse(
      (response) => response.url().includes("/graphql") && response.request().method() === "POST",
      { timeout: 45000 }
    ).catch(() => null);

    await continueBtn.click();
    log("clicked", "Continue clicked, waiting for GraphQL...");

    const gqlResponse = await gqlResponsePromise;
    capture.timing.submitToResponse_us = micro() - submitStart;

    if (gqlResponse) {
      log("gql_response", `GraphQL: ${gqlResponse.status()} (${(capture.timing.submitToResponse_us / 1000).toFixed(1)}ms)`);
    } else {
      log("gql_timeout", "No GraphQL response in 45s");
    }

    await page.waitForTimeout(2000);

    const postSubmitCookies = await context.cookies();
    capture.cookies.afterSubmit = postSubmitCookies.map(c => ({
      name: c.name, value: c.value, domain: c.domain, path: c.path,
      httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite, expires: c.expires,
    }));

    const recapState = await page.evaluate(() => {
      const state = { tokenCaptured: false, tokenLength: 0, tokenPrefix: "" };
      const inputs = document.querySelectorAll("textarea[name*='recaptcha'], input[name*='recaptcha']");
      inputs.forEach(inp => {
        if (inp.value && inp.value.length > 100) {
          state.tokenCaptured = true;
          state.tokenLength = inp.value.length;
          state.tokenPrefix = inp.value.substring(0, 50);
        }
      });
      return state;
    });
    if (recapState.tokenCaptured) {
      capture.recaptcha.tokenLength = recapState.tokenLength;
      capture.recaptcha.tokenPrefix = recapState.tokenPrefix;
    }

    const gqlReq = capture.requests.find(r => r.isGraphql && r.postDataParsed?.operationName === "CLCSScreenUpdate");
    if (gqlReq?.postDataParsed?.variables?.inputFields) {
      const tokenField = gqlReq.postDataParsed.variables.inputFields.find(f => f.name === "recaptchaResponseToken");
      if (tokenField?.value?.stringValue) {
        capture.recaptcha.tokenLength = tokenField.value.stringValue.length;
        capture.recaptcha.tokenPrefix = tokenField.value.stringValue.substring(0, 60);
      }
      const timeField = gqlReq.postDataParsed.variables.inputFields.find(f => f.name === "recaptchaResponseTime");
      if (timeField?.value?.intValue != null) {
        capture.recaptcha.executionTimeMs = timeField.value.intValue;
      }
    }

    let currentUrl = page.url();
    capture.pageState.finalUrl = currentUrl;

    const alertEl = await page.$('[data-testid="alert-message-body"]');
    let alertText = null;
    if (alertEl) {
      alertText = await alertEl.textContent();
      log("alert", alertText);
    }

    log("gql_summary", `${capture.graphql.length} GraphQL calls total`);
    capture.graphql.forEach((g, i) => {
      log(`gql_detail_${i}`, `${g.operationName} → status=${g.status}, state=${g.screenName || "?"}`, {
        inputFields: g.requestBody?.variables?.inputFields?.map(f => ({
          name: f.name,
          value: f.name === "recaptchaResponseToken" ? `len=${(f.value?.stringValue || "").length}` : (f.value?.stringValue || f.value?.intValue),
        })),
      });
    });

    const lastGql = capture.graphql[capture.graphql.length - 1];
    const currentState = lastGql?.screenName;

    if (currentUrl.includes("/browse") || currentUrl.includes("/profiles")) {
      log("success", "Login completed → browse!");
      capture.cookies.final = (await context.cookies()).map(c => ({ name: c.name, value: c.value, domain: c.domain }));
      capture.timing.total_us = micro() - t0;
      await browser.close();
      saveCapture(capture);
      return res.json({ success: true, redirect: currentUrl, sessionId, capture: redactForResponse(capture) });
    }

    const otpInput = await page.$('[data-testid="field-challengeOtp"] input') ||
                     await page.$('input[name="challengeOtp"]') ||
                     await page.$('input[inputmode="numeric"]');

    const isOtpState = otpInput || ["MFA_COLLECT_OTP_EMAIL_INPUT", "MFA_VERIFY", "MFA_COLLECT_OTP"].includes(currentState);

    if (isOtpState) {
      log("otp_state", "Netflix requesting sign-in code, polling Gmail...");

      const code = await fetchNetflixCode(email, codeWaitStart, 120000);
      if (!code) {
        log("otp_timeout", "No code in 2min");
        capture.timing.total_us = micro() - t0;
        await browser.close();
        saveCapture(capture);
        return res.json({ success: false, error: "OTP timeout", sessionId, capture: redactForResponse(capture) });
      }

      log("otp_received", `Code: ${code}`);

      const otpField = await page.$('[data-testid="field-challengeOtp"] input') ||
                       await page.$('input[name="challengeOtp"]') ||
                       await page.$('input[inputmode="numeric"]');

      if (otpField) {
        await otpField.click();
        await otpField.fill(code);
        await page.waitForTimeout(500);

        const otpGqlPromise = page.waitForResponse(
          (r) => r.url().includes("/graphql") && r.request().method() === "POST",
          { timeout: 30000 }
        ).catch(() => null);

        const otpSubmit = await page.$('[data-testid="continue-button"] button') ||
                          await page.$('button[data-testid="continue-button"]') ||
                          await page.$('button:has-text("Continue")') ||
                          await page.$('button[type="submit"]');

        if (otpSubmit) {
          log("otp_submit", "Submitting code...");
          await otpSubmit.click();

          const otpGqlRes = await otpGqlPromise;
          if (otpGqlRes) log("otp_gql", `OTP GraphQL: ${otpGqlRes.status()}`);

          await page.waitForTimeout(3000);
          capture.cookies.afterOtp = (await context.cookies()).map(c => ({ name: c.name, value: c.value, domain: c.domain }));

          currentUrl = page.url();
          log("otp_result", `URL: ${currentUrl}`);

          if (currentUrl.includes("/browse") || currentUrl.includes("/profiles")) {
            log("success", "Login successful!");
            capture.cookies.final = capture.cookies.afterOtp;
            capture.timing.total_us = micro() - t0;
            await browser.close();
            saveCapture(capture);
            return res.json({ success: true, code, redirect: currentUrl, sessionId, capture: redactForResponse(capture) });
          }
        }
      }
    }

    log("final", `State: ${currentState || "unknown"}, URL: ${currentUrl}`);
    capture.timing.total_us = micro() - t0;
    capture.cookies.final = (await context.cookies()).map(c => ({ name: c.name, value: c.value, domain: c.domain }));
    await browser.close();
    saveCapture(capture);

    return res.json({
      success: false,
      error: alertText || `Flow ended at: ${currentState || "unknown"}`,
      state: currentState,
      sessionId,
      capture: redactForResponse(capture),
    });
  } catch (err) {
    log("error", err.message);
    console.error("NF Login error:", err);
    capture.timing.total_us = micro() - t0;
    if (browser) try { await browser.close(); } catch {}
    saveCapture(capture);
    const httpStatus = err.code === "NO_PLAYWRIGHT" ? 503 : 500;
    return res.status(httpStatus).json({ success: false, error: err.message, sessionId, capture: redactForResponse(capture) });
  }
});

function saveCapture(capture) {
  try {
    const filename = `${capture.sessionId}_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    const filepath = path.join(LOGS_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify(capture, null, 2));
    console.log(`[NF] Capture saved: ${filepath}`);

    const files = fs.readdirSync(LOGS_DIR).filter(f => f.endsWith(".json")).sort();
    while (files.length > 20) {
      fs.unlinkSync(path.join(LOGS_DIR, files.shift()));
    }
  } catch (e) {
    console.error("Save capture error:", e.message);
  }
}

function redactForResponse(capture) {
  const c = JSON.parse(JSON.stringify(capture));
  const mask = (v) => v ? v.substring(0, 8) + "***" : "";
  for (const phase of ["afterPageLoad", "afterSubmit", "afterOtp", "final"]) {
    if (c.cookies[phase]) {
      c.cookies[phase] = c.cookies[phase].map(ck => ({ name: ck.name, domain: ck.domain, value: mask(ck.value) }));
    }
  }
  if (c.requests) {
    c.requests = c.requests.map(r => {
      const entry = { ...r };
      if (entry.headers?.cookie) entry.headers.cookie = mask(entry.headers.cookie);
      return entry;
    });
  }
  if (c.responses) {
    c.responses = c.responses.map(r => {
      const entry = { ...r };
      if (entry.headers?.["set-cookie"]) entry.headers["set-cookie"] = mask(entry.headers["set-cookie"]);
      return entry;
    });
  }
  return c;
}

router.get("/status", (req, res) => {
  res.json({
    service: "nf-login-playwright",
    status: "online",
    gmail: !!process.env.GMAIL_REFRESH_TOKEN,
    proxy: !!process.env.PROXY_URL,
    logsDir: LOGS_DIR,
  });
});

router.get("/logs", (req, res) => {
  try {
    const files = fs.readdirSync(LOGS_DIR).filter(f => f.endsWith(".json")).sort().reverse();
    const summaries = files.map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(LOGS_DIR, f), "utf8"));
        return {
          file: f,
          sessionId: data.sessionId,
          email: data.email,
          startTime: data.startTime,
          totalMs: data.timing?.total_us ? (data.timing.total_us / 1000).toFixed(1) : null,
          requests: data.requests?.length || 0,
          graphql: data.graphql?.length || 0,
          recaptchaReady: data.recaptcha?.enterpriseReady,
          recaptchaTokenLen: data.recaptcha?.tokenLength || 0,
          lastState: data.graphql?.[data.graphql.length - 1]?.screenName || null,
          error: data.steps?.find(s => s.step === "alert")?.message || null,
        };
      } catch { return { file: f, error: "parse error" }; }
    });
    res.json({ count: files.length, logs: summaries });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/logs/:sessionId", (req, res) => {
  try {
    const files = fs.readdirSync(LOGS_DIR).filter(f => f.startsWith(req.params.sessionId));
    if (files.length === 0) return res.status(404).json({ error: "Not found" });
    const data = JSON.parse(fs.readFileSync(path.join(LOGS_DIR, files[0]), "utf8"));
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
