const express = require("express");

function createMockDroplet(name, port, internalApiKey) {
  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    const serviceKey = req.headers["x-service-key"];
    if (serviceKey !== internalApiKey) {
      return res.status(401).json({ error: "Unauthorized", detail: "Invalid API key" });
    }
    next();
  });

  if (name === "trigger-reset") {
    app.post("/trigger-reset", (req, res) => {
      const { email, country, proxyUrl } = req.body;
      if (!email) return res.status(400).json({ error: "email required" });
      const rand = Math.random();
      if (rand < 0.85) {
        res.json({
          success: true,
          email,
          country: country || "US",
          resetLink: `https://www.netflix.com/password-reset/${Date.now()}`,
          message: "Password reset email sent",
        });
      } else {
        res.json({
          success: false,
          email,
          error: "Account not found or locked",
        });
      }
    });
  }

  if (name === "change-password") {
    app.post("/change-password", (req, res) => {
      const { resetUrl, newPassword, country, proxyUrl } = req.body;
      if (!resetUrl || !newPassword) return res.status(400).json({ error: "resetUrl and newPassword required" });
      const rand = Math.random();
      if (rand < 0.8) {
        res.json({
          success: true,
          account: { email: `user${Math.floor(Math.random() * 1000)}@gmail.com` },
          message: "Password changed successfully",
        });
      } else {
        res.json({
          success: false,
          error: "Reset link expired or invalid",
        });
      }
    });
  }

  if (name === "check-email") {
    app.post("/check-email", (req, res) => {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: "email required" });
      const statuses = ["active", "inactive", "invalid"];
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      const details = {
        active: { screenName: "EMAIL_PASSWORD", detail: "Netflix account found" },
        inactive: { screenName: "EMAIL_REGISTER", detail: "Account suspended" },
        invalid: { screenName: "EMAIL_REGISTER_SEND_LINK", detail: "No Netflix account found" },
      };
      res.json({
        email,
        status,
        ...details[status],
        proxyCountry: "US",
        durationMs: Math.floor(Math.random() * 3000) + 500,
      });
    });
  }

  app.get("/health", (req, res) => {
    res.json({ status: "ok", service: name });
  });

  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`Mock ${name} droplet running on port ${port}`);
      resolve(server);
    });
  });
}

async function startAll() {
  const servers = await Promise.all([
    createMockDroplet("trigger-reset", 4001, process.env.TRIGGER_RESET_API_KEY || "vxntsht4yrla36i7e9g1tkv7h3l541cf"),
    createMockDroplet("change-password", 4002, process.env.CHANGE_PASSWORD_API_KEY || "15e20239ecb6c8d1b8292b0601f7b9a47dcb20f041768f4f"),
    createMockDroplet("check-email", 4003, process.env.CHECK_EMAIL_API_KEY || "6e7b429be0b6268d0b20c84eedbd9c32b6390352d9888f6a"),
  ]);
  console.log("All mock droplets started");
  return servers;
}

if (require.main === module) {
  startAll();
}

module.exports = { startAll, createMockDroplet };
