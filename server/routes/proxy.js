const { Router } = require("express");
const { User, Setting, Log, ProxyCredential } = require("../models");
const { requireAuth } = require("../middlewares/auth");

const { logger } = require("../lib/logger");

const router = Router();

function parseEmailListRaw(text, defaultCountry, defaultProxy) {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const idx1 = line.indexOf(':');
      if (idx1 === -1) {
        return { email: line, country: (defaultCountry || 'US').toUpperCase(), proxyUrl: defaultProxy || undefined };
      }
      const email = line.slice(0, idx1).trim();
      if (!email) return null;
      const remainder = line.slice(idx1 + 1);
      if (remainder.startsWith('http://') || remainder.startsWith('https://')) {
        return { email, country: (defaultCountry || 'US').toUpperCase(), proxyUrl: remainder || defaultProxy || undefined };
      }
      const idx2 = remainder.indexOf(':');
      if (idx2 === -1) {
        const country = remainder.trim();
        return { email, country: (country || defaultCountry || 'US').toUpperCase(), proxyUrl: defaultProxy || undefined };
      }
      const country = remainder.slice(0, idx2).trim();
      const proxyUrl = remainder.slice(idx2 + 1).trim();
      return { email, country: (country || defaultCountry || 'US').toUpperCase(), proxyUrl: proxyUrl || defaultProxy || undefined };
    })
    .filter(Boolean);
}

function parseCPListRaw(text, defaultPassword, defaultCountry, defaultProxy) {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const parts = line.split('|');
      const resetUrl = parts[0].trim();
      if (!resetUrl) return null;
      const newPassword = parts[1]?.trim() || defaultPassword || '';
      const country = parts[2]?.trim() || defaultCountry || undefined;
      const proxyUrl = parts[3]?.trim() || defaultProxy || undefined;
      return newPassword ? { resetUrl, newPassword, country, proxyUrl } : null;
    })
    .filter(Boolean);
}

router.use(requireAuth);

async function fetchDroplet(url, options) {
  const resp = await fetch(url, options);
  return resp;
}

async function getSetting(key) {
  const row = await Setting.findOne({ key }).lean();
  return row ? parseFloat(row.value) : 0;
}

async function getSettingStr(key, fallback) {
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
    const user = await User.findById(userId).lean();
    return { ok: false, newCredits: user ? user.credits : 0 };
  }
  return { ok: true, newCredits: result.credits };
}

// Refund (creditCost - 0.1) back when an operation is not successful.
// This means the user only pays 0.1 for non-success outcomes.
async function applyFailureRefund(userId, creditCost) {
  const failureCost = 0.1;
  if (creditCost <= failureCost) {
    // creditCost is already <= 0.1, no refund needed
    return null;
  }
  // Round to 4 decimal places to avoid floating point drift (e.g. 0.2 - 0.1 = 0.09999...)
  const refundAmount = Math.round((creditCost - failureCost) * 10000) / 10000;
  const updated = await User.findByIdAndUpdate(
    userId,
    { $inc: { credits: refundAmount } },
    { new: true }
  );
  return updated ? updated.credits : null;
}

async function logOperation(userId, type, email, status, result, creditsUsed, balanceAfter = null) {
  await Log.create({ userId, type, email, status, result, creditsUsed, balanceAfter });
}

// Sanitize TR result — only expose what the frontend needs, nothing internal
function sanitizeTR(result, isSuccess) {
  const out = { success: isSuccess };
  if (typeof result.steps === 'number') out.steps = result.steps;
  if (!isSuccess) out.error = "Request could not be completed";
  return out;
}

// Sanitize CP result — keep account info (plan, status, dates) but hide internals
function sanitizeCP(result, isSuccess) {
  const account = result.account || null;
  const out = {
    success: isSuccess,
    account: account ? {
      email:           account.email           || null,
      plan:            account.plan            || null,
      status:          account.status          || null,
      memberSince:     account.memberSince     || null,
      nextBillingDate: account.nextBillingDate || null,
    } : null,
  };
  if (!isSuccess) out.error = "Password change could not be completed";
  return out;
}

