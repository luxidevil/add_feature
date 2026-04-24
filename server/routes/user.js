const { Router } = require("express");
const { User, Log, Voucher, ImapCredential, ProxyCredential, Setting, TopupTransaction } = require("../models");
const { requireAuth } = require("../middlewares/auth");

const router = Router();

router.use(requireAuth);

router.get("/user/pricing", async (req, res) => {
  try {
    const keys = [
      "credit_cost_trigger_reset",
      "credit_cost_change_password",
      "credit_cost_check_email",
      "credit_cost_signup_code",
      "credits_per_dollar",
      "min_credit_load",
      "crypto_wallet",
    ];
    const settings = await Setting.find({ key: { $in: keys } }).lean();
    res.json(settings.map(s => ({ key: s.key, value: s.value })));
  } catch (err) {
    req.log.error({ err }, "Get pricing error");
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/user/logs", async (req, res) => {
  const userId = req.user.id;
  const { search, type, status, limit = "2000" } = req.query;
  const pageSize = Math.min(parseInt(limit) || 2000, 5000);
  try {
    const filter = { userId };
    if (search) filter.email = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    if (type) filter.type = type;
    if (status) filter.status = status;
    const logs = await Log.find(filter).sort({ createdAt: -1 }).limit(pageSize).lean();
    res.json(logs.map(l => ({
      id: l._id.toString(),
      userId: l.userId.toString(),
      type: l.type,
      email: l.email,
      status: l.status,
      result: l.result,
      creditsUsed: l.creditsUsed,
      balanceAfter: l.balanceAfter ?? null,
      createdAt: l.createdAt,
    })));
  } catch (err) {
    req.log.error({ err }, "Get logs error");
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/user/credits/history", async (req, res) => {
  const userId = req.user.id;
  try {
    const [logs, topups] = await Promise.all([
      Log.find({ userId }).sort({ createdAt: -1 }).limit(1000).lean(),
      TopupTransaction.find({ userId }).sort({ createdAt: -1 }).limit(500).lean(),
    ]);

    const deductions = logs.map(l => ({
      id: l._id.toString(),
      kind: "deduction",
      type: l.type,
      email: l.email || null,
      status: l.status,
      amount: -(l.creditsUsed || 0),
      balanceAfter: l.balanceAfter ?? null,
      createdAt: l.createdAt,
    }));

    const additions = topups.map(t => ({
      id: t._id.toString(),
      kind: "topup",
      type: "top-up",
      email: null,
      status: "success",
      amount: t.creditsAdded,
      balanceAfter: null,
      txHash: t.txHash,
      usdtAmount: t.usdtAmount,
      createdAt: t.createdAt,
    }));

    const combined = [...deductions, ...additions].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    res.json(combined);
  } catch (err) {
    req.log.error({ err }, "Get credit history error");
    res.status(500).json({ error: "Failed" });
  }
});

router.post("/user/credits/redeem", async (req, res) => {
  const { code } = req.body;
  const userId = req.user.id;
  if (!code) { res.status(400).json({ error: "Code required" }); return; }
  try {
    const voucher = await Voucher.findOne({ code: code.trim().toUpperCase() });
    if (!voucher) { res.status(404).json({ error: "Invalid voucher code" }); return; }
    if (voucher.used) { res.status(409).json({ error: "Voucher already used" }); return; }
    voucher.used = true;
    voucher.usedBy = userId;
    voucher.usedAt = new Date();
    await voucher.save();
    const user = await User.findById(userId);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    user.credits += voucher.credits;
    await user.save();
    res.json({ credits: voucher.credits, newBalance: user.credits });
  } catch (err) {
    req.log.error({ err }, "Redeem voucher error");
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/user/imap", async (req, res) => {
  const userId = req.user.id;
  try {
    const creds = await ImapCredential.find({ userId }, "provider email imapHost imapPort createdAt").lean();
    res.json(creds.map(c => ({ id: c._id.toString(), provider: c.provider, email: c.email, imapHost: c.imapHost, imapPort: c.imapPort, createdAt: c.createdAt })));
  } catch (err) {
    req.log.error({ err }, "Get imap error");
    res.status(500).json({ error: "Failed" });
  }
});

router.post("/user/imap", async (req, res) => {
  const userId = req.user.id;
  const { provider = "gmail", email, password, imapHost, imapPort } = req.body;
  if (!email || !password) { res.status(400).json({ error: "Email and password required" }); return; }
  try {
    const cred = await ImapCredential.create({ userId, provider, email, password, imapHost: imapHost || null, imapPort: imapPort || null });
    res.json({ id: cred._id.toString(), provider: cred.provider, email: cred.email });
  } catch (err) {
    req.log.error({ err }, "Add imap error");
    res.status(500).json({ error: "Failed" });
  }
});

router.delete("/user/imap/:id", async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  try {
    await ImapCredential.deleteOne({ _id: id, userId });
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete imap error");
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/user/proxy", async (req, res) => {
  const userId = req.user.id;
  try {
    const cred = await ProxyCredential.findOne({ userId }, "host port username createdAt").lean();
    if (!cred) { res.json(null); return; }
    res.json({ id: cred._id.toString(), host: cred.host, port: cred.port, username: cred.username, createdAt: cred.createdAt });
  } catch (err) {
    req.log.error({ err }, "Get proxy error");
    res.status(500).json({ error: "Failed" });
  }
});

router.post("/user/proxy", async (req, res) => {
  const userId = req.user.id;
  const { host, port, username, password } = req.body;
  if (!host || !port || !username || !password) {
    res.status(400).json({ error: "Host, port, username, and password are required" });
    return;
  }
  try {
    await ProxyCredential.findOneAndUpdate(
      { userId },
      { userId, host, port, username, password },
      { upsert: true, new: true }
    );
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Save proxy error");
    res.status(500).json({ error: "Failed" });
  }
});

router.delete("/user/proxy", async (req, res) => {
  const userId = req.user.id;
  try {
    await ProxyCredential.deleteOne({ userId });
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete proxy error");
    res.status(500).json({ error: "Failed" });
  }
});


const USDT_CONTRACT = "0x55d398326f99059ff775485246999027b3197955";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const BSC_RPCS = [
  "https://bsc-dataseed.binance.org/",
  "https://bsc-dataseed1.binance.org/",
  "https://bsc-dataseed2.binance.org/",
];

async function bscRpc(method, params) {
  let lastErr;
  for (const rpc of BSC_RPCS) {
    try {
      const resp = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        signal: AbortSignal.timeout(9000),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message || "RPC error");
      return data.result;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function validateUsdtTx(txHash, walletAddress) {
  const receipt = await bscRpc("eth_getTransactionReceipt", [txHash]);
  if (!receipt) throw new Error("Transaction not found or still pending. Wait for confirmation and try again.");
  if (receipt.status !== "0x1") throw new Error("Transaction failed on-chain");
  const log = (receipt.logs || []).find(l =>
    l.address.toLowerCase() === USDT_CONTRACT &&
    l.topics[0] === TRANSFER_TOPIC &&
    l.topics[2] &&
    ("0x" + l.topics[2].slice(26)).toLowerCase() === walletAddress.toLowerCase()
  );
  if (!log) throw new Error("No USDT transfer to your wallet found in this transaction");
  const usdtAmount = Number(BigInt(log.data)) / 1e18;
  const fromAddress = "0x" + log.topics[1].slice(26);
  return { usdtAmount, fromAddress };
}

async function autoDetectUsdtPayment(walletAddress, expectedAmount) {
  const latestHex = await bscRpc("eth_blockNumber", []);
  const latest = parseInt(latestHex, 16);
  const scanBlocks = 100; // ~5 minutes on BSC (3s per block)
  const batchSize = 10;

  for (let start = latest; start > latest - scanBlocks; start -= batchSize) {
    const nums = [];
    for (let b = start; b > Math.max(start - batchSize, latest - scanBlocks); b--) nums.push(b);

    const blocks = await Promise.all(
      nums.map(n => bscRpc("eth_getBlockByNumber", ["0x" + n.toString(16), true]).catch(() => null))
    );

    const candidateHashes = [];
    for (const block of blocks) {
      if (!block) continue;
      for (const tx of block.transactions || []) {
        if (tx.to && tx.to.toLowerCase() === USDT_CONTRACT) candidateHashes.push(tx.hash);
      }
    }
    if (!candidateHashes.length) continue;

    const receipts = await Promise.all(
      candidateHashes.map(h => bscRpc("eth_getTransactionReceipt", [h]).catch(() => null))
    );

    for (const receipt of receipts) {
      if (!receipt || receipt.status !== "0x1") continue;
      const log = (receipt.logs || []).find(l =>
        l.address.toLowerCase() === USDT_CONTRACT &&
        l.topics[0] === TRANSFER_TOPIC &&
        l.topics[2] &&
        ("0x" + l.topics[2].slice(26)).toLowerCase() === walletAddress.toLowerCase()
      );
      if (!log) continue;
      const txAmount = Number(BigInt(log.data)) / 1e18;
      if (Math.abs(txAmount - expectedAmount) < 0.01) {
        return { txHash: receipt.transactionHash, usdtAmount: txAmount, fromAddress: "0x" + log.topics[1].slice(26) };
      }
    }
  }
  return null;
}

router.post("/user/credits/topup/auto", async (req, res) => {
  const userId = req.user.id;
  const { usdtAmount } = req.body;
  if (!usdtAmount || isNaN(usdtAmount) || parseFloat(usdtAmount) <= 0) {
    return res.status(400).json({ error: "Invalid amount" });
  }
  try {
    const walletSetting = await Setting.findOne({ key: "crypto_wallet" }).lean();
    const wallet = walletSetting?.value?.toLowerCase();
    if (!wallet) return res.status(503).json({ error: "Wallet not configured. Contact admin." });
    const expected = parseFloat(usdtAmount);
    const found = await autoDetectUsdtPayment(wallet, expected);
    if (!found) {
      return res.status(404).json({ needsHash: true, error: "No matching payment found in the last 5 minutes. Please paste your TX hash manually." });
    }
    const existing = await TopupTransaction.findOne({ txHash: found.txHash });
    if (existing) {
      return res.status(409).json({ needsHash: true, error: "This transaction was already redeemed. Please paste your TX hash manually." });
    }
    const rateSetting = await Setting.findOne({ key: "credits_per_dollar" }).lean();
    const minSetting = await Setting.findOne({ key: "min_credit_load" }).lean();
    const rate = parseFloat(rateSetting?.value) || 100;
    const minCredits = parseFloat(minSetting?.value) || 500;
    const creditsAdded = Math.floor(found.usdtAmount * rate);
    if (creditsAdded < minCredits) {
      return res.status(400).json({ error: `Minimum top-up is ${minCredits} credits ($${(minCredits / rate).toFixed(2)} USDT). You sent $${found.usdtAmount.toFixed(2)} USDT.` });
    }
    await TopupTransaction.create({ txHash: found.txHash, userId, usdtAmount: found.usdtAmount, creditsAdded, fromAddress: found.fromAddress });
    const user = await User.findById(userId);
    user.credits += creditsAdded;
    await user.save();
    return res.json({ success: true, usdtAmount: found.usdtAmount, creditsAdded, newBalance: user.credits, txHash: found.txHash });
  } catch (err) {
    req.log.error({ err }, "Auto topup error");
    return res.status(500).json({ needsHash: true, error: "Verification failed. Please paste your TX hash manually." });
  }
});

router.post("/user/credits/topup", async (req, res) => {
  const userId = req.user.id;
  const { txHash } = req.body;
  if (!txHash || typeof txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(txHash.trim())) {
    return res.status(400).json({ error: "Invalid transaction hash format" });
  }
  const normalizedHash = txHash.trim().toLowerCase();
  try {
    const existing = await TopupTransaction.findOne({ txHash: normalizedHash });
    if (existing) return res.status(409).json({ error: "This transaction has already been used to top up an account" });
    const walletSetting = await Setting.findOne({ key: "crypto_wallet" }).lean();
    const wallet = walletSetting?.value;
    if (!wallet) return res.status(503).json({ error: "Wallet not configured. Contact admin." });
    const { usdtAmount, fromAddress } = await validateUsdtTx(normalizedHash, wallet);
    const rateSetting = await Setting.findOne({ key: "credits_per_dollar" }).lean();
    const minSetting = await Setting.findOne({ key: "min_credit_load" }).lean();
    const rate = parseFloat(rateSetting?.value) || 100;
    const minCredits = parseFloat(minSetting?.value) || 500;
    const creditsAdded = Math.floor(usdtAmount * rate);
    if (creditsAdded < minCredits) {
      return res.status(400).json({ error: `Minimum top-up is ${minCredits} credits ($${(minCredits / rate).toFixed(2)} USDT). You sent $${usdtAmount.toFixed(2)} USDT (${creditsAdded} credits).` });
    }
    await TopupTransaction.create({ txHash: normalizedHash, userId, usdtAmount, creditsAdded, fromAddress });
    const user = await User.findById(userId);
    user.credits += creditsAdded;
    await user.save();
    res.json({ success: true, usdtAmount, creditsAdded, newBalance: user.credits });
  } catch (err) {
    req.log.error({ err }, "Topup error");
    res.status(400).json({ error: err.message || "Validation failed" });
  }
});

router.get("/user/credits/topup/history", async (req, res) => {
  const userId = req.user.id;
  try {
    const history = await TopupTransaction.find({ userId }).sort({ createdAt: -1 }).limit(50).lean();
    res.json(history.map(t => ({
      txHash: t.txHash,
      usdtAmount: t.usdtAmount,
      creditsAdded: t.creditsAdded,
      fromAddress: t.fromAddress,
      createdAt: t.createdAt,
    })));
  } catch (err) {
    res.status(500).json({ error: "Failed" });
  }
});

const { fetchNetflixEmails, testConnection, fetchResetLinkForAccount, fetchResetLinksForAccounts, fetchSignInLinkForAccount, fetchSignInLinksForAccounts } = require("../lib/imapService");

router.post("/user/imap/test", async (req, res) => {
  const userId = req.user.id;
  const { id, email, password, provider, imapHost, imapPort } = req.body;
  try {
    let cred;
    if (id) {
      cred = await ImapCredential.findOne({ _id: id, userId }).lean();
      if (!cred) return res.status(404).json({ error: "Account not found" });
    } else {
      cred = { email, password, provider: provider || "gmail", imapHost: imapHost || null, imapPort: imapPort || 993 };
    }
    const result = await testConnection(cred);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "IMAP test error");
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/user/imap/:id/fetch", async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;
  const sinceHours = parseInt(req.query.hours) || 24;
  try {
    const cred = await ImapCredential.findOne({ _id: id, userId }).lean();
    if (!cred) return res.status(404).json({ error: "Account not found" });
    const result = await fetchNetflixEmails(cred, sinceHours);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "IMAP fetch error");
    res.status(500).json({ error: err.message });
  }
});

router.post("/user/imap/fetch-reset-link", async (req, res) => {
  const userId = req.user.id;
  const { accountEmail } = req.body;
  if (!accountEmail) return res.status(400).json({ error: "accountEmail required" });
  try {
    const cred = await ImapCredential.findOne({ userId }).lean();
    if (!cred) return res.status(404).json({ error: "No IMAP account connected. Go to IMAP Settings to add one." });
    const result = await fetchResetLinkForAccount(cred, accountEmail, 2);
    try {
      await Log.create({
        userId,
        type: 'imap-fetch',
        email: accountEmail,
        status: result.found ? 'success' : 'failed',
        result: { resetLink: result.found ? result.resetLink : null, imapUser: cred.email },
        creditsUsed: 0,
        balanceAfter: null,
      });
    } catch (logErr) {
      req.log.error({ err: logErr }, "IMAP fetch log save error");
    }
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "IMAP fetch-reset-link error");
    try {
      await Log.create({
        userId,
        type: 'imap-fetch',
        email: accountEmail,
        status: 'error',
        result: { error: err.message },
        creditsUsed: 0,
        balanceAfter: null,
      });
    } catch (_) {}
    res.status(500).json({ error: err.message });
  }
});

router.post("/user/imap/fetch-bulk-reset-links", async (req, res) => {
  const userId = req.user.id;
  const { accounts, sinceHours } = req.body;
  if (!accounts || !Array.isArray(accounts) || !accounts.length) {
    return res.status(400).json({ error: "accounts array required (format: ['email:COUNTRY', ...])" });
  }
  const parsed = accounts.map(function(a) {
    const idx = a.indexOf(":");
    if (idx === -1) return { email: a, country: '' };
    return { email: a.slice(0, idx), country: a.slice(idx + 1).toUpperCase() };
  });
  const emails = parsed.map(function(p) { return p.email; });
  const countryMap = {};
  parsed.forEach(function(p) { countryMap[p.email] = p.country; });
  try {
    const cred = await ImapCredential.findOne({ userId }).lean();
    if (!cred) return res.status(404).json({ error: "No IMAP account connected. Go to IMAP Settings to add one." });
    const result = await fetchResetLinksForAccounts(cred, emails, sinceHours || 2);
    const outputMap = {};
    Object.keys(result.results).forEach(function(email) {
      const cc = countryMap[email] || '';
      outputMap[email] = cc ? result.results[email] + "||" + cc : result.results[email];
    });
    try {
      const logEntries = emails.map(function(email) {
        const cpLine = outputMap[email] || null;
        return {
          userId,
          type: 'imap-fetch',
          email,
          status: cpLine ? 'success' : 'failed',
          result: { resetLink: cpLine ? cpLine.split('||')[0] : null, imapUser: cred.email },
          creditsUsed: 0,
          balanceAfter: null,
        };
      });
      await Log.insertMany(logEntries);
    } catch (logErr) {
      req.log.error({ err: logErr }, "IMAP bulk fetch log save error");
    }
    res.json({
      found: Object.keys(outputMap).length > 0,
      matched: Object.keys(outputMap).length,
      total: accounts.length,
      results: outputMap,
      missing: result.missing,
    });
  } catch (err) {
    req.log.error({ err }, "IMAP bulk fetch error");
    res.status(500).json({ error: err.message });
  }
});

// Per-row: fetch the Netflix "new device / sign-in" notification link for ONE account.
// Mirrors fetch-reset-link exactly so the SignupCode page can reuse the same UX.
router.post("/user/imap/fetch-signin-link", async (req, res) => {
  const userId = req.user.id;
  const { accountEmail, sinceHours } = req.body;
  if (!accountEmail) return res.status(400).json({ error: "accountEmail required" });
  try {
    const cred = await ImapCredential.findOne({ userId }).lean();
    if (!cred) return res.status(404).json({ error: "No IMAP account connected. Go to IMAP Settings to add one." });
    const result = await fetchSignInLinkForAccount(cred, accountEmail, sinceHours || 24);
    try {
      await Log.create({
        userId,
        type: 'imap-fetch',
        email: accountEmail,
        status: result.found ? 'success' : 'failed',
        result: { source: 'signin', resetLink: result.found ? result.resetLink : null, imapUser: cred.email },
        creditsUsed: 0,
        balanceAfter: null,
      });
    } catch (logErr) {
      req.log.error({ err: logErr }, "IMAP fetch-signin-link log save error");
    }
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "IMAP fetch-signin-link error");
    try {
      await Log.create({
        userId,
        type: 'imap-fetch',
        email: accountEmail,
        status: 'error',
        result: { source: 'signin', error: err.message },
        creditsUsed: 0,
        balanceAfter: null,
      });
    } catch (_) {}
    res.status(500).json({ error: err.message });
  }
});

// Bulk: same payload shape as fetch-bulk-reset-links.
// Input: { accounts: ["email" | "email:CC", ...], sinceHours? }
// Output: { found, matched, total, results: { email: "link||CC" }, missing }
router.post("/user/imap/fetch-bulk-signin-links", async (req, res) => {
  const userId = req.user.id;
  const { accounts, sinceHours } = req.body;
  if (!accounts || !Array.isArray(accounts) || !accounts.length) {
    return res.status(400).json({ error: "accounts array required (format: ['email' or 'email:COUNTRY', ...])" });
  }
  const parsed = accounts.map(function(a) {
    const idx = a.indexOf(":");
    if (idx === -1) return { email: a, country: '' };
    return { email: a.slice(0, idx), country: a.slice(idx + 1).toUpperCase() };
  });
  const emails = parsed.map(function(p) { return p.email; });
  const countryMap = {};
  parsed.forEach(function(p) { countryMap[p.email] = p.country; });
  try {
    const cred = await ImapCredential.findOne({ userId }).lean();
    if (!cred) return res.status(404).json({ error: "No IMAP account connected. Go to IMAP Settings to add one." });
    const result = await fetchSignInLinksForAccounts(cred, emails, sinceHours || 24);
    const outputMap = {};
    const effectiveCountries = {};
    const autoCountries = result.countries || {};
    Object.keys(result.results).forEach(function(email) {
      // Manual country (per-row :CC or default) takes priority over the country
      // we auto-extracted from Netflix's SRC: footer in the email body. This
      // lets the user override if they need a different region for CP.
      const cc = countryMap[email] || autoCountries[email] || '';
      effectiveCountries[email] = cc;
      outputMap[email] = cc ? result.results[email] + "||" + cc : result.results[email];
    });
    try {
      const logEntries = emails.map(function(email) {
        const cpLine = outputMap[email] || null;
        return {
          userId,
          type: 'imap-fetch',
          email,
          status: cpLine ? 'success' : 'failed',
          result: { source: 'signin', resetLink: cpLine ? cpLine.split('||')[0] : null, imapUser: cred.email },
          creditsUsed: 0,
          balanceAfter: null,
        };
      });
      await Log.insertMany(logEntries);
    } catch (logErr) {
      req.log.error({ err: logErr }, "IMAP bulk signin fetch log save error");
    }
    res.json({
      found: Object.keys(outputMap).length > 0,
      matched: Object.keys(outputMap).length,
      total: accounts.length,
      results: outputMap,
      countries: effectiveCountries,
      missing: result.missing,
    });
  } catch (err) {
    req.log.error({ err }, "IMAP bulk signin fetch error");
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
