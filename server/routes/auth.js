const { Router } = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { User } = require("../models");
const { signToken } = require("../lib/jwtUtils");
const { requireAuth } = require("../middlewares/auth");

const router = Router();

router.post("/auth/register", async (req, res) => {
  const { username, password, promoCode } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }
  if (username.length < 3 || username.length > 30) {
    return res.status(400).json({ error: "Username must be 3-30 characters" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ error: "Username can only contain letters, numbers, and underscores" });
  }
  try {
    const normalizedUsername = username.toLowerCase();
    const existing = await User.findOne({ username: normalizedUsername });
    if (existing) {
      return res.status(409).json({ error: "Username already taken" });
    }
    const hashed = await bcrypt.hash(password, 10);
    const apiKey = crypto.randomBytes(24).toString("hex");
    const user = await User.create({
      username: normalizedUsername,
      password: hashed,
      role: "user",
      credits: 0,
      apiKey,
      promoCode: promoCode && promoCode.trim() ? promoCode.trim() : null,
    });
    const token = signToken({ id: user._id.toString(), username: user.username, role: user.role });
    res.json({
      token,
      user: { id: user._id.toString(), username: user.username, role: user.role, credits: user.credits },
    });
  } catch (err) {
    req.log.error({ err }, "Register error");
    res.status(500).json({ error: "Registration failed" });
  }
});

router.post("/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Username and password required" });
    return;
  }
  try {
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) { res.status(401).json({ error: "Invalid credentials" }); return; }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) { res.status(401).json({ error: "Invalid credentials" }); return; }
    const token = signToken({ id: user._id.toString(), username: user.username, role: user.role });
    res.json({
      token,
      user: { id: user._id.toString(), username: user.username, role: user.role, credits: user.credits },
    });
  } catch (err) {
    req.log.error({ err }, "Login error");
    res.status(500).json({ error: "Login failed" });
  }
});

router.get("/auth/me", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).lean();
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    res.json({ id: user._id.toString(), username: user.username, role: user.role, credits: user.credits });
  } catch (err) {
    req.log.error({ err }, "Me error");
    res.status(500).json({ error: "Failed" });
  }
});

module.exports = router;