// Sanitize VM result — only expose status, hide raw error details
function sanitizeVM(status, isChargeableResult) {
  const out = { status };
  if (!isChargeableResult) out.error = "Could not determine account status";
  return out;
}

async function buildProxyUrl(userId, country) {
  const cred = await ProxyCredential.findOne({ userId }).lean();
  // If no stored credential, return undefined — the droplet will use its own PROXY_URL env var
  // and handles the country swap (swapProxyCountry) internally.
  if (!cred) return undefined;

  const cc = (country || "US").toLowerCase();
  // Strip any existing _country-XX suffix from the stored password to avoid double-suffix,
  // then append the correct one so the droplet's swapProxyCountry can also swap it if needed.
  const basePassword = cred.password.replace(/_country-[a-z]+$/i, "");
  return `http://${cred.username}:${basePassword}_country-${cc}@${cred.host}:${cred.port}`;
}

function startStream(res) {
  res.setHeader("Content-Type", "text/x-ndjson");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders();
}

function streamLine(res, obj) {
  res.write(JSON.stringify(obj) + "\n");
  if (typeof res.flush === "function") res.flush();
}

router.post("/proxy/trigger-reset", async (req, res) => {
  const userId = req.user.id;
  const { email, country } = req.body;

  if (!email || !country) {
    res.status(400).json({ error: "email and country required" });
    return;
  }

  const creditCost = await getSetting("credit_cost_trigger_reset");
  // Reserve full credits upfront (also acts as the balance check)
  const deducted = await deductCredits(userId, creditCost);
  if (!deducted.ok) {
    res.status(402).json({ error: "Insufficient credits", credits: deducted.newCredits });
    return;
  }

  const proxyUrl = await buildProxyUrl(userId, country);

  try {
    const triggerResetUrl = await getSettingStr("droplet_trigger_reset", "http://142.93.4.225:3000");
    const resp = await fetchDroplet(`${triggerResetUrl}/trigger-reset`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Service-Key": process.env.TRIGGER_RESET_API_KEY || "",
        "Origin": `https://${process.env.DASHBOARD_DOMAIN || ""}`,
      },
      body: JSON.stringify({ email, country, proxyUrl }),
    });

    const result = await resp.json();
    const isSuccess = result.success === true;
    const status = isSuccess ? "success" : "failed";

    let actualCost = creditCost;
    let finalCredits = deducted.newCredits;

    if (!isSuccess) {
      // Not a success — refund down to 0.1
      const refundedCredits = await applyFailureRefund(userId, creditCost);
      actualCost = Math.min(0.1, creditCost);
      if (refundedCredits !== null) finalCredits = refundedCredits;
    }

    await logOperation(userId, "trigger-reset", email, status, result, actualCost, finalCredits);
    res.status(200).json({ status, ...sanitizeTR(result, isSuccess), creditsUsed: actualCost, newCredits: finalCredits });
  } catch (err) {
    const reason = err?.cause?.code || err?.code || err?.message || "Connection failed";
    logger.error({ email, reason, service: "trigger-reset" }, "Trigger reset service error");
    // Network/connection error — refund down to 0.1
    const refundedCredits = await applyFailureRefund(userId, creditCost);
    const actualCost = Math.min(0.1, creditCost);
    const finalCredits = refundedCredits !== null ? refundedCredits : deducted.newCredits;
    await logOperation(userId, "trigger-reset", email, "failed", { error: reason }, actualCost, finalCredits);
    res.status(500).json({ success: false, error: "Service temporarily unavailable", creditsUsed: actualCost, newCredits: finalCredits });
  }
});

