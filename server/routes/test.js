const { Router } = require("express");
const { Setting, User } = require("../models");
const { requireAuth, requireAdmin } = require("../middlewares/auth");

const router = Router();

router.get("/test/status", async (req, res) => {
  try {
    const setting = await Setting.findOne({ key: "testing_mode" }).lean();
    res.json({ testing_mode: setting?.value === "true" });
  } catch {
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/test/info", requireAuth, requireAdmin, async (req, res) => {
  try {
    const [modeSetting, keySetting] = await Promise.all([
      Setting.findOne({ key: "testing_mode" }).lean(),
      Setting.findOne({ key: "test_api_key" }).lean(),
    ]);
    res.json({
      testing_mode: modeSetting?.value === "true",
      test_api_key: keySetting?.value || null,
      usage: {
        description: "Use the test_api_key as a Bearer token in Authorization header to call all /api/proxy/* endpoints when testing_mode is true.",
        example_curl: `curl -X POST https://nfresetagent.com/api/proxy/check-email -H "Authorization: Bearer <test_api_key>" -H "Content-Type: application/json" -d '{"email":"test@test.com"}'`,
      },
    });
  } catch {
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/test/ping", requireAuth, async (req, res) => {
  res.json({
    ok: true,
    mode: req.isTestMode ? "test_key" : "jwt",
    user: req.user.username,
    message: "Test mode connection successful",
  });
});

module.exports = router;
