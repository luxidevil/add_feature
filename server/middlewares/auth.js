const { verifyToken } = require("../lib/jwtUtils");
const { User, Setting } = require("../models");

async function requireAuth(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);

  const payload = verifyToken(token);
  if (payload) {
    try {
      const user = await User.findById(payload.id).lean();
      if (!user) {
        res.status(401).json({ error: "User not found" });
        return;
      }
      req.user = { id: user._id.toString(), username: user.username, role: user.role, credits: user.credits };
      next();
      return;
    } catch {
      res.status(500).json({ error: "Auth check failed" });
      return;
    }
  }

  try {
    const testingModeSetting = await Setting.findOne({ key: "testing_mode" }).lean();
    const testingMode = testingModeSetting?.value === "true";

    if (!testingMode) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    const testApiKeySetting = await Setting.findOne({ key: "test_api_key" }).lean();
    if (!testApiKeySetting || testApiKeySetting.value !== token) {
      res.status(401).json({ error: "Invalid test API key" });
      return;
    }

    const adminUser = await User.findOne({ role: "admin" }).lean();
    if (!adminUser) {
      res.status(401).json({ error: "No admin user found" });
      return;
    }
    req.user = { id: adminUser._id.toString(), username: adminUser.username, role: adminUser.role, credits: adminUser.credits };
    req.isTestMode = true;
    next();
  } catch {
    res.status(500).json({ error: "Auth check failed" });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
