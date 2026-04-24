const { Router } = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { exec } = require("child_process");
const { User, Setting, Voucher, Log, ProxyCredential, TopupTransaction } = require("../models");
const { requireAuth, requireAdmin } = require("../middlewares/auth");

const router = Router();

router.use("/admin", requireAuth, requireAdmin);

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

router.get("/admin/users", async (req, res) => {
  try {
    const users = await User.find({}, "username role credits apiKey promoCode createdAt").sort({ createdAt: -1 }).lean();
    res.json(users.map(u => ({ id: u._id.toString(), username: u.username, role: u.role, credits: u.credits, apiKey: u.apiKey, promoCode: u.promoCode || null, createdAt: u.createdAt })));
  } catch (err) {
    req.log.error({ err }, "List users error");
    res.status(500).json({ error: "Failed" });
  }
});

router.post("/admin/users", async (req, res) => {
  const { username, password, credits = 0 } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Username and password required" });
    return;
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const apiKey = "dxb_" + crypto.randomBytes(16).toString("hex");
    const user = await User.create({ username, password: hash, role: "user", credits, apiKey });
    res.json({ id: user._id.toString(), username: user.username, role: user.role, credits: user.credits, apiKey: user.apiKey });
  } catch (err) {
    if (err.code === 11000) {
      res.status(409).json({ error: "Username already exists" });
      return;
    }
    req.log.error({ err }, "Create user error");
    res.status(500).json({ error: "Failed" });
  }
});

router.put("/admin/users/:id/credits", async (req, res) => {
  const { id } = req.params;
  const { credits, operation = "set" } = req.body;
  if (credits === undefined) {
    res.status(400).json({ error: "Invalid" });
    return;
  }
  try {
    if (operation === "add") {
      const user = await User.findById(id);
      if (!user) { res.status(404).json({ error: "User not found" }); return; }
      user.credits += credits;
      await user.save();
    } else {
      await User.findByIdAndUpdate(id, { credits });
    }
    const updated = await User.findById(id, "username credits").lean();
    res.json({ id: updated._id.toString(), username: updated.username, credits: updated.credits });
  } catch (err) {
    req.log.error({ err }, "Update credits error");
    res.status(500).json({ error: "Failed" });
  }
});

router.delete("/admin/users/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await User.findByIdAndDelete(id);
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete user error");
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/admin/settings", async (req, res) => {
  try {
    const rows = await Setting.find().lean();
    const settings = {};
    for (const row of rows) settings[row.key] = row.value;
    res.json(settings);
  } catch (err) {
    req.log.error({ err }, "Get settings error");
    res.status(500).json({ error: "Failed" });
  }
});

router.put("/admin/settings", async (req, res) => {
  const updates = req.body;
  try {
    for (const [key, value] of Object.entries(updates)) {
      await Setting.findOneAndUpdate({ key }, { key, value: String(value) }, { upsert: true });
    }
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Update settings error");
    res.status(500).json({ error: "Failed" });
  }
});