router.post("/proxy/change-password", async (req, res) => {
  const userId = req.user.id;
  const { resetUrl, newPassword, country, proxyUrl: itemProxyUrl } = req.body;

  if (!resetUrl || !newPassword) {
    res.status(400).json({ error: "resetUrl and newPassword required" });
    return;
  }

  const creditCost = await getSetting("credit_cost_change_password");
  // Reserve full credits upfront (also acts as the balance check)
  const deducted = await deductCredits(userId, creditCost);
  if (!deducted.ok) {
    res.status(402).json({ error: "Insufficient credits", credits: deducted.newCredits });
    return;
  }

  // Use per-item proxyUrl if provided by the client, otherwise fall back to user's stored proxy
  const proxyUrl = itemProxyUrl || await buildProxyUrl(userId, country);

  try {
    const changePasswordUrl = await getSettingStr("droplet_change_password", "http://159.89.172.195:3000");
    const resp = await fetchDroplet(`${changePasswordUrl}/change-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Service-Key": process.env.CHANGE_PASSWORD_API_KEY || "",
        "Origin": `https://${process.env.DASHBOARD_DOMAIN || ""}`,
      },
      body: JSON.stringify({ resetUrl, newPassword, country, proxyUrl }),
    });

    const result = await resp.json();
    const account = result.account || null;
    const accountEmail = account?.email || null;
    // success: true covers all success states — including hold, and any other
    // affirmative outcomes returned by the CP droplet
    const isSuccess = result.success === true;
    const status = isSuccess ? "success" : "failed";

    let actualCost = creditCost;
    let finalCredits = deducted.newCredits;

    if (!isSuccess) {
      // Not a success — refund down to 0.1
      const refundedCredits = await applyFailureRefund(userId, creditCost);
      actualCost = Math.min(0.1, creditCost);
      if (refundedCredits !== null) finalCredits = refundedCredits;
    }

    await logOperation(userId, "change-password", accountEmail, status, result, actualCost, finalCredits);
    res.status(200).json({ status, ...sanitizeCP(result, isSuccess), creditsUsed: actualCost, newCredits: finalCredits });
  } catch (err) {
    const reason = err?.cause?.code || err?.code || err?.message || "Connection failed";
    logger.error({ resetUrl, reason, service: "change-password" }, "Change password service error");
    // Network/connection error — refund down to 0.1
    const refundedCredits = await applyFailureRefund(userId, creditCost);
    const actualCost = Math.min(0.1, creditCost);
    const finalCredits = refundedCredits !== null ? refundedCredits : deducted.newCredits;
    await logOperation(userId, "change-password", null, "failed", { error: reason }, actualCost, finalCredits);
    res.status(500).json({ success: false, error: "Service temporarily unavailable", creditsUsed: actualCost, newCredits: finalCredits });
  }
});