router.post("/admin/vouchers", async (req, res) => {
  const { credits, count = 1 } = req.body;
  if (!credits || credits <= 0) {
    res.status(400).json({ error: "Credits required" });
    return;
  }
  try {
    const codes = [];
    for (let i = 0; i < Math.min(count, 100); i++) {
      const code = "DXB-" + crypto.randomBytes(6).toString("hex").toUpperCase();
      await Voucher.create({ code, credits });
      codes.push(code);
    }
    res.json({ codes });
  } catch (err) {
    req.log.error({ err }, "Create voucher error");
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/admin/vouchers", async (req, res) => {
  try {
    const vouchers = await Voucher.find().sort({ createdAt: -1 }).limit(200).lean();
    res.json(vouchers.map(v => ({ id: v._id.toString(), code: v.code, credits: v.credits, used: v.used, usedAt: v.usedAt, createdAt: v.createdAt })));
  } catch (err) {
    req.log.error({ err }, "Get vouchers error");
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/admin/topups", async (req, res) => {
  try {
    const topups = await TopupTransaction.find({})
      .sort({ createdAt: -1 })
      .limit(500)
      .populate("userId", "username")
      .lean();
    res.json(topups.map(t => ({
      id: t._id.toString(),
      username: t.userId?.username || "—",
      usdtAmount: t.usdtAmount,
      creditsAdded: t.creditsAdded,
      txHash: t.txHash,
      fromAddress: t.fromAddress,
      createdAt: t.createdAt,
    })));
  } catch (err) {
    req.log.error({ err }, "List topups error");
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/admin/logs", async (req, res) => {
  const { search, user, type, status, from_date, to_date, limit = "5000" } = req.query;
  const pageSize = Math.min(parseInt(limit) || 5000, 10000);
  try {
    const filter = {};
    if (search) filter.email = { $regex: escapeRegex(search), $options: "i" };
    if (type) filter.type = type;
    if (status) filter.status = status;
    if (from_date || to_date) {
      filter.createdAt = {};
      if (from_date) filter.createdAt.$gte = new Date(from_date);
      if (to_date) {
        const end = new Date(to_date);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }
    if (user) {
      const u = await User.findOne({ username: { $regex: escapeRegex(user), $options: "i" } }, "_id").lean();
      if (u) filter.userId = u._id;
      else { res.json([]); return; }
    }
    const logs = await Log.find(filter).sort({ createdAt: -1 }).limit(pageSize).populate("userId", "username").lean();
    res.json(logs.map(l => ({
      id: l._id.toString(),
      userId: l.userId?._id?.toString(),
      username: l.userId?.username || "Deleted User",
      type: l.type,
      email: l.email,
      status: l.status,
      result: l.result,
      creditsUsed: l.creditsUsed,
      createdAt: l.createdAt,
    })));
  } catch (err) {
    req.log.error({ err }, "Admin logs error");
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/admin/logs/export", async (req, res) => {
  const { search, user, type, status } = req.query;
  try {
    const filter = {};
    if (search) filter.email = { $regex: escapeRegex(search), $options: "i" };
    if (type) filter.type = type;
    if (status) filter.status = status;
    if (user) {
      const u = await User.findOne({ username: { $regex: escapeRegex(user), $options: "i" } }, "_id").lean();
      if (u) filter.userId = u._id;
      else { res.send("username,type,email,status,creditsUsed,timestamp\n"); return; }
    }
    const logs = await Log.find(filter).sort({ createdAt: -1 }).limit(50000).populate("userId", "username").lean();
    const csv = ["username,type,email,status,creditsUsed,timestamp",
      ...logs.map(l => [
        l.userId?.username || "Unknown",
        l.type,
        l.email || "",
        l.status,
        l.creditsUsed,
        new Date(l.createdAt).toISOString(),
      ].join(","))
    ].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="logs-${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) {
    req.log.error({ err }, "Admin logs export error");
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/admin/users/:id/logs", async (req, res) => {
  const { id } = req.params;
  const { search } = req.query;
  try {
    const user = await User.findById(id, "username role credits apiKey createdAt").lean();
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    const filter = { userId: id };
    if (search) {
      filter.email = { $regex: escapeRegex(search), $options: "i" };
    }
    const logs = await Log.find(filter).sort({ createdAt: -1 }).limit(1000).lean();
    res.json({
      user: { id: user._id.toString(), username: user.username, role: user.role, credits: user.credits, apiKey: user.apiKey, createdAt: user.createdAt },
      logs: logs.map(l => ({
        id: l._id.toString(),
        type: l.type,
        email: l.email,
        status: l.status,
        result: l.result,
        creditsUsed: l.creditsUsed,
        createdAt: l.createdAt,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "User logs error");
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/admin/search", async (req, res) => {
  const { email } = req.query;
  if (!email || email.trim().length < 2) {
    res.status(400).json({ error: "Search query too short" });
    return;
  }
  try {
    const logs = await Log.find({ email: { $regex: escapeRegex(email.trim()), $options: "i" } })
      .sort({ createdAt: -1 })
      .limit(200)
      .populate("userId", "username")
      .lean();
    const results = logs.map(l => ({
      id: l._id.toString(),
      email: l.email,
      username: l.userId?.username || "Deleted User",
      userId: l.userId?._id?.toString(),
      status: l.status,
      type: l.type,
      creditsUsed: l.creditsUsed,
      createdAt: l.createdAt,
    }));
    res.json(results);
  } catch (err) {
    req.log.error({ err }, "Admin search error");
    res.status(500).json({ error: "Failed" });
  }
});

router.post("/admin/droplet-health", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== "string") { res.status(400).json({ error: "URL required" }); return; }
    let parsed;
    try { parsed = new URL(url); } catch { res.status(400).json({ error: "Invalid URL" }); return; }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") { res.status(400).json({ error: "Invalid protocol" }); return; }
    const host = parsed.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host.startsWith("10.") || host.startsWith("192.168.") || host.startsWith("172.") || host === "::1" || host === "[::1]") {
      res.status(400).json({ error: "Private/internal URLs not allowed" }); return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const resp = await fetch(`${url}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      const data = await resp.json();
      res.json({ status: data.status === "ok" ? "online" : "offline" });
    } catch {
      clearTimeout(timeout);
      res.json({ status: "offline" });
    }
  } catch (err) {
    req.log.error({ err }, "Droplet health check error");
    res.json({ status: "offline" });
  }
});

router.get("/admin/droplet-logs", async (req, res) => {
  const dropletKeys = {
    "trigger-reset": { settingKey: "droplet_trigger_reset", envKey: "TRIGGER_RESET_API_KEY", fallback: "http://142.93.4.225:3000" },
    "change-password": { settingKey: "droplet_change_password", envKey: "CHANGE_PASSWORD_API_KEY", fallback: "http://159.89.172.195:3000" },
    "check-email": { settingKey: "droplet_check_email", envKey: "CHECK_EMAIL_API_KEY", fallback: "http://139.59.42.65:3000" },
    "signup-code": { settingKey: "droplet_signup_code", envKey: "SIGNUP_CODE_API_KEY", fallback: "http://143.110.189.154:3000" },
  };
  const service = req.query.service;
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);

  async function fetchDropletLogs(name, config) {
    try {
      const urlSetting = await Setting.findOne({ key: config.settingKey }).lean();
      const baseUrl = (urlSetting && urlSetting.value) || config.fallback;
      const apiKey = process.env[config.envKey] || "";
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const resp = await fetch(`${baseUrl}/logs?limit=${limit}`, {
        headers: {
          "X-Service-Key": apiKey,
          "Origin": `https://${process.env.DASHBOARD_DOMAIN || ""}`,
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!resp.ok) return { service: name, status: "error", error: `HTTP ${resp.status}`, logs: [] };
      const logs = await resp.json();
      return { service: name, status: "ok", logs };
    } catch (err) {
      return { service: name, status: "error", error: err?.message || "Connection failed", logs: [] };
    }
  }

  try {
    if (service && dropletKeys[service]) {
      const result = await fetchDropletLogs(service, dropletKeys[service]);
      res.json(result);
    } else {
      const results = await Promise.all(
        Object.entries(dropletKeys).map(([name, config]) => fetchDropletLogs(name, config))
      );
      res.json(results);
    }
  } catch (err) {
    req.log.error({ err }, "Droplet logs error");
    res.status(500).json({ error: "Failed" });
  }
});

router.post("/admin/shell", async (req, res) => {
  const { command } = req.body;
  if (!command || !command.trim()) {
    res.status(400).json({ error: "Command required" });
    return;
  }

  const blocked = ['rm -rf /', 'mkfs', 'dd if=', ':(){', 'fork bomb'];
  if (blocked.some(b => command.includes(b))) {
    res.status(403).json({ error: "Command blocked for safety" });
    return;
  }

  try {
    const { execSync } = require("child_process");
    const output = execSync(command, {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
      shell: "/bin/bash",
    });
    res.json({ success: true, output: output.slice(-5000) });
  } catch (err) {
    const stderr = err.stderr?.toString() || "";
    const stdout = err.stdout?.toString() || "";
    res.json({ success: false, output: (stdout + "\n" + stderr).slice(-5000), exitCode: err.status });
  }
});

router.post("/admin/deploy", async (req, res) => {
  const { service } = req.body;
  const dropletConfigs = {
    "trigger-reset": { settingKey: "droplet_trigger_reset", envKey: "TRIGGER_RESET_API_KEY", fallback: "http://142.93.4.225:3000" },
    "change-password": { settingKey: "droplet_change_password", envKey: "CHANGE_PASSWORD_API_KEY", fallback: "http://159.89.172.195:3000" },
    "check-email": { settingKey: "droplet_check_email", envKey: "CHECK_EMAIL_API_KEY", fallback: "http://139.59.42.65:3000" },
    "signup-code": { settingKey: "droplet_signup_code", envKey: "SIGNUP_CODE_API_KEY", fallback: "http://143.110.189.154:3000" },
  };

  if (!service || !dropletConfigs[service]) {
    res.status(400).json({ error: "Invalid service. Use: trigger-reset, change-password, check-email, signup-code" });
    return;
  }

  const config = dropletConfigs[service];
  try {
    const urlSetting = await Setting.findOne({ key: config.settingKey }).lean();
    const baseUrl = (urlSetting && urlSetting.value) || config.fallback;
    const apiKey = process.env[config.envKey] || "";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const resp = await fetch(`${baseUrl}/deploy`, {
      method: "POST",
      headers: {
        "X-Service-Key": apiKey,
        "Content-Type": "application/json",
        "Origin": `https://${process.env.DASHBOARD_DOMAIN || ""}`,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      res.status(resp.status).json({ error: data.error || `HTTP ${resp.status}`, service });
      return;
    }
    res.json({ success: true, service, ...data });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Deploy failed", service });
  }
});

router.get("/admin/proxies", async (req, res) => {
  try {
    const proxies = await ProxyCredential.find().populate("userId", "username").lean();
    res.json(proxies.map(p => ({
      id: p._id.toString(),
      userId: p.userId?._id?.toString() || null,
      username: p.userId?.username || "Unknown",
      host: p.host,
      port: p.port,
      username_proxy: p.username,
      password: p.password,
      updatedAt: p.updatedAt,
    })));
  } catch (err) {
    req.log.error({ err }, "List proxies error");
    res.status(500).json({ error: "Failed" });
  }
});

router.post("/admin/proxies", async (req, res) => {
  const { userId, host, port, username, password } = req.body;
  if (!userId || !host || !port || !username || !password) {
    res.status(400).json({ error: "All fields required: userId, host, port, username, password" });
    return;
  }
  try {
    const user = await User.findById(userId);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    const existing = await ProxyCredential.findOne({ userId });
    if (existing) {
      existing.host = host;
      existing.port = port;
      existing.username = username;
      existing.password = password;
      await existing.save();
      res.json({ success: true, message: "Proxy updated" });
    } else {
      await ProxyCredential.create({ userId, host, port, username, password });
      res.json({ success: true, message: "Proxy created" });
    }
  } catch (err) {
    req.log.error({ err }, "Create/update proxy error");
    res.status(500).json({ error: "Failed" });
  }
});

router.put("/admin/proxies/:id", async (req, res) => {
  const { host, port, username, password } = req.body;
  try {
    const proxy = await ProxyCredential.findById(req.params.id);
    if (!proxy) { res.status(404).json({ error: "Proxy not found" }); return; }
    if (host) proxy.host = host;
    if (port) proxy.port = port;
    if (username) proxy.username = username;
    if (password) proxy.password = password;
    await proxy.save();
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Update proxy error");
    res.status(500).json({ error: "Failed" });
  }
});

router.delete("/admin/proxies/:id", async (req, res) => {
  try {
    await ProxyCredential.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete proxy error");
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/admin/imap", async (req, res) => {
  try {
    const { ImapCredential } = require("../models");
    const creds = await ImapCredential.find().populate("userId", "username").sort({ createdAt: -1 }).lean();
    res.json(creds.map(c => ({
      id: c._id.toString(),
      username: c.userId?.username || "Deleted User",
      email: c.email,
      password: c.password,
      createdAt: c.createdAt,
    })));
  } catch (err) {
    req.log.error({ err }, "Admin imap list error");
    res.status(500).json({ error: "Failed" });
  }
});

router.post("/admin/self-deploy", (req, res) => {
  const cwd = process.cwd();
  const steps = [];

  const run = (cmd, label) => new Promise((resolve, reject) => {
    exec(cmd, { cwd, timeout: 120000 }, (err, stdout, stderr) => {
      steps.push({ step: label, stdout: stdout?.trim(), stderr: stderr?.trim(), ok: !err });
      if (err) reject(new Error(`${label} failed: ${stderr || err.message}`));
      else resolve(stdout?.trim());
    });
  });

  res.setHeader("Content-Type", "text/x-ndjson");
  res.flushHeaders?.();

  run("git pull origin main", "git pull")
    .then(out => {
      res.write(JSON.stringify({ step: "git pull", ok: true, out }) + "\n");
      return run("npm install --production=false", "npm install");
    })
    .then(out => {
      res.write(JSON.stringify({ step: "npm install", ok: true, out: out?.slice(0, 200) }) + "\n");
      return run("npm run build", "npm run build");
    })
    .then(out => {
      res.write(JSON.stringify({ step: "build", ok: true, out: out?.slice(0, 200) }) + "\n");
      return run("pm2 reload all --update-env", "pm2 reload");
    })
    .then(out => {
      res.write(JSON.stringify({ step: "pm2 reload", ok: true, out }) + "\n");
      res.end(JSON.stringify({ done: true, steps }) + "\n");
    })
    .catch(err => {
      res.write(JSON.stringify({ error: err.message, steps }) + "\n");
      res.end();
    });
});

module.exports = router;