router.post("/proxy/change-password-bulk", async (req, res) => {
  const userId = req.user.id;
  const { rawList, defaultPassword, defaultCountry, defaultProxy } = req.body;

  if (!rawList || typeof rawList !== 'string' || !rawList.trim()) {
    res.status(400).json({ error: "rawList string required" });
    return;
  }

  const items = parseCPListRaw(rawList, defaultPassword, defaultCountry, defaultProxy);
  if (!items.length) {
    res.status(400).json({ error: "No valid items found in rawList (format: url|password|COUNTRY|proxyUrl)" });
    return;
  }

  const creditCost = await getSetting("credit_cost_change_password");
  const totalCost = creditCost * items.length;
  // Reserve full credits upfront for all items
  const deducted = await deductCredits(userId, totalCost);
  if (!deducted.ok) {
    res.status(402).json({ error: "Insufficient credits", credits: deducted.newCredits });
    return;
  }

  const cpRow = await Setting.findOne({ key: "concurrency_change_password" }).lean();
  const concurrency = Math.max(1, Math.min(100, parseInt(cpRow?.value) || 5));
  const changePasswordUrl = await getSettingStr("droplet_change_password", "http://159.89.172.195:3000");

  startStream(res);
  streamLine(res, { __total: items.length });
  let active = 0;

  const fireOne = async ({ resetUrl, newPassword, country, proxyUrl: itemProxyUrl }) => {
    active++;
    const proxyUrl = itemProxyUrl || await buildProxyUrl(userId, country);
    try {
      const resp = await fetchDroplet(`${changePasswordUrl}/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Service-Key": process.env.CHANGE_PASSWORD_API_KEY || "",
          "Origin": `https://${process.env.DASHBOARD_DOMAIN || ""}`,
        },
        body: JSON.stringify({ resetUrl, newPassword, country, proxyUrl }),
      });
      const result = await resp.json();
      const account = result.account || null;
      const accountEmail = account?.email || null;
      const isSuccess = result.success === true;
      const status = isSuccess ? "success" : "failed";

      let actualCost = creditCost;
      if (!isSuccess) {
        await applyFailureRefund(userId, creditCost);
        actualCost = Math.min(0.1, creditCost);
      }

      await logOperation(userId, "change-password", accountEmail, status, result, actualCost, null);
      active--;
      streamLine(res, { resetUrl, status, ...sanitizeCP(result, isSuccess), creditsUsed: actualCost, __active: active });
    } catch (err) {
      const reason = err?.cause?.code || err?.code || err?.message || "Connection failed";
      logger.error({ resetUrl, reason, service: "change-password" }, "Change password service error");
      // Network/connection error — refund down to 0.1
      await applyFailureRefund(userId, creditCost);
      const actualCost = Math.min(0.1, creditCost);
      await logOperation(userId, "change-password", null, "failed", { error: reason }, actualCost, null);
      active--;
      streamLine(res, { resetUrl, status: "failed", success: false, error: "Service temporarily unavailable", creditsUsed: actualCost, __active: active });
    }
  };

  try {
    const queue = [...items];
    const allPromises = [];

    // 2.5 per second = 5 every 2 seconds (matches TR rate)
    while (queue.length) {
      const batch = queue.splice(0, 5);
      batch.forEach(item => allPromises.push(fireOne(item)));
      if (queue.length) await new Promise(r => setTimeout(r, 2000));
    }

    await Promise.all(allPromises);
  } catch (fatal) {
    logger.error({ error: fatal.message, service: "change-password-bulk" }, "Fatal stream error");
    streamLine(res, { __error: true, error: fatal.message });
  } finally {
    // Fetch actual balance after all per-item refunds have been applied
    const finalUser = await User.findById(userId).lean();
    streamLine(res, { __done: true, newCredits: finalUser ? finalUser.credits : deducted.newCredits });
    res.end();
  }
});

router.post("/proxy/check-email", async (req, res) => {
  const userId = req.user.id;
  const { email } = req.body;

  if (!email) {
    res.status(400).json({ error: "email required" });
    return;
  }

  const creditCost = await getSetting("credit_cost_check_email");
  // Reserve full credits upfront (also acts as the balance check)
  const deducted = await deductCredits(userId, creditCost);
  if (!deducted.ok) {
    res.status(402).json({ error: "Insufficient credits", credits: deducted.newCredits });
    return;
  }

  try {
    const checkEmailUrl = await getSettingStr("droplet_check_email", "http://139.59.42.65:3000");
    const resp = await fetchDroplet(`${checkEmailUrl}/check-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Service-Key": process.env.CHECK_EMAIL_API_KEY || "",
        "Origin": `https://${process.env.DASHBOARD_DOMAIN || ""}`,
      },
      body: JSON.stringify({ email }),
    });

    const result = await resp.json();
    const status = result.status || (result.error ? "error" : "unknown");
    // unknown or error = inconclusive result, only charge 0.1
    const isChargeableResult = status !== "unknown" && status !== "error";

    let actualCost = creditCost;
    let finalCredits = deducted.newCredits;

    if (!isChargeableResult) {
      const refundedCredits = await applyFailureRefund(userId, creditCost);
      actualCost = Math.min(0.1, creditCost);
      if (refundedCredits !== null) finalCredits = refundedCredits;
    }

    await logOperation(userId, "check-email", email, status, result, actualCost, finalCredits);
    res.status(200).json({ email, ...sanitizeVM(status, isChargeableResult), creditsUsed: actualCost, newCredits: finalCredits });
  } catch (err) {
    const reason = err?.cause?.code || err?.code || err?.message || "Connection failed";
    logger.error({ email, reason, service: "check-email" }, "Check email service error");
    // Timeout / connection error — refund down to 0.1
    const refundedCredits = await applyFailureRefund(userId, creditCost);
    const actualCost = Math.min(0.1, creditCost);
    const finalCredits = refundedCredits !== null ? refundedCredits : deducted.newCredits;
    await logOperation(userId, "check-email", email, "error", { error: reason }, actualCost, finalCredits);
    res.status(500).json({ email, status: "error", error: "Could not determine account status", creditsUsed: actualCost, newCredits: finalCredits });
  }
});

router.post("/proxy/check-email-bulk", async (req, res) => {
  const userId = req.user.id;
  const { emails } = req.body;

  if (!emails || !Array.isArray(emails) || emails.length === 0) {
    res.status(400).json({ error: "emails array required" });
    return;
  }

  const creditCost = await getSetting("credit_cost_check_email");
  const totalCost = creditCost * emails.length;
  const deducted = await deductCredits(userId, totalCost);
  if (!deducted.ok) {
    res.status(402).json({ error: "Insufficient credits", credits: deducted.newCredits });
    return;
  }

  const vmRow = await Setting.findOne({ key: "concurrency_check_email" }).lean();
  const concurrency = Math.max(1, Math.min(100, parseInt(vmRow?.value) || 10));
  const checkEmailUrl = await getSettingStr("droplet_check_email", "http://139.59.42.65:3000");

  startStream(res);
  let active = 0;
  const queue = [...emails];

  try {
    async function processOne() {
      while (queue.length) {
        const email = queue.shift();
        active++;
        try {
          const resp = await fetchDroplet(`${checkEmailUrl}/check-email`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Service-Key": process.env.CHECK_EMAIL_API_KEY || "",
              "Origin": `https://${process.env.DASHBOARD_DOMAIN || ""}`,
            },
            body: JSON.stringify({ email }),
          });
          const result = await resp.json();
          const status = result.status || (result.error ? "error" : "unknown");
          // unknown or error = inconclusive result, only charge 0.1 per email
          const isChargeableResult = status !== "unknown" && status !== "error";
          let actualCost = creditCost;
          if (!isChargeableResult) {
            await applyFailureRefund(userId, creditCost);
            actualCost = Math.min(0.1, creditCost);
          }
          await logOperation(userId, "check-email", email, status, result, actualCost, null);
          active--;
          streamLine(res, { email, ...sanitizeVM(status, isChargeableResult), creditsUsed: actualCost, __active: active });
        } catch (err) {
          const reason = err?.cause?.code || err?.code || err?.message || "Connection failed";
          logger.error({ email, reason, service: "check-email" }, "Check email service error");
          // Timeout / connection error — refund down to 0.1
          await applyFailureRefund(userId, creditCost);
          const actualCost = Math.min(0.1, creditCost);
          await logOperation(userId, "check-email", email, "error", { error: reason }, actualCost, null);
          active--;
          streamLine(res, { email, status: "error", error: "Could not determine account status", creditsUsed: actualCost, __active: active });
        }
      }
    }

    const workers = [];
    for (let i = 0; i < Math.min(concurrency, emails.length); i++) {
      workers.push(processOne());
    }
    await Promise.all(workers);
  } catch (fatal) {
    logger.error({ error: fatal.message, service: "check-email-bulk" }, "Fatal stream error");
    streamLine(res, { __error: true, error: fatal.message });
  } finally {
    // Fetch actual balance after all per-item refunds have been applied
    const finalUser = await User.findById(userId).lean();
    streamLine(res, { __done: true, newCredits: finalUser ? finalUser.credits : deducted.newCredits });
    res.end();
  }
});

router.post("/proxy/trigger-reset-bulk", async (req, res) => {
  const userId = req.user.id;
  const { rawList, defaultCountry, defaultProxy } = req.body;

  if (!rawList || typeof rawList !== 'string' || !rawList.trim()) {
    res.status(400).json({ error: "rawList string required" });
    return;
  }

  const items = parseEmailListRaw(rawList, defaultCountry, defaultProxy);
  if (!items.length) {
    res.status(400).json({ error: "No valid emails found in rawList" });
    return;
  }

  const creditCost = await getSetting("credit_cost_trigger_reset");
  const totalCost = creditCost * items.length;
  // Reserve full credits upfront for all items
  const deducted = await deductCredits(userId, totalCost);
  if (!deducted.ok) {
    res.status(402).json({ error: "Insufficient credits", credits: deducted.newCredits });
    return;
  }

  const trRow = await Setting.findOne({ key: "concurrency_trigger_reset" }).lean();
  const concurrency = Math.max(1, Math.min(100, parseInt(trRow?.value) || 5));
  const triggerResetUrl = await getSettingStr("droplet_trigger_reset", "http://142.93.4.225:3000");

  startStream(res);
  streamLine(res, { __total: items.length });
  let active = 0;

  const fireOne = async ({ email, country, proxyUrl: itemProxyUrl }) => {
    active++;
    const proxyUrl = itemProxyUrl || await buildProxyUrl(userId, country);
    try {
      const resp = await fetchDroplet(`${triggerResetUrl}/trigger-reset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Service-Key": process.env.TRIGGER_RESET_API_KEY || "",
          "Origin": `https://${process.env.DASHBOARD_DOMAIN || ""}`,
        },
        body: JSON.stringify({ email, country, proxyUrl }),
      });
      const result = await resp.json();
      const isSuccess = result.success === true;
      const status = isSuccess ? "success" : "failed";

      let actualCost = creditCost;
      if (!isSuccess) {
        await applyFailureRefund(userId, creditCost);
        actualCost = Math.min(0.1, creditCost);
      }

      await logOperation(userId, "trigger-reset", email, status, result, actualCost, null);
      active--;
      streamLine(res, { email, country: country || "", status, ...sanitizeTR(result, isSuccess), creditsUsed: actualCost, __active: active });
    } catch (err) {
      const reason = err?.cause?.code || err?.code || err?.message || "Connection failed";
      logger.error({ email, reason, service: "trigger-reset" }, "Trigger reset service error");
      // Network/connection error — refund down to 0.1
      await applyFailureRefund(userId, creditCost);
      const actualCost = Math.min(0.1, creditCost);
      await logOperation(userId, "trigger-reset", email, "failed", { error: reason }, actualCost, null);
      active--;
      streamLine(res, { email, country: country || "", status: "failed", success: false, error: "Service temporarily unavailable", creditsUsed: actualCost, __active: active });
    }
  };

  try {
    const queue = [...items];
    const allPromises = [];

    // 2.5 per second = 5 every 2 seconds
    while (queue.length) {
      const batch = queue.splice(0, 5);
      batch.forEach(item => allPromises.push(fireOne(item)));
      if (queue.length) await new Promise(r => setTimeout(r, 2000));
    }

    await Promise.all(allPromises);
  } catch (fatal) {
    logger.error({ error: fatal.message, service: "trigger-reset-bulk" }, "Fatal stream error");
    streamLine(res, { __error: true, error: fatal.message });
  } finally {
    // Fetch actual balance after all per-item refunds have been applied
    const finalUser = await User.findById(userId).lean();
    streamLine(res, { __done: true, newCredits: finalUser ? finalUser.credits : deducted.newCredits });
    res.end();
  }
});


router.get("/proxy/concurrency", async (req, res) => {
  const trRow = await Setting.findOne({ key: "concurrency_trigger_reset" }).lean();
  const vmRow = await Setting.findOne({ key: "concurrency_check_email" }).lean();
  const cpRow = await Setting.findOne({ key: "concurrency_change_password" }).lean();
  res.json({
    trigger_reset: parseInt(trRow?.value) || 5,
    check_email: parseInt(vmRow?.value) || 10,
    change_password: parseInt(cpRow?.value) || 5,
  });
});

module.exports = router;
